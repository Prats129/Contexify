package ai.contexify.security

import org.json.JSONObject

/** Strict JSON bridge. Reject coercible values, extra fields and unsupported whole plans. */
internal object PlanProtocol {
  private fun fields(value: JSONObject, keys: Set<String>, optional: Set<String> = emptySet()) {
    val actual = value.keys().asSequence().toSet()
    require(actual.containsAll(keys) && actual.all { it in keys || it in optional })
  }
  private fun integer(value: JSONObject, key: String): Int {
    require(value.get(key) is Int)
    return value.getInt(key)
  }
  fun parse(encoded: String, now: Long): OperationPlan {
    require(encoded.toByteArray(Charsets.UTF_8).size <= 8192)
    val value = JSONObject(encoded)
    fields(value, setOf("protocol_version", "plan_id", "plan_revision", "expires_at", "steps"), setOf("context_id"))
    require(integer(value, "protocol_version") == 2 && value.get("plan_id") is String)
    val expiry = value.get("expires_at")
    require(expiry is Number && expiry.toDouble().isFinite() && expiry.toDouble() > now / 1000.0 && expiry.toDouble() <= (now + 185000) / 1000.0)
    val steps = value.getJSONArray("steps")
    require(steps.length() in 1..5)
    val parsed = (0 until steps.length()).map { i ->
      val step = steps.getJSONObject(i)
      fields(step, setOf("step_id", "depends_on", "action"))
      val dependencies = step.getJSONArray("depends_on")
      require(dependencies.length() <= 4)
      val action = step.getJSONObject("action")
      fields(action, setOf("capability_id", "percent", "schema_version"))
      require(action.get("capability_id") is String && integer(action, "schema_version") == 1)
      OperationStep(integer(step, "step_id"), action.getString("capability_id"), integer(action, "percent"),
        (0 until dependencies.length()).map { j -> require(dependencies.get(j) is Int); dependencies.getInt(j) })
    }
    val context = if (value.has("context_id")) {
      require(value.get("context_id") is String)
      value.getString("context_id")
    } else null
    return OperationPlan(value.getString("plan_id"), integer(value, "plan_revision"),
      (expiry.toDouble() * 1000).toLong(), parsed, context).also { it.validate(now) }
  }
  fun evidence(value: Map<String, Any?>): StepEvidence {
    require(value.keys == setOf("outcome", "requested_percent", "observed_percent", "receipt_recorded"))
    return StepEvidence(value["outcome"] as String, value["requested_percent"] as Int,
      value["observed_percent"] as Int?, value["receipt_recorded"] as Boolean)
  }
}
