package ai.contexify.security

import org.junit.Assert.*
import org.junit.Test

class ReminderDeliveryPolicyTest {
  private val row = ReminderEntry("11111111-1111-4111-8111-111111111111", listOf(1000, 2000, 3000), 0,
    "scheduled", 2, "a".repeat(43), "22222222-2222-4222-8222-222222222222", null, "encrypted-body")
  private fun rejected(call: () -> Unit) { try { call(); fail("Transition must fail") } catch (_: IllegalStateException) {} }
  @Test fun staleRepeatedUnknownCancelledAndUnapprovedCallbacksNeverNotify() {
    for (state in listOf("schedule_unknown", "notification_unknown", "notification_requested", "cancelled", "missed", "blocked", "expired"))
      assertEquals(ReminderDeliveryPolicy.Due.IGNORE, ReminderDeliveryPolicy.due(row.copy(state = state), 1000, row.nonce, true))
    assertEquals(ReminderDeliveryPolicy.Due.IGNORE, ReminderDeliveryPolicy.due(row, 1000, "b".repeat(43), true))
  }
  @Test fun earlyLateAndPermissionDeniedHaveDistinctNonDeliveryStates() {
    assertEquals(ReminderDeliveryPolicy.Due.REQUEUE, ReminderDeliveryPolicy.due(row, 999, row.nonce, true))
    assertEquals(ReminderDeliveryPolicy.Due.MISSED, ReminderDeliveryPolicy.due(row, 1001 + ReminderDeliveryPolicy.GRACE_MILLIS, row.nonce, true))
    assertEquals(ReminderDeliveryPolicy.Due.BLOCKED, ReminderDeliveryPolicy.due(row, 1000, row.nonce, false))
    assertEquals(ReminderDeliveryPolicy.Due.NOTIFY, ReminderDeliveryPolicy.due(row, 1000, row.nonce, true))
  }
  @Test fun recurringAlertsSkipPastInstantsInsteadOfReplayingThem() {
    assertEquals(2, ReminderDeliveryPolicy.next(row, 2500))
    assertNull(ReminderDeliveryPolicy.next(row, 4000))
  }
  @Test fun encryptedUnknownMustPrecedeNotificationAndContentRemainsReadableUntilDeletion() {
    val unknown = row.copy(state = "notification_unknown", revision = 3)
    ReminderDeliveryPolicy.validateTransition(row, unknown)
    rejected { ReminderDeliveryPolicy.validateTransition(row, row.copy(state = "notification_requested", revision = 3, body = null)) }
    ReminderDeliveryPolicy.validateTransition(unknown, unknown.copy(state = "notification_requested", revision = 4))
    rejected { ReminderDeliveryPolicy.validateTransition(unknown, unknown.copy(state = "cancelled", revision = 4)) }
    ReminderDeliveryPolicy.validateTransition(unknown, unknown.copy(state = "notification_requested", revision = 4, body = null))
  }
  @Test fun onlyAnApprovedFutureOccurrenceCanFollowACompletedNotificationRequest() {
    val unknown = row.copy(state = "notification_unknown", revision = 3)
    val future = unknown.copy(state = "schedule_unknown", revision = 4, index = 1, nonce = "b".repeat(43), lastOutcome = "notification_requested")
    ReminderDeliveryPolicy.validateTransition(unknown, future)
    ReminderDeliveryPolicy.validateTransition(future, future.copy(state = "scheduled", revision = 5))
    rejected { ReminderDeliveryPolicy.validateTransition(unknown, future.copy(index = 0)) }
    rejected { ReminderDeliveryPolicy.validateTransition(unknown, future.copy(nonce = row.nonce)) }
    rejected { ReminderDeliveryPolicy.validateTransition(unknown, future.copy(times = listOf(1000, 2500, 3000))) }
    rejected { ReminderDeliveryPolicy.validateTransition(future, future.copy(state = "scheduled", revision = 5, body = "swapped")) }
  }
}
