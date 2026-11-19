package ai.contexify.security

import java.time.Instant
import java.time.ZoneId
import org.junit.Assert.*
import org.junit.Test

class AlarmRequestTest {
  private val zone = ZoneId.of("Asia/Kolkata")
  private val now = Instant.parse("2026-11-19T05:00:00Z").toEpochMilli()
  private fun request(time: String = "10:40", days: List<Int> = emptyList()) = AlarmRequest("set_alarm", time, "Test", days, "samsung")
  private fun rejected(block: () -> Unit) {
    try { block(); fail("Expected explicit input rejection") } catch (_: AlarmInputException) { }
  }
  @Test fun nextOccurrenceUsesDeviceZoneAndMovesPastTimeToTomorrow() {
    assertEquals(now + 600000, request().next(now, zone))
    assertEquals(Instant.parse("2026-11-20T04:30:00Z").toEpochMilli(), request("10:00").next(now, zone))
  }
  @Test fun repeatDaysUseAndroidCalendarNumbers() {
    assertEquals(Instant.parse("2026-11-23T03:30:00Z").toEpochMilli(), request("09:00", listOf(2)).next(now, zone))
    assertEquals(Instant.parse("2026-11-22T03:30:00Z").toEpochMilli(), request("09:00", listOf(1)).next(now, zone))
  }
  @Test fun shortApprovalWindowRequiresReviewInsteadOfChangingDay() {
    rejected { request("10:31").next(now + 30000, zone) }
  }
  @Test fun ambiguousOrNonexistentDstTimeIsNeverGuessed() {
    val newYork = ZoneId.of("America/New_York")
    rejected { request("02:30").next(Instant.parse("2026-03-08T05:00:00Z").toEpochMilli(), newYork) }
    rejected { request("01:30").next(Instant.parse("2026-11-01T04:00:00Z").toEpochMilli(), newYork) }
  }
  @Test fun strictTimeAndRepeatValidation() {
    for (time in listOf("7am", "24:00", "07:60", "7:00", "-1:00")) rejected { request(time) }
    rejected { request(days = listOf(2, 2)) }
    rejected { request(days = listOf(0)) }
    rejected { request(days = listOf(8)) }
  }
  @Test fun secondFoldOccurrenceIsRejectedAfterTheFirstOccurrenceHasPassed() {
    val newYork = ZoneId.of("America/New_York")
    rejected { request("01:30").next(Instant.parse("2026-11-01T05:45:00Z").toEpochMilli(), newYork) }
  }
  @Test fun labelsAndClockCatalogRemainBounded() {
    rejected { AlarmRequest("set_alarm", "07:00", "hidden\u202e", emptyList(), "auto") }
    rejected { AlarmRequest("set_alarm", "07:00", "x".repeat(121), emptyList(), "auto") }
    rejected { AlarmRequest("set_alarm", "07:00", "", emptyList(), "arbitrary.package") }
    rejected { AlarmRequest("dismiss_alarm", "", "", emptyList(), "auto") }
  }
  @Test fun showAlarmsCannotSmuggleCreationParameters() {
    assertNull(AlarmRequest("show_alarms", "", "", emptyList(), "auto").next(now, zone))
    rejected { AlarmRequest("show_alarms", "07:00", "", emptyList(), "auto") }
    rejected { AlarmRequest("show_alarms", "", "private", emptyList(), "auto") }
    rejected { AlarmRequest("show_alarms", "", "", listOf(2), "auto") }
  }
}
