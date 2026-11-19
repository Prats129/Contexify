package ai.contexify.security

import java.time.Instant
import org.junit.Assert.*
import org.junit.Test

class ReminderScheduleTest {
  private val now = Instant.parse("2026-11-18T08:00:00Z").toEpochMilli()
  private fun draft(date: String = "2026-11-19", time: String = "09:00", zone: String = "Asia/Kolkata",
    repeat: String = "none", until: String? = null, overlap: String = "ask", title: String = "Synthetic reminder", clock: Long = now) =
    ReminderSchedule.resolve(title, date, time, zone, repeat, until, overlap, clock)
  private fun rejects(reason: String, call: () -> Unit) {
    try { call(); fail("Expected rejection") } catch (error: ReminderInputException) { assertEquals(reason, error.reason) }
  }
  @Test fun explicitTimeIsResolvedToTheSelectedZoneWithoutChangingForTravel() {
    assertEquals(listOf(Instant.parse("2026-11-19T03:30:00Z").toEpochMilli()), draft().occurrences)
    assertTrue(draft().summary().contains("Asia/Kolkata"))
    assertTrue(draft().summary().contains("approximate"))
  }
  @Test fun invalidPastImpossibleAndUnboundedDatesFail() {
    rejects("horizon") { draft(date = "2026-11-17") }
    rejects("horizon") { draft(date = "2027-12-01") }
    rejects("date_time") { draft(date = "2026-02-30") }
    rejects("date_time") { draft(time = "24:01") }
    rejects("date_time") { draft(time = "9:00") }
    rejects("zone") { draft(zone = "+05:30") }
    rejects("repeat") { draft(repeat = "hourly") }
    rejects("repeat") { draft(until = "2026-11-20") }
    rejects("until") { draft(repeat = "daily") }
    rejects("until") { draft(repeat = "daily", until = "2026-11-18") }
  }
  @Test fun daylightSavingGapsRejectTheInitialTimeAndSkipFutureOccurrences() {
    val spring = Instant.parse("2027-03-10T00:00:00Z").toEpochMilli()
    rejects("dst_gap") { draft("2027-03-14", "02:30", "America/New_York", clock = spring) }
    val series = draft("2027-03-13", "02:30", "America/New_York", "daily", "2027-03-15", clock = spring)
    assertEquals(2, series.occurrences.size)
    assertEquals(Instant.parse("2027-03-15T06:30:00Z").toEpochMilli(), series.occurrences.last())
  }
  @Test fun repeatedHoursRequireAnExplicitChoiceIncludingFutureSeries() {
    val autumn = Instant.parse("2027-11-01T00:00:00Z").toEpochMilli()
    rejects("dst_overlap") { draft("2027-11-07", "01:30", "America/New_York", clock = autumn) }
    rejects("dst_overlap") { draft("2027-11-06", "01:30", "America/New_York", "daily", "2027-11-08", clock = autumn) }
    val early = draft("2027-11-07", "01:30", "America/New_York", overlap = "earlier", clock = autumn)
    val late = draft("2027-11-07", "01:30", "America/New_York", overlap = "later", clock = autumn)
    assertEquals(3600000L, late.occurrences.single() - early.occurrences.single())
  }
  @Test fun dailyAndWeeklySeriesAreBoundedAndOrdered() {
    val daily = draft(repeat = "daily", until = "2026-11-22")
    assertEquals(4, daily.occurrences.size)
    assertTrue(daily.occurrences.zipWithNext().all { (a,b) -> b > a })
    assertEquals(3, draft(repeat = "weekly", until = "2026-12-03").occurrences.size)
    rejects("horizon") { draft(repeat = "daily", until = "2027-02-17") }
  }
  @Test fun titlesAreNormalizedBoundedAndCannotSpoofTheNativeConfirmation() {
    assertEquals("Synthetic reminder", draft(title = "  Synthetic reminder  ").title)
    rejects("title") { draft(title = " ") }
    rejects("title") { draft(title = "x".repeat(121)) }
    rejects("title") { draft(title = "Synthetic\nApprove") }
    rejects("title") { draft(title = "Synthetic\u202e") }
    assertEquals("\u00e9", draft(title = "e\u0301").title)
  }
}
