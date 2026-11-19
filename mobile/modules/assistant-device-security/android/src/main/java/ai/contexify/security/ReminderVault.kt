package ai.contexify.security

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import android.util.Base64
import java.io.File
import java.security.KeyStore
import java.security.MessageDigest
import java.util.UUID
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import org.json.JSONArray
import org.json.JSONObject

internal data class ReminderOwner(val installation: String, val binding: String, val epoch: String)
internal data class ReminderEntry(val id: String, val times: List<Long>, val index: Int, val state: String,
  val revision: Int, val nonce: String, val task: String, val lastOutcome: String?, val body: String?) {
  fun validate() {
    require(UUID.fromString(id).toString() == id && UUID.fromString(task).toString() == task)
    require(times.size in 1..91 && times == times.distinct().sorted() && times.all { it > 0 })
    require(index in times.indices && revision in 1..1000 && Regex("[A-Za-z0-9_-]{43}").matches(nonce))
    require(state in setOf("schedule_unknown", "scheduled", "notification_unknown", "notification_requested", "cancelled", "missed", "blocked", "expired"))
    require(lastOutcome == null || lastOutcome in setOf("notification_requested", "missed", "blocked"))
  }
}

/** App-private, no-backup authenticated records. Receivers never decrypt reminder text.
 * A separate unlocked-device key protects the private body on Android 15+; metadata
 * remains usable after first unlock so already-approved generic alerts can fire locked.
 */
