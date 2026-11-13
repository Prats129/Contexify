package ai.contexify.security

import org.json.JSONObject
import java.security.MessageDigest
import java.util.UUID

/** Compiled allowlist. These payloads can authorize simulations only. */
internal object SimulationPolicy {
  data class Envelope(val fields: JSONObject, val snapshot: String, val revision: Int, val label: String)
  private fun exactKeys(value: JSONObject, keys: Set<String>) {
    require(value.keys().asSequence().toSet() == keys) { "Unsupported simulation fields." }
  }
  private fun integer(value: Any): Int {
    require(value is Int || value is Long)
    val number = (value as Number).toLong()
    require(number in 0..Int.MAX_VALUE.toLong())
    return number.toInt()
  }
  fun validate(payload: String): Envelope {
    require(payload.toByteArray(Charsets.UTF_8).size <= 2048)
    val data = JSONObject(payload)
    val purpose = data.getString("purpose")
    val base = setOf("protocol_version", "mode", "purpose", "policy_version", "origin", "user_id",
      "device_id", "installation_id", "public_key", "session_hash", "task_id", "action_id",
      "action_revision", "arguments_json", "arguments_digest", "nonce", "challenge_id", "expires_at")
    val extra = when (purpose) {
      "assistant_simulation_authorize" -> emptySet()
      "assistant_simulation_claim" -> setOf("permit_hash")
      "assistant_simulation_receipt" -> setOf("claim_id", "outcome")
      else -> throw IllegalArgumentException("Unsupported signing purpose.")
    }
    exactKeys(data, base + extra)
    require(data.getString("mode") == "simulation" && integer(data.get("protocol_version")) == 1 &&
      integer(data.get("policy_version")) == 1)
    val now = System.currentTimeMillis() / 1000.0
    val expiry = data.getDouble("expires_at")
    require(expiry.isFinite() && expiry > now && expiry <= now + 65)
    for (key in listOf("task_id", "action_id", "device_id", "installation_id", "challenge_id") +
      if (purpose == "assistant_simulation_receipt") listOf("claim_id") else emptyList()) {
      val value = data.getString(key)
      require(UUID.fromString(value).toString() == value)
    }
    require(Regex("[A-Za-z0-9_-]{43}").matches(data.getString("nonce")))
    require(Regex("[a-f0-9]{64}").matches(data.getString("session_hash")))
    if (purpose == "assistant_simulation_claim") require(Regex("[a-f0-9]{64}").matches(data.getString("permit_hash")))
    if (purpose == "assistant_simulation_receipt") require(data.getString("outcome") in listOf("simulated", "failed", "outcome_unknown"))
    val encoded = data.getString("arguments_json")
    val digest = MessageDigest.getInstance("SHA-256").digest(encoded.toByteArray(Charsets.UTF_8))
      .joinToString("") { "%02x".format(it.toInt() and 255) }
    require(digest == data.getString("arguments_digest"))
    val action = JSONObject(encoded)
    val capability = action.getString("capability_id")
    require(integer(action.get("schema_version")) == 1)
    val label = when (capability) {
      "media_volume.set", "brightness.set_app" -> {
        exactKeys(action, setOf("capability_id", "schema_version", "percent"))
        val percent = integer(action.get("percent"))
        require(percent in (if (capability == "media_volume.set") 0..70 else 10..100))
        if (capability == "media_volume.set") "Set media volume to $percent%" else "Set app brightness to $percent%"
      }
      "application.open" -> {
        exactKeys(action, setOf("capability_id", "schema_version", "application_id"))
        val application = action.getString("application_id")
        require(application in listOf("spotify", "clock"))
        "Open $application"
      }
      else -> throw IllegalArgumentException("Unregistered simulation capability.")
    }
    val snapshotKeys = listOf("origin", "user_id", "device_id", "installation_id", "public_key", "session_hash",
      "task_id", "action_id", "arguments_digest", "arguments_json")
    val snapshot = org.json.JSONArray(snapshotKeys.map { data.getString(it) }).toString()
    return Envelope(data, snapshot, integer(data.get("action_revision")), label)
  }
}
