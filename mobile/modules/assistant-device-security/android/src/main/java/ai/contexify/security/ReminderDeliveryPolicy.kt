package ai.contexify.security

/** Pure decisions used by the Android receiver; no delivery claims or retries of uncertainty. */
internal object ReminderDeliveryPolicy {
  const val GRACE_MILLIS = 86400000L
  enum class Due { IGNORE, REQUEUE, MISSED, BLOCKED, NOTIFY }
  fun due(row: ReminderEntry, now: Long, presentedNonce: String, notificationsAllowed: Boolean): Due = when {
    row.state != "scheduled" || presentedNonce != row.nonce -> Due.IGNORE
    now < row.times[row.index] -> Due.REQUEUE
    now > row.times[row.index] + GRACE_MILLIS -> Due.MISSED
    !notificationsAllowed -> Due.BLOCKED
    else -> Due.NOTIFY
  }
  fun next(row: ReminderEntry, now: Long): Int? = row.times.indices.firstOrNull { it > row.index && row.times[it] > now }
  fun validateTransition(old: ReminderEntry, next: ReminderEntry) {
    check(old.id == next.id && old.times == next.times && old.task == next.task && next.revision == old.revision + 1)
    check(next.body == old.body || next.body == null)
    val allowed = when (old.state) {
      "schedule_unknown" -> setOf("scheduled", "cancelled", "expired")
      "scheduled" -> setOf("notification_unknown", "missed", "blocked", "cancelled", "expired")
      "notification_unknown" -> setOf("notification_requested", "schedule_unknown", "cancelled")
      "notification_requested", "missed", "blocked" -> setOf("cancelled", "expired")
      else -> emptySet()
    }
    check(next.state in allowed)
    if (old.state == "notification_unknown" && next.state == "schedule_unknown") {
      check(next.index > old.index && next.nonce != old.nonce && next.lastOutcome == "notification_requested")
    } else check(next.index == old.index && next.nonce == old.nonce)
    if (next.state in setOf("cancelled", "expired")) check(next.body == null)
  }
}