internal class ReminderVault(private val context: Context) {
  companion object {
    val lock = Any() // Receiver, logout and foreground operations share one process/lock.
    fun hash(value: String): String = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
      .joinToString("") { "%02x".format(it.toInt() and 255) }
    fun id(value: String): String { require(UUID.fromString(value).toString() == value); return value }
  }
  private val root = File(context.noBackupFilesDir, "assistant-reminders-v1")
  private val ownerFile get() = AtomicFile(File(root, "owner"))
  private val disabledFile get() = AtomicFile(File(root, "disabled"))
  private fun disabled() = listOf("", ".bak", ".new").any { File(disabledFile.baseFile.path + it).exists() }
  private val cachedKeys = mutableMapOf<String, SecretKey>()
  private val keys get() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
  private fun bounded(file: AtomicFile, limit: Int): ByteArray = file.openRead().use { stream ->
    val output = java.io.ByteArrayOutputStream()
    val buffer = ByteArray(1024)
    while (true) {
      val count = stream.read(buffer)
      if (count < 0) break
      check(output.size() + count <= limit)
      output.write(buffer, 0, count)
    }
    output.toByteArray()
  }
  private fun atomic(file: AtomicFile, bytes: ByteArray) {
    val stream = file.startWrite()
    try { stream.write(bytes); stream.fd.sync(); file.finishWrite(stream) }
    catch (error: Exception) { file.failWrite(stream); throw error }
  }
  private fun file(value: String) = AtomicFile(File(root, id(value)))
  private fun alias(owner: ReminderOwner, privateBody: Boolean) =
    "ai.contexify.reminders.v1.${owner.installation}.${if (privateBody) "body" else "metadata"}"
  private fun key(owner: ReminderOwner, privateBody: Boolean, create: Boolean = false): SecretKey {
    cachedKeys[alias(owner, privateBody)]?.let { return it }
    val existing = keys.getKey(alias(owner, privateBody), null)
    if (existing != null) return (existing as SecretKey).also { cachedKeys[alias(owner, privateBody)] = it }
    check(create) { "Reminder encryption key is unavailable. No reminder is replayed." }
    val spec = KeyGenParameterSpec.Builder(alias(owner, privateBody), KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
      .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setRandomizedEncryptionRequired(true)
    if (privateBody && Build.VERSION.SDK_INT >= 35) spec.setUnlockedDeviceRequired(true)
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply { init(spec.build()) }.generateKey()
  }
  private fun aad(owner: ReminderOwner, id: String, kind: String) =
    "reminder-v1\n${owner.installation}\n${owner.binding}\n${owner.epoch}\n$id\n$kind".toByteArray(Charsets.UTF_8)
  fun owner(): ReminderOwner? = synchronized(lock) {
    if (disabled() || (!ownerFile.baseFile.exists() && !File(ownerFile.baseFile.path + ".bak").exists())) return@synchronized null
    val value = JSONObject(String(bounded(ownerFile, 1024), Charsets.UTF_8))
    val result = ReminderOwner(id(value.getString("installation")), value.getString("binding"), id(value.getString("epoch")))
    check(result.binding.length == 44)
    val marker = File(context.noBackupFilesDir, "assistant-${result.installation}")
    check(marker.isFile && marker.readText(Charsets.UTF_8) == result.binding)
    result
  }
  fun requireOwner(expected: ReminderOwner) { check(owner() == expected) { "Reminder ownership changed." } }
  fun activate(installation: String, binding: String): ReminderOwner = synchronized(lock) {
    owner()?.let { check(it.installation == installation && it.binding == binding); return@synchronized it }
    check(root.isDirectory || root.mkdir())
    check(root.list()?.all { it == "disabled" || it == "disabled.bak" || it == "disabled.new" } == true) { "Old reminder data must be cleared before activating a new owner." }
    val result = ReminderOwner(id(installation), binding, UUID.randomUUID().toString())
    // Never regenerate a missing key over records. An empty new vault is the only creation path.
    key(result, false, create = true); key(result, true, create = true)
    atomic(ownerFile, JSONObject().put("installation", installation).put("binding", binding)
      .put("epoch", result.epoch).toString().toByteArray(Charsets.UTF_8))
    disabledFile.delete()
    check(!disabled())
    requireOwner(result)
    result
  }
  fun ids(): List<String> = synchronized(lock) {
    if (!root.exists()) return@synchronized emptyList()
    val files = requireNotNull(root.listFiles())
    check(files.size <= 1030)
    files.map { it.name.removeSuffix(".bak").removeSuffix(".new") }.filter { it != "owner" && it != "disabled" }.distinct().map(::id)
  }
  fun read(owner: ReminderOwner, id: String): ReminderEntry = synchronized(lock) {
    requireOwner(owner)
    val container = JSONObject(String(bounded(file(id), 24576), Charsets.UTF_8))
    require(container.getInt("format") == 1)
    val plain = RecoveryCipher.open(Base64.decode(container.getString("metadata"), Base64.NO_WRAP), key(owner, false), aad(owner, id, "metadata"))
    val value = JSONObject(String(plain, Charsets.UTF_8))
    val body = if (container.isNull("details")) null else container.getString("details")
    require(value.getString("body_hash") == body?.let(::hash).orEmpty())
    val times = value.getJSONArray("times")
    val row = ReminderEntry(value.getString("id"), (0 until times.length()).map { times.getLong(it) },
      value.getInt("index"), value.getString("state"), value.getInt("revision"), value.getString("nonce"),
      value.getString("task"), if (value.isNull("last_outcome")) null else value.getString("last_outcome"), body)
    row.validate(); require(row.id == id)
    row
  }
  fun privateBody(owner: ReminderOwner, row: ReminderEntry): JSONObject = synchronized(lock) {
    requireOwner(owner)
    val bytes = Base64.decode(requireNotNull(row.body), Base64.NO_WRAP)
    JSONObject(String(RecoveryCipher.open(bytes, key(owner, true), aad(owner, row.id, "details")), Charsets.UTF_8))
  }
  fun prune(owner: ReminderOwner): List<String> = synchronized(lock) {
    requireOwner(owner)
    val cutoff = System.currentTimeMillis() - ReminderSchedule.HISTORY_DAYS * 86400000L
    val expired = ids().map { read(owner, it) }.filter { it.times.last() < cutoff }.map { it.id }
    expired.forEach { file(it).delete() }
    expired
  }
  fun reserve(owner: ReminderOwner, id: String, times: List<Long>, task: String, details: String, salt: String, nonce: String): ReminderEntry = synchronized(lock) {
    requireOwner(owner)
    check(!file(id).baseFile.exists() && !File(file(id).baseFile.path + ".bak").exists() && !File(file(id).baseFile.path + ".new").exists())
    prune(owner)
    val rows = ids().map { read(owner, it) }
    check(rows.size < 512 && rows.count { it.state in setOf("scheduled", "schedule_unknown", "notification_unknown") } < ReminderSchedule.MAX_ACTIVE)
    val privateData = JSONObject().put("payload_json", details).put("salt", salt).toString().toByteArray(Charsets.UTF_8)
    val body = Base64.encodeToString(RecoveryCipher.seal(privateData, key(owner, true), aad(owner, id, "details")), Base64.NO_WRAP)
    val row = ReminderEntry(id, times, 0, "schedule_unknown", 1, nonce, task, null, body)
    write(owner, row); row
  }
  private fun write(owner: ReminderOwner, row: ReminderEntry) {
    requireOwner(owner); row.validate()
    val value = JSONObject().put("id", row.id).put("times", JSONArray(row.times)).put("index", row.index)
      .put("state", row.state).put("revision", row.revision).put("nonce", row.nonce).put("task", row.task)
      .put("last_outcome", row.lastOutcome ?: JSONObject.NULL).put("body_hash", row.body?.let(::hash).orEmpty())
    val cipher = RecoveryCipher.seal(value.toString().toByteArray(Charsets.UTF_8), key(owner, false), aad(owner, row.id, "metadata"))
    val container = JSONObject().put("format", 1).put("metadata", Base64.encodeToString(cipher, Base64.NO_WRAP))
      .put("details", row.body ?: JSONObject.NULL)
    atomic(file(row.id), container.toString().toByteArray(Charsets.UTF_8))
    check(read(owner, row.id) == row)
  }
  fun save(owner: ReminderOwner, old: ReminderEntry, next: ReminderEntry) = synchronized(lock) {
    check(read(owner, old.id) == old)
    ReminderDeliveryPolicy.validateTransition(old, next)
    write(owner, next)
  }
  fun clear(cancel: (String) -> Unit) = synchronized(lock) {
    if (!root.exists()) return@synchronized
    // Durable revocation first; a later cleanup failure cannot resurrect delivery.
    check(root.isDirectory || root.mkdir())
    atomic(disabledFile, byteArrayOf(1))
    check(disabled())
    ownerFile.delete()
    val ids = ids()
    ids.forEach { cancel(it); file(it).delete() }
    keys.aliases().asSequence().filter { it.startsWith("ai.contexify.reminders.v1.") }.toList().forEach { keys.deleteEntry(it) }
    cachedKeys.clear()
    check(root.list()?.all { it == "disabled" } == true)
  }
}
