package ai.contexify.security

import org.junit.Assert.*
import org.junit.Test
import javax.crypto.KeyGenerator

class OperationPlanTest {
  private val id = "11111111-1111-4111-8111-111111111111"
  private val plan get() = OperationPlan(id, 1, 10000, listOf(
    OperationStep(0, "media_volume.set", 50, emptyList()), OperationStep(1, "brightness.set_app", 40, listOf(0))))
  private class MemoryStore : PlanStore {
    var row: PlanCheckpoint? = null
    var failSave = false
    override fun create(plan: OperationPlan): PlanCheckpoint {
      check(row == null)
      return PlanCheckpoint(plan.id, plan.revision, plan.digest, plan.expiresAt, 1,
        plan.steps.map { it.capability }, plan.steps.map { it.percent }, plan.steps.map { "pending" }, plan.steps.map { null })
        .also { row = it }
    }
    override fun save(expected: Int, next: PlanCheckpoint) {
      check(!failSave && row?.version == expected && next.version == expected + 1)
      row = next
    }
  }
  private fun verified(step: OperationStep, receipt: Boolean = true) = StepEvidence("verified", step.percent, step.percent, receipt)
  private fun fails(block: () -> Unit) {
    try { block(); fail("Expected rejection") } catch (_: IllegalArgumentException) {} catch (_: IllegalStateException) {}
  }
  @Test fun wholeGraphValidationPrecedesEveryEffect() {
    for (steps in listOf(
      listOf(plan.steps[0], OperationStep(1, "application.open", 50, listOf(0))),
      listOf(plan.steps[0], OperationStep(0, "media_volume.set", 40, emptyList())),
      listOf(OperationStep(0, "media_volume.set", 50, listOf(1)), plan.steps[1]),
      listOf(plan.steps[0], OperationStep(1, "media_volume.set", 40, listOf(0, 0))),
      listOf(plan.steps[0], OperationStep(1, "media_volume.set", 90, listOf(0))),
      List(6) { OperationStep(it, "media_volume.set", 40, emptyList()) }
    )) {
      val store = MemoryStore()
      fails { PlanCoordinator(store, { 1 }, { false }).execute(plan.copy(steps = steps)) { error("Effect must not run") } }
      assertNull(store.row)
    }
  }
  @Test fun stepsHaveStableScopedIdentityAndCanonicalDigest() {
    assertEquals("v2_${id}_1_0", OperationIdentity(id, 1, 0).key)
    assertNotEquals(OperationIdentity(id, 1, 0).key, OperationIdentity(id, 1, 1).key)
    assertNotEquals(plan.digest, plan.copy(revision = 2).digest)
    assertNotEquals(plan.digest, plan.copy(steps = listOf(plan.steps[0].copy(percent = 40))).digest)
    fails { OperationIdentity(id, 0, 0) }
    fails { plan.copy(contextId = id).validate(1) }
  }
  @Test fun eachEffectRequiresPriorDurableUnknownAndFreshPerStepConfirmation() {
    val store = MemoryStore()
    val calls = mutableListOf<Int>()
    val result = PlanCoordinator(store, { 1 }, { false }).execute(plan) {
      assertEquals("outcome_unknown", store.row!!.states[it.id])
      calls.add(it.id); verified(it)
    }
    assertEquals(listOf(0, 1), calls)
    assertEquals(listOf("verified", "verified"), result.states)
    assertEquals(5, result.version)
    fails { PlanCoordinator(store, { 1 }, { false }).execute(plan) { error("Duplicate execution") } }
  }
  @Test fun failureUnknownCancelAndLostReceiptStopEvenIndependentFollowingSteps() {
    for (outcome in listOf("failed", "outcome_unknown", "cancelled", "verified")) {
      val store = MemoryStore()
      var calls = 0
      val result = PlanCoordinator(store, { 1 }, { false }).execute(plan.copy(steps = plan.steps.map { it.copy(dependencies = emptyList()) })) {
        calls++; StepEvidence(outcome, it.percent, if (outcome == "verified") it.percent else null, false)
      }
      assertEquals(1, calls)
      assertEquals(listOf(outcome, "skipped"), result.states)
    }
  }
  @Test fun cancellationAndExpiryPreventFollowingSteps() {
    for (expired in listOf(false, true)) {
      var time = 1L
      var stopped = false
      val result = PlanCoordinator(MemoryStore(), { time }, { stopped }).execute(plan) {
        if (expired) time = 10001 else stopped = true
        verified(it)
      }
      assertEquals(listOf("verified", "skipped"), result.states)
    }
    fails { plan.validate(10000) }
  }
  @Test fun interruptedDispatchCannotBeResumedAfterRestart() {
    val store = MemoryStore()
    fails { PlanCoordinator(store, { 1 }, { false }).execute(plan) { throw IllegalStateException("Lost response") } }
    assertEquals(listOf("outcome_unknown", "pending"), store.row!!.states)
    fails { PlanCoordinator(store, { 1 }, { false }).execute(plan) { error("Restart replay") } }
    fails { PlanCoordinator(store, { 1 }, { false }).execute(plan.copy(revision = 2)) { error("Revision replay") } }
  }
  @Test fun journalFailureAndStaleCompareAndSwapFailBeforeAnEffect() {
    val store = MemoryStore().apply { failSave = true }
    fails { PlanCoordinator(store, { 1 }, { false }).execute(plan) { error("Unjournaled effect") } }
    val row = store.row!!
    fails { row.transition(row.version + 1, 0, "outcome_unknown") }
  }
  @Test fun authenticatedEncryptionRejectsTamperingWrongKeyAndCrossAccountBinding() {
    val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    val other = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    val plain = "minimal recovery metadata".toByteArray()
    val binding = "installation/account/origin/plan".toByteArray()
    val sealed = RecoveryCipher.seal(plain, key, binding)
    assertArrayEquals(plain, RecoveryCipher.open(sealed, key, binding))
    assertFalse(sealed.contentEquals(RecoveryCipher.seal(plain, key, binding)))
    for (attempt in listOf<() -> Unit>(
      { RecoveryCipher.open(sealed, other, binding) },
      { RecoveryCipher.open(sealed, key, "another account".toByteArray()) },
      { RecoveryCipher.open(sealed.copyOf().apply { this[lastIndex] = (this[lastIndex].toInt() xor 1).toByte() }, key, binding) }
    )) {
      try { attempt(); fail("Authentication must fail") } catch (_: javax.crypto.AEADBadTagException) {}
    }
    fails { RecoveryCipher.open(ByteArray(2), key, binding) }
    fails { RecoveryCipher.seal(ByteArray(16385), key, binding) }
  }
}
