package ai.contexify.security

import android.app.Activity
import android.app.AlertDialog
import android.app.KeyguardManager
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.AtomicFile
import android.view.MotionEvent
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import java.io.File
import java.net.URI
import java.net.URL
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import javax.net.ssl.HttpsURLConnection
import org.json.JSONObject

/** Native owns confirmation, HTTPS claim consumption, journal and the single OS call.
 * JavaScript never provides an executable permit, claim response, URL path or result.
 */
internal class PercentControlExecutor(
  private val context: () -> Context,
  private val activity: () -> Activity?,
  private val binding: (String, String, String) -> Unit,
  private val publicKey: (String) -> String,
  private val sign: (String, String) -> String,
  private val control: PercentDeviceControl,
  private val running: AtomicBoolean
) {
  private val generation = AtomicLong(0)
  private val main = Handler(Looper.getMainLooper())
  private var dialog: AlertDialog? = null // Access only on the main thread.

  fun cancel() {
    generation.incrementAndGet()
    main.post { dialog?.dismiss() }
  }

  fun begin(): Long {
    check(Looper.myLooper() == Looper.getMainLooper())
    check(running.compareAndSet(false, true)) { "A device-control confirmation is already in progress." }
    return generation.get()
  }

  private fun <T> onMain(block: () -> T): T {
    check(Looper.myLooper() != Looper.getMainLooper())
    var answer: Result<T>? = null
    val done = CountDownLatch(1)
    val valid = AtomicBoolean(true)
    main.post {
      try { if (valid.get()) answer = runCatching(block) }
      finally { done.countDown() }
    }
    if (!done.await(5, TimeUnit.SECONDS)) {
      valid.set(false)
      throw IllegalStateException("Foreground operation timed out.")
    }
    return requireNotNull(answer).getOrThrow()
  }

  private fun active(ticket: Long) {
    check(ticket == generation.get())
    val ctx = context()
    val guard = ctx.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    val host = requireNotNull(activity())
    check(guard.isDeviceSecure && !guard.isDeviceLocked)
    check(!host.isFinishing && !host.isDestroyed &&
      (host as? LifecycleOwner)?.lifecycle?.currentState?.isAtLeast(Lifecycle.State.RESUMED) == true)
    // React Native Modal owns a separate window; the host can be resumed without window focus.
    if (dialog != null) check(dialog?.window?.decorView?.hasWindowFocus() == true)
  }

  private fun enabled() {
    val ctx = context()
    ExecutionGate.requireEnabled(ctx)
    control.requirePermission(ctx)
  }

  private fun hash(value: String) = MessageDigest.getInstance("SHA-256")
    .digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it.toInt() and 255) }
  private fun uuid(value: String): String {
    require(UUID.fromString(value).toString() == value)
    return value
  }

  private fun post(origin: String, token: String, path: String, body: JSONObject, ticket: Long, deadline: Long): JSONObject {
    check(ticket == generation.get() && SystemClock.elapsedRealtime() < deadline)
    require(Regex("[A-Za-z0-9_-]{43}").matches(token))
    val connection = URL(origin + "/api/v1/assistant/${control.mode}" + path).openConnection() as HttpsURLConnection
    try {
      // Platform TLS validation stays intact. Never follow redirects or retry an ambiguous claim.
      connection.instanceFollowRedirects = false
      connection.connectTimeout = 5000
      connection.readTimeout = 5000
      connection.requestMethod = "POST"
      connection.setRequestProperty("Authorization", "Bearer $token")
      connection.setRequestProperty("Content-Type", "application/json")
      connection.setRequestProperty("Accept", "application/json")
      connection.useCaches = false
      connection.doOutput = true
      val bytes = body.toString().toByteArray(Charsets.UTF_8)
      connection.setFixedLengthStreamingMode(bytes.size)
      connection.outputStream.use { it.write(bytes) }
      check(connection.responseCode == 200)
      val response = connection.inputStream.use { stream ->
        val output = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(1024)
        while (true) {
          val size = stream.read(buffer)
          if (size < 0) break
          check(output.size() + size <= 8192 && SystemClock.elapsedRealtime() < deadline)
          output.write(buffer, 0, size)
        }
        JSONObject(output.toString("UTF-8"))
      }
      check(ticket == generation.get())
      return response
    } finally { connection.disconnect() }
  }

  private fun envelope(challenge: JSONObject, purpose: String, revision: Int, origin: String, user: String,
    installation: String, token: String, task: String, percent: Int): String {
    val payload = challenge.getString("payload")
    require(payload.toByteArray(Charsets.UTF_8).size <= 4096)
    val fields = JSONObject(payload)
    val base = setOf("protocol_version", "mode", "policy_version", "purpose", "origin", "user_id", "device_id",
      "installation_id", "public_key", "session_hash", "task_id", "action_revision", "arguments_json",
      "arguments_digest", "nonce", "challenge_id", "expires_at")
    val extra = when (purpose) {
      "assistant_${control.mode}_authorize" -> emptySet()
      "assistant_${control.mode}_claim" -> setOf("permit_hash")
      "assistant_${control.mode}_receipt" -> setOf("claim_id", "outcome", "observed_index", "max_index")
      else -> throw IllegalArgumentException("Unsupported device-control purpose.")
    }
    require(fields.keys().asSequence().toSet() == base + extra)
    require(fields.get("protocol_version") == 1 && fields.get("policy_version") == 1 && fields.get("action_revision") == revision)
    require(fields.getString("mode") == control.mode && fields.getString("purpose") == purpose)
    require(fields.getString("origin") == origin && fields.getString("user_id") == user &&
      fields.getString("installation_id") == installation && fields.getString("public_key") == publicKey(installation))
    binding(origin, user, installation)
    require(fields.getString("session_hash") == hash(token) && fields.getString("task_id") == task)
    uuid(fields.getString("device_id"))
    require(uuid(fields.getString("challenge_id")) == challenge.getString("challenge_id"))
    require(Regex("[A-Za-z0-9_-]{43}").matches(fields.getString("nonce")))
    val expiry = fields.getDouble("expires_at")
    val now = System.currentTimeMillis() / 1000.0
    require(expiry.isFinite() && expiry > now && expiry <= now + 65 && challenge.getDouble("expires_at") == expiry)
    val encoded = fields.getString("arguments_json")
    require(hash(encoded) == fields.getString("arguments_digest"))
    val action = JSONObject(encoded)
    require(action.keys().asSequence().toSet() == setOf("capability_id", "schema_version", "percent"))
    require(action.getString("capability_id") == control.capability && action.get("schema_version") == 1 && action.get("percent") == percent)
    return payload
  }

  private fun confirm(percent: Int, target: Int, maximum: Int, expiry: Double, ticket: Long): Boolean {
    val approved = AtomicBoolean(false)
    val done = CountDownLatch(1)
    val valid = AtomicBoolean(true)
    val timeout = Runnable { dialog?.dismiss() }
    onMain {
      active(ticket)
      check(dialog == null)
      val shown = AlertDialog.Builder(requireNotNull(activity()))
        .setTitle(control.title)
        .setMessage(control.confirmation(percent, target, maximum))
        .setPositiveButton(control.confirmationButton) { _, _ ->
          if (valid.get() && System.currentTimeMillis() / 1000.0 < expiry) {
            approved.set(runCatching { active(ticket); true }.getOrDefault(false))
          }
        }.setNegativeButton("Cancel", null).create()
      dialog = shown
      shown.setOnDismissListener {
        main.removeCallbacks(timeout)
        if (dialog === shown) dialog = null
        done.countDown()
      }
      shown.show()
      shown.getButton(AlertDialog.BUTTON_POSITIVE).apply {
        filterTouchesWhenObscured = true
        setOnTouchListener { _, event ->
          (event.flags and (MotionEvent.FLAG_WINDOW_IS_OBSCURED or MotionEvent.FLAG_WINDOW_IS_PARTIALLY_OBSCURED)) != 0
        }
      }
      main.postDelayed(timeout, ((expiry * 1000 - System.currentTimeMillis()).toLong()).coerceIn(1, 60000))
    }
    if (!done.await(61, TimeUnit.SECONDS)) {
      valid.set(false)
      main.post { dialog?.dismiss() }
      return false
    }
    return approved.get() && ticket == generation.get()
  }

  private fun journal(installation: String, task: String): AtomicFile {
    val directory = File(context().noBackupFilesDir, "assistant-${control.mode}-" + uuid(installation))
    check(directory.isDirectory || directory.mkdir())
    check((directory.list()?.size ?: 1024) < 1024)
    val file = AtomicFile(File(directory, uuid(task)))
    check(!file.baseFile.exists() && !File(file.baseFile.path + ".new").exists() && !File(file.baseFile.path + ".bak").exists())
    return file
  }

  private fun write(file: AtomicFile, data: JSONObject) {
    val stream = file.startWrite()
    try {
      stream.write(data.toString().toByteArray(Charsets.UTF_8))
      // AtomicFile logs some sync failures; this must throw before any OS effect.
      stream.fd.sync()
      file.finishWrite(stream)
      check(JSONObject(String(file.readFully(), Charsets.UTF_8)).toString() == data.toString())
    } catch (error: Exception) { file.failWrite(stream); throw error }
  }

  fun forget(installation: String) {
    cancel()
    val directory = File(context().noBackupFilesDir, "assistant-${control.mode}-" + uuid(installation))
    if (!directory.exists()) return
    check(directory.canonicalFile.parentFile == context().noBackupFilesDir.canonicalFile)
    for (file in requireNotNull(directory.listFiles())) {
      check(file.canonicalFile.parentFile == directory.canonicalFile && file.isFile)
      check(file.delete())
    }
    check(directory.delete())
  }

  fun execute(origin: String, user: String, installation: String, management: String, percent: Int, ticket: Long): Map<String, Any?> {
    var claimed = false
    var outcome = "failed"
    var observed: Int? = null
    var maximum: Int? = null
    var recorded = false
    try {
      val uri = URI(origin)
      require(uri.scheme == "https" && uri.host != null && uri.rawPath.orEmpty().isEmpty() && uri.port in listOf(-1, 443) &&
        uri.userInfo == null && uri.query == null && uri.fragment == null && origin == "https://" + uri.rawAuthority)
      uuid(installation)
      onMain { enabled(); active(ticket); binding(origin, user, installation) }
      val limits = onMain {
        active(ticket)
        control.inspect(context(), requireNotNull(activity()), percent)
      }
      maximum = limits.second
      val deadline = SystemClock.elapsedRealtime() + 120000
      val session = post(origin, management, "/sessions", JSONObject(), ticket, deadline)
      require(session.getString("scope") == "assistant:${control.mode}")
      val token = session.getString("access_token")
      val action = JSONObject().put("capability_id", control.capability).put("schema_version", 1).put("percent", percent)
      val task = post(origin, token, "/tasks", JSONObject().put("idempotency_key", UUID.randomUUID().toString()).put("action", action), ticket, deadline)
      val taskId = uuid(task.getString("task_id"))
      require(task.getString("mode") == control.mode && task.getString("state") == "awaiting_confirmation" && task.getInt("revision") == 1)
      val taskPath = "/tasks/$taskId"
      fun request(suffix: String, body: JSONObject) = post(origin, token, taskPath + suffix, body, ticket, deadline)
      fun validate(challenge: JSONObject, purpose: String, revision: Int) =
        envelope(challenge, purpose, revision, origin, user, installation, token, taskId, percent)
      fun proof(challenge: JSONObject, payload: String, revision: Int) = JSONObject()
        .put("expected_revision", revision).put("challenge_id", challenge.getString("challenge_id")).put("signature", sign(installation, payload))
      val challenge = request("/authorization-challenge", JSONObject().put("expected_revision", 1))
      val authorization = validate(challenge, "assistant_${control.mode}_authorize", 1)
      if (!confirm(percent, limits.third, limits.second, challenge.getDouble("expires_at"), ticket)) {
        outcome = "cancelled"
        if (ticket == generation.get()) runCatching { request("/cancel", JSONObject()) }
      } else {
        onMain { active(ticket); binding(origin, user, installation) }
        val permit = request("/authorize", proof(challenge, authorization, 1))
        require(permit.getInt("action_revision") == 2)
        val claimChallenge = permit.getJSONObject("claim_challenge")
        val claimPayload = validate(claimChallenge, "assistant_${control.mode}_claim", 2)
        require(JSONObject(claimPayload).getString("permit_hash") == hash(permit.getString("permit")))
        val journal = onMain { active(ticket); journal(installation, taskId) }
        val marker = JSONObject().put("task_id", taskId).put("requested_percent", percent).put("state", "outcome_unknown")
        onMain { active(ticket); write(journal, marker) }
        claimed = true // Lost claim responses are unknown, never retried.
        val claim = request("/claim", proof(claimChallenge, claimPayload, 2).put("permit", permit.getString("permit")))
        require(claim.getString("execution") == control.execution && claim.getInt("action_revision") == 3)
        val claimId = uuid(claim.getString("claim_id"))
        val claimExpiry = claim.getDouble("expires_at")
        val monotonicExpiry = SystemClock.elapsedRealtime() + ((claimExpiry * 1000 - System.currentTimeMillis()).toLong()).coerceIn(0, 15000)
        require(claimExpiry.isFinite() && claimExpiry > System.currentTimeMillis() / 1000.0 && claimExpiry <= System.currentTimeMillis() / 1000.0 + 20)
        onMain {
          active(ticket); enabled(); binding(origin, user, installation)
          check(SystemClock.elapsedRealtime() < monotonicExpiry && System.currentTimeMillis() / 1000.0 < claimExpiry)
          val observation = control.apply(context(), requireNotNull(activity()), percent, limits)
          observed = observation.second
          outcome = observation.first
          marker.put("state", outcome).put("claim_id", claimId).put("observed_index", observed ?: JSONObject.NULL).put("max_index", if (observed == null) JSONObject.NULL else limits.second)
          write(journal, marker)
        }
        val result = JSONObject().put("expected_revision", 3).put("claim_id", claimId).put("outcome", outcome)
          .put("observed_index", observed ?: JSONObject.NULL).put("max_index", if (observed == null) JSONObject.NULL else limits.second)
        runCatching {
          val receiptChallenge = request("/receipt-challenge", result)
          val receiptPayload = validate(receiptChallenge, "assistant_${control.mode}_receipt", 3)
          val fields = JSONObject(receiptPayload)
          for (key in listOf("claim_id", "outcome", "observed_index", "max_index")) require(fields.get(key) == result.get(key))
          result.put("challenge_id", receiptChallenge.getString("challenge_id")).put("signature", sign(installation, receiptPayload))
          val receipt = request("/receipt", result)
          require(receipt.getString("state") == outcome && receipt.getString("task_id") == taskId)
          recorded = true
        }
      }
    } catch (_: Exception) {
      outcome = if (claimed) "outcome_unknown" else if (ticket != generation.get()) "cancelled" else "failed"
    } finally { running.set(false) }
    return mapOf("outcome" to outcome, "requested_percent" to percent, "observed_percent" to
      (if (observed != null && maximum != null) requireNotNull(observed) * 100 / requireNotNull(maximum) else null),
      "receipt_recorded" to recorded)
  }
}
