package ai.contexify.security

import java.text.Normalizer
import java.time.DateTimeException
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId

internal class AlarmInputException(val reason: String) : IllegalArgumentException(reason)

/** Explicit private input, independent of any model. Clock owns the resulting alarm. */
internal data class AlarmRequest(val kind: String, val time: String, val label: String,
  val days: List<Int>, val clock: String) {
  companion object {
    val clocks = mapOf("google" to "com.google.android.deskclock", "android" to "com.android.deskclock",
      "samsung" to "com.sec.android.app.clockpackage")
  }
  init {
    fun ensure(value: Boolean, reason: String) { if (!value) throw AlarmInputException(reason) }
    ensure(kind in setOf("set_alarm", "show_alarms"), "kind")
    ensure(clock == "auto" || clocks.containsKey(clock), "clock")
    ensure(days.size <= 7 && days.distinct().size == days.size && days.all { it in 1..7 }, "days")
    ensure(label == Normalizer.normalize(label.trim(), Normalizer.Form.NFC) &&
      label.codePointCount(0, label.length) <= 120 && label.toByteArray(Charsets.UTF_8).size <= 512 &&
      label.none { it.code < 32 || it.code in 127..159 || it.code in 0x202a..0x202e || it.code in 0x2066..0x2069 }, "label")
    if (kind == "show_alarms") ensure(time.isEmpty() && label.isEmpty() && days.isEmpty(), "kind")
    else {
      ensure(Regex("[0-9]{2}:[0-9]{2}").matches(time), "time")
      try { LocalTime.parse(time) } catch (_: DateTimeException) { throw AlarmInputException("time") }
    }
  }
  fun next(now: Long, zone: ZoneId): Long? {
    if (kind == "show_alarms") return null
    val current = Instant.ofEpochMilli(now).atZone(zone)
    val clockTime = LocalTime.parse(time)
    for (offset in 0L..7L) {
      val date = current.toLocalDate().plusDays(offset)
      val calendarDay = date.dayOfWeek.value % 7 + 1 // Android Calendar: Sunday = 1.
      if (days.isNotEmpty() && calendarDay !in days) continue
      val local = date.atTime(clockTime)
      val offsets = zone.rules.getValidOffsets(local)
      if (offsets.isEmpty()) {
        if (local > current.toLocalDateTime()) throw AlarmInputException("dst")
        continue
      }
      val future = offsets.map { local.toInstant(it).toEpochMilli() }.filter { it > now }
      if (future.isEmpty()) continue
      // During a clock rollback, the second occurrence may be ahead even when
      // its displayed time is earlier than the current first-occurrence clock.
      if (offsets.size != 1) throw AlarmInputException("dst")
      val instant = future.single()
      if (instant - now < 60000) throw AlarmInputException("soon")
      return instant
    }
    throw AlarmInputException("time")
  }
}
