package ai.contexify.security

import java.security.MessageDigest
import java.util.UUID

/** Immutable, compiled settings graph. Model proposals are never execution authority. */
internal data class OperationStep(val id: Int, val capability: String, val percent: Int?, val dependencies: List<Int>, val applicationId: String? = null) {
  fun validate(index: Int) {
    require(id == index && dependencies.distinct().size == dependencies.size && dependencies.all { it in 0 until id })
    when (capability) {
      "media_volume.set" -> require(percent != null && percent in 0..70 && applicationId == null)
      "brightness.set_app" -> require(percent != null && percent in 10..100 && applicationId == null)
      "application.open" -> require(percent == null && applicationId in setOf("spotify", "clock"))
      else -> throw IllegalArgumentException("The entire plan must have compiled handlers.")
    }
  }
}

internal data class OperationIdentity(val planId: String, val revision: Int, val stepId: Int) {
  init {
    require(UUID.fromString(planId).toString() == planId && UUID.fromString(planId).version() == 4)
    require(revision in 1..1000 && stepId in 0..4)
  }
  val key: String get() = "v2_${planId}_${revision}_${stepId}"
}

internal data class OperationPlan(val id: String, val revision: Int, val expiresAt: Long,
  val steps: List<OperationStep>, val contextId: String? = null) {
  fun validate(now: Long) {
    OperationIdentity(id, revision, 0)
    require(expiresAt > now && expiresAt <= now + 185000)
    require(steps.size in 1..5)
    steps.forEachIndexed { index, step ->
      step.validate(index)
      // Handoff backgrounds this app. No background continuation or implicit resume.
      require(step.capability != "application.open" || index == steps.lastIndex)
    }
    if (contextId != null) {
      require(UUID.fromString(contextId).toString() == contextId)
      require(steps.size == 1 && steps[0].capability == "media_volume.set")
    }
  }
  val digest: String get() {
    val value = "$id\n$revision\n$expiresAt\n${contextId.orEmpty()}\n" + steps.joinToString("\n") {
      "${it.id}:${it.capability}:${it.percent}:${it.dependencies.joinToString(",")}${it.applicationId?.let { id -> ":$id" }.orEmpty()}"
    }
    return MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
      .joinToString("") { "%02x".format(it.toInt() and 255) }
  }
}

internal data class StepEvidence(val outcome: String, val requested: Int?, val observed: Int?, val recorded: Boolean,
  val applicationId: String? = null, val packageId: String? = null) {
  init {
    require(outcome in setOf("verified", "failed", "outcome_unknown", "cancelled", "handoff_requested"))
    if (applicationId != null) {
      require(requested == null && observed == null && outcome != "verified")
      require(ReviewedApplications.valid(applicationId, requireNotNull(packageId)))
    } else {
      require(packageId == null && requested != null && requested in 0..100 && (observed == null || observed in 0..100))
      require(outcome != "handoff_requested")
    }
    require(outcome != "verified" || observed != null)
  }
  fun bridge(): Map<String, Any?> = if (applicationId != null) mapOf("outcome" to outcome,
    "application_id" to applicationId, "package_id" to packageId, "receipt_recorded" to recorded)
    else mapOf("outcome" to outcome, "requested_percent" to requested,
    "observed_percent" to observed, "receipt_recorded" to recorded)
}

internal data class PlanCheckpoint(val id: String, val planRevision: Int, val digest: String, val expiresAt: Long,
  val version: Int, val capabilities: List<String>, val percents: List<Int?>,
  val states: List<String>, val evidence: List<StepEvidence?>,
  val applications: List<String?> = capabilities.map { null }) {
  fun transition(expected: Int, step: Int, state: String, result: StepEvidence? = null): PlanCheckpoint {
    check(expected == version && step in states.indices)
    check((states[step] == "pending" && state in setOf("outcome_unknown", "skipped")) ||
      (states[step] == "outcome_unknown" && state in setOf("verified", "failed", "cancelled", "outcome_unknown", "handoff_requested")))
    return copy(version = version + 1, states = states.mapIndexed { i, old -> if (i == step) state else old },
      evidence = evidence.mapIndexed { i, old -> if (i == step) result else old })
  }
  fun bridge(): Map<String, Any?> = mapOf("protocol_version" to 2, "plan_id" to id, "plan_revision" to planRevision,
    "revision" to version, "steps" to states.mapIndexed { i, state -> mapOf("step_id" to i, "capability_id" to capabilities[i], "state" to state, "result" to evidence[i]?.bridge()) })
}

internal interface PlanStore {
  fun create(plan: OperationPlan): PlanCheckpoint
  fun save(expected: Int, next: PlanCheckpoint)
}

/** Stop the WHOLE remaining plan on a failure, unknown, cancellation or lost receipt.
 * There is deliberately no resume/retry API. Reconciliation never invokes this class.
 */
internal class PlanCoordinator(private val store: PlanStore, private val now: () -> Long, private val stopped: () -> Boolean) {
  fun execute(plan: OperationPlan, effect: (OperationStep) -> StepEvidence): PlanCheckpoint {
    plan.validate(now()) // Validate all support/dependencies before reserving or dispatching any step.
    var checkpoint = store.create(plan) // Durable encrypted reservation before the first effect.
    var halted = false
    for (step in plan.steps) {
      fun update(state: String, result: StepEvidence? = null) {
        val next = checkpoint.transition(checkpoint.version, step.id, state, result)
        store.save(checkpoint.version, next)
        checkpoint = next
      }
      if (halted || stopped() || now() >= plan.expiresAt || step.dependencies.any { checkpoint.states[it] != "verified" }) {
        update("skipped")
        halted = true
        continue
      }
      // A crash anywhere from dispatch through durable result recording stays unknown.
      update("outcome_unknown")
      val result = effect(step)
      check(result.requested == step.percent && result.applicationId == step.applicationId)
      update(result.outcome, result)
      halted = result.outcome != "verified" || !result.recorded || stopped()
    }
    return checkpoint
  }
}
