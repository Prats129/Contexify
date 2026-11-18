package ai.contexify.security

import android.os.SystemClock
import java.net.URI
import java.net.URL
import java.security.MessageDigest
import java.util.UUID
import javax.net.ssl.HttpsURLConnection
import org.json.JSONObject

/** Shared, fixed-origin control protocol. No redirects, retries or model-selected paths. */
internal class NativeControlProtocol(
  private val mode: String,
  private val capability: String,
  private val generation: () -> Long,
  private val binding: (String, String, String) -> Unit,
  private val publicKey: (String) -> String,
) {
  init { require(mapOf("volume" to "media_volume.set", "brightness" to "brightness.set_app", "application" to "application.open")[mode] == capability) }
  private fun hash(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
    .joinToString("") { "%02x".format(it.toInt() and 255) }
  private fun uuid(value: String): String { require(UUID.fromString(value).toString() == value); return value }
  companion object {
    fun validateOrigin(origin: String) {
      val uri = URI(origin)
      require(uri.scheme == "https" && uri.host != null && uri.rawPath.orEmpty().isEmpty() && uri.port in listOf(-1, 443) &&
        uri.userInfo == null && uri.query == null && uri.fragment == null && origin == "https://" + uri.rawAuthority)
    }
  }
  fun post(origin: String, token: String, path: String, body: JSONObject, ticket: Long, deadline: Long): JSONObject {
    validateOrigin(origin)
    check(ticket == generation() && SystemClock.elapsedRealtime() < deadline)
    require(Regex("[A-Za-z0-9_-]{43}").matches(token))
    val connection = URL(origin + "/api/v1/assistant/${mode}" + path).openConnection() as HttpsURLConnection
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
      check(ticket == generation())
      return response
    } finally { connection.disconnect() }
  }

  fun envelope(challenge: JSONObject, purpose: String, revision: Int, origin: String, user: String,
    installation: String, token: String, task: String, expectedAction: JSONObject): String {
    require(expectedAction.getString("capability_id") == capability && expectedAction.get("schema_version") == 1)
    val payload = challenge.getString("payload")
    require(payload.toByteArray(Charsets.UTF_8).size <= 4096)
    val fields = JSONObject(payload)
    val base = setOf("protocol_version", "mode", "policy_version", "purpose", "origin", "user_id", "device_id",
      "installation_id", "public_key", "session_hash", "task_id", "action_revision", "arguments_json",
      "arguments_digest", "nonce", "challenge_id", "expires_at")
    val extra = when (purpose) {
      "assistant_${mode}_authorize" -> emptySet()
      "assistant_${mode}_claim" -> setOf("permit_hash")
      "assistant_${mode}_receipt" -> setOf("claim_id", "outcome") + if (mode == "application") emptySet() else setOf("observed_index", "max_index")
      else -> throw IllegalArgumentException("Unsupported device-control purpose.")
    }
    require(fields.keys().asSequence().toSet() == base + extra)
    require(fields.get("protocol_version") == 1 && fields.get("policy_version") == 1 && fields.get("action_revision") == revision)
    require(fields.getString("mode") == mode && fields.getString("purpose") == purpose)
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
    require(action.keys().asSequence().toSet() == expectedAction.keys().asSequence().toSet())
    expectedAction.keys().forEach { key -> require(action.get(key) == expectedAction.get(key)) }
    return payload
  }

}
