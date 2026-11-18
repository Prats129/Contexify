package ai.contexify.security

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import java.io.File
import java.security.KeyStore
import java.util.UUID
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import org.json.JSONArray
import org.json.JSONObject

/** Single-process native coordinator journal. Atomic writes + CAS, authenticated encryption,
 * noBackup storage, bounded seven-day retention. Never contains tokens, transcripts or audio.
 */
internal class PlanRecoveryStore(context: Context, private val installation: String, private val binding: String) : PlanStore {
  private companion object { val storageLock = Any() }
  private val directory = File(context.noBackupFilesDir, "assistant-plans-$installation")
  private val ownerMarker = File(context.noBackupFilesDir, "assistant-$installation")
  private val alias = "ai.contexify.assistant.recovery.$installation"
  private val keys get() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
  private var cachedKey: SecretKey? = null
  init {
    require(UUID.fromString(installation).toString() == installation)
    check(directory.canonicalFile.parentFile == context.noBackupFilesDir.canonicalFile)
  }

  private fun key(create: Boolean = false): SecretKey {
    check(ownerMarker.isFile && ownerMarker.readText(Charsets.UTF_8) == binding)
    cachedKey?.let { return it }
    val existing = keys.getKey(alias, null)
    if (existing != null) return (existing as SecretKey).also { cachedKey = it }
    check(create && (!directory.exists() || directory.list()?.isEmpty() == true)) {
      "Recovery key is unavailable. No action may be replayed."
    }
    val spec = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
      .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setRandomizedEncryptionRequired(true)
    // Android documents pre-15 bugs in this flag; foreground/unlocked checks apply on every OS.
    if (Build.VERSION.SDK_INT >= 35) spec.setUnlockedDeviceRequired(true)
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
      init(spec.build())
    }.generateKey().also { cachedKey = it }
  }
  private fun file(id: String): AtomicFile {
    require(UUID.fromString(id).toString() == id)
    return AtomicFile(File(directory, id))
  }
  private fun aad(id: String) = "v2\n$installation\n$binding\n$id".toByteArray(Charsets.UTF_8)

  private fun encode(row: PlanCheckpoint): ByteArray {
    val steps = JSONArray()
    row.states.forEachIndexed { i, state -> steps.put(JSONObject().put("state", state)
      .put("capability", row.capabilities[i]).put("percent", row.percents[i])
      .put("result", row.evidence[i]?.let { JSONObject(it.bridge()) } ?: JSONObject.NULL)) }
    return JSONObject().put("format", 1).put("plan_id", row.id).put("plan_revision", row.planRevision)
      .put("digest", row.digest).put("expires_at", row.expiresAt).put("revision", row.version)
      .put("steps", steps).toString().toByteArray(Charsets.UTF_8)
  }
  fun read(id: String): PlanCheckpoint = synchronized(storageLock) {
    val target = file(id)
    val encrypted = target.openRead().use { stream ->
      val output = java.io.ByteArrayOutputStream()
      val buffer = ByteArray(1024)
      while (true) {
        val size = stream.read(buffer)
        if (size < 0) break
        check(output.size() + size <= 16413)
        output.write(buffer, 0, size)
      }
      output.toByteArray()
    }
    val row = JSONObject(String(RecoveryCipher.open(encrypted, key(), aad(id)), Charsets.UTF_8))
    require(row.getInt("format") == 1 && row.getString("plan_id") == id)
    val steps = row.getJSONArray("steps")
    require(steps.length() in 1..5)
    val states = mutableListOf<String>()
    val evidence = mutableListOf<StepEvidence?>()
    val capabilities = mutableListOf<String>()
    val percents = mutableListOf<Int>()
    for (i in 0 until steps.length()) {
      val step = steps.getJSONObject(i)
      val state = step.getString("state")
      require(state in setOf("pending", "skipped", "verified", "failed", "cancelled", "outcome_unknown"))
      val capability = step.getString("capability")
      val percent = step.getInt("percent")
      OperationStep(i, capability, percent, emptyList()).validate(i)
      states.add(state); capabilities.add(capability); percents.add(percent)
      val result = step.optJSONObject("result")
      evidence.add(result?.let { StepEvidence(it.getString("outcome"), it.getInt("requested_percent"),
        if (it.isNull("observed_percent")) null else it.getInt("observed_percent"), it.getBoolean("receipt_recorded")) })
      require(evidence.last() == null || (evidence.last()?.outcome == state && evidence.last()?.requested == percent))
    }
    OperationIdentity(id, row.getInt("plan_revision"), 0)
    PlanCheckpoint(id, row.getInt("plan_revision"), row.getString("digest"), row.getLong("expires_at"),
      row.getInt("revision"), capabilities, percents, states, evidence)
  }
  private fun write(row: PlanCheckpoint) {
    val encrypted = RecoveryCipher.seal(encode(row), key(), aad(row.id))
    val target = file(row.id)
    val stream = target.startWrite()
    try {
      stream.write(encrypted); stream.fd.sync(); target.finishWrite(stream)
      check(read(row.id) == row)
    } catch (error: Exception) { target.failWrite(stream); throw error }
  }
  override fun create(plan: OperationPlan): PlanCheckpoint = synchronized(storageLock) {
    val target = file(plan.id)
    check(!target.baseFile.exists() && !File(target.baseFile.path + ".new").exists() && !File(target.baseFile.path + ".bak").exists()) {
      "This plan already has recovery evidence. Check its status; do not replay it."
    }
    key(create = true)
    check(directory.isDirectory || directory.mkdir())
    val existing = recent()
    existing.filter { it.expiresAt < System.currentTimeMillis() - 7 * 86400000L }.forEach { file(it.id).delete() }
    check((directory.list()?.size ?: 512) < 512)
    val row = PlanCheckpoint(plan.id, plan.revision, plan.digest, plan.expiresAt, 1,
      plan.steps.map { it.capability }, plan.steps.map { it.percent },
      plan.steps.map { "pending" }, plan.steps.map { null })
    write(row)
    row
  }
  override fun save(expected: Int, next: PlanCheckpoint) = synchronized(storageLock) {
    val old = read(next.id)
    check(old.version == expected && next.version == expected + 1 && old.planRevision == next.planRevision &&
      old.digest == next.digest && old.expiresAt == next.expiresAt && old.capabilities == next.capabilities && old.percents == next.percents)
    write(next)
  }
  fun recent(limit: Int = 512): List<PlanCheckpoint> = synchronized(storageLock) {
    require(limit in 1..512)
    if (!directory.exists()) return@synchronized emptyList()
    val files = requireNotNull(directory.listFiles())
    check(files.size <= 1024) // AtomicFile may leave a bounded sidecar per entry.
    val ids = files.map { it.name.removeSuffix(".bak").removeSuffix(".new") }.distinct()
    check(ids.size <= 512)
    ids.sortedByDescending { file(it).baseFile.lastModified() }.take(limit).map { read(it) }
  }
  fun forget() = synchronized(storageLock) {
    if (directory.exists()) {
      for (target in requireNotNull(directory.listFiles())) {
        check(target.isFile && target.canonicalFile.parentFile == directory.canonicalFile)
        check(target.delete())
      }
      check(directory.delete())
    }
    keys.deleteEntry(alias)
    cachedKey = null
  }
}
