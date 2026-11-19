package ai.contexify.security

import java.text.Normalizer
import java.time.DateTimeException
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId

internal class ReminderInputException(val reason: String) : IllegalArgumentException(reason)

/** Native time authority. Dates are explicit; model guesses never become schedules. */
internal data class ReminderSchedule(
  val title: String,
  val date: String,
  val time: String,
  val zone: String,
  val repeat: String,
  val until: String?,
  val overlap: String,
  val occurrences: List<Long>,
) {
  companion object {
    const val MAX_ACTIVE = 64
    const val HORIZON_DAYS = 90L
    const val HISTORY_DAYS = 7L
    fun resolve(title: String, date: String, time: String, zone: String, repeat: String,
      until: String?, overlap: String, now: Long): ReminderSchedule {
      fun ensure(value: Boolean, reason: String) { if (!value) throw ReminderInputException(reason) }
      val normalized = Normalizer.normalize(title.trim(), Normalizer.Form.NFC)
      ensure(normalized.codePointCount(0, normalized.length) in 1..120 && normalized.toByteArray(Charsets.UTF_8).size <= 512 &&
        normalized.none { it.code < 32 || it.code in 127..159 || it.code in 0x202a..0x202e || it.code in 0x2066..0x2069 }, "title")
      ensure(Regex("[0-9]{4}-[0-9]{2}-[0-9]{2}").matches(date) && Regex("[0-9]{2}:[0-9]{2}").matches(time), "date_time")
      ensure(zone in ZoneId.getAvailableZoneIds() && zone.length <= 64, "zone")
      ensure(repeat in setOf("none", "daily", "weekly") && overlap in setOf("ask", "earlier", "later"), "repeat")
      try {
        val first = LocalDate.parse(date)
        val clock = LocalTime.parse(time)
        val selectedZone = ZoneId.of(zone)
        val last = if (repeat == "none") {
          ensure(until == null, "repeat")
          first
        } else {
          ensure(until != null && Regex("[0-9]{4}-[0-9]{2}-[0-9]{2}").matches(until), "until")
          LocalDate.parse(requireNotNull(until))
        }
        ensure(!last.isBefore(first) && !last.isAfter(first.plusDays(HORIZON_DAYS)), "until")
        val horizon = Instant.ofEpochMilli(now).plusSeconds(HORIZON_DAYS * 86400).toEpochMilli()
        val times = mutableListOf<Long>()
        var day = first
        while (!day.isAfter(last)) {
          val local = LocalDateTime.of(day, clock)
          val offsets = selectedZone.rules.getValidOffsets(local)
          ensure(day != first || offsets.isNotEmpty(), "dst_gap")
          if (offsets.isNotEmpty()) {
            ensure(offsets.size == 1 || overlap != "ask", "dst_overlap")
            val offset = if (overlap == "later") offsets.last() else offsets.first()
            val instant = local.toInstant(offset).toEpochMilli()
            ensure(instant >= now + 60000 && instant <= horizon, "horizon")
            times.add(instant)
          } // Future nonexistent wall-clock occurrences are explicitly skipped.
          if (repeat == "none") break
          day = day.plusDays(if (repeat == "weekly") 7 else 1)
        }
        ensure(times.isNotEmpty() && times.size <= 91, "repeat")
        return ReminderSchedule(normalized, date, time, zone, repeat, until, overlap, times.toList())
      } catch (_: DateTimeException) { throw ReminderInputException("date_time") }
    }
  }
  fun summary(): String = "$date $time ($zone)\n" + when (repeat) {
    "daily" -> "Daily through $until."
    "weekly" -> "Weekly through $until."
    else -> "Once."
  } + "\n${occurrences.size} approved occurrence(s). Times stay fixed if you travel.\n" +
    "DST gaps are skipped; repeated hours use ${if (overlap == "later") "the second time" else "the first time"}.\n" +
    "Alerts are approximate and Android may delay them. Details stay hidden in notifications."
}
