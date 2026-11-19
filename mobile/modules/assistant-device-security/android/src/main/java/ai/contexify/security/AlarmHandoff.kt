package ai.contexify.security

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.provider.AlarmClock
import java.security.MessageDigest
import java.security.SecureRandom
import java.text.Normalizer
import java.time.Instant
import java.time.ZoneId
import org.json.JSONArray
import org.json.JSONObject

internal data class AlarmTarget(val app: ApplicationTarget, val request: AlarmRequest,
  val zone: String, val next: Long?, val commitment: String) {
  fun action() = JSONObject().put("capability_id", "alarm.handoff").put("schema_version", 1)
    .put("request_kind", request.kind).put("package_id", app.packageId).put("commitment", commitment)
  fun disclosure(): String {
    val detail = if (next == null) "Show existing alarms. Change or cancel them in Clock."
      else "Request ${Instant.ofEpochMilli(next).atZone(ZoneId.of(zone))}.\n" +
        (if (request.days.isEmpty()) "Once." else "Repeat on: " + request.days.sorted().joinToString { listOf("", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday")[it] } + ".") +
        (if (request.label.isEmpty()) "" else "\nLabel: ${request.label}")
    return "$detail\n\nSend to ${ReviewedApplications.label(app.packageId)} (${app.packageId})?\n\n" +
      (if (next == null) "Review, change or cancel alarms there. " else "Clock may create or reuse an alarm immediately. Verify its time, repetition and sound there. ") +
      "Clock controls ringing, label visibility, daylight-saving and travel behaviour. Contexify cannot verify or cancel its alarms. " +
      "Signing out of Contexify does not remove Clock alarms. No other actions continue in the background."
  }
}

internal object AlarmHandoff {
  private fun action(kind: String) = when (kind) {
    "set_alarm" -> AlarmClock.ACTION_SET_ALARM
    "show_alarms" -> AlarmClock.ACTION_SHOW_ALARMS
    else -> throw AlarmInputException("kind")
  }
  fun parse(encoded: String): AlarmRequest {
    require(encoded.toByteArray(Charsets.UTF_8).size <= 2048)
    val value = JSONObject(encoded)
    require(value.keys().asSequence().toSet() == setOf("kind", "time", "label", "days", "clock"))
    listOf("kind", "time", "label", "clock").forEach { require(value.get(it) is String) }
    val days = value.getJSONArray("days")
    require(days.length() <= 7)
    return AlarmRequest(value.getString("kind"), value.getString("time"),
      Normalizer.normalize(value.getString("label").trim(), Normalizer.Form.NFC),
      (0 until days.length()).map { require(days.get(it) is Int); days.getInt(it) }.sorted(), value.getString("clock"))
  }
  fun resolve(context: Context, request: AlarmRequest): AlarmTarget {
    val zone = ZoneId.systemDefault()
    val next = request.next(System.currentTimeMillis(), zone)
    val app = ApplicationHandoff.resolveClock(context, action(request.kind), AlarmRequest.clocks[request.clock])
    val payload = JSONObject().put("kind", request.kind).put("time", request.time).put("label", request.label)
      .put("days", JSONArray(request.days)).put("zone", zone.id).put("next", next ?: JSONObject.NULL).toString()
    val salt = ByteArray(32).also { SecureRandom().nextBytes(it) }
    val commitment = MessageDigest.getInstance("SHA-256").digest(salt + payload.toByteArray(Charsets.UTF_8))
      .joinToString("") { "%02x".format(it.toInt() and 255) }
    return AlarmTarget(app, request, zone.id, next, commitment)
  }
  fun launch(context: Context, activity: Activity, target: AlarmTarget) {
    check(ZoneId.systemDefault().id == target.zone && target.request.next(System.currentTimeMillis(), ZoneId.of(target.zone)) == target.next) {
      "The alarm time or time zone changed. Review a new request."
    }
    check(ApplicationHandoff.resolveClock(context, action(target.request.kind), target.app.packageId) == target.app) {
      "The Clock handler changed. Review a new request."
    }
    val intent = Intent(action(target.request.kind)).setComponent(target.app.component)
    if (target.request.kind == "set_alarm") {
      val time = target.request.time.split(':').map(String::toInt)
      intent.putExtra(AlarmClock.EXTRA_HOUR, time[0]).putExtra(AlarmClock.EXTRA_MINUTES, time[1])
        .putExtra(AlarmClock.EXTRA_SKIP_UI, false)
      if (target.request.label.isNotEmpty()) intent.putExtra(AlarmClock.EXTRA_MESSAGE, target.request.label)
      if (target.request.days.isNotEmpty()) intent.putIntegerArrayListExtra(AlarmClock.EXTRA_DAYS, ArrayList(target.request.days))
    }
    activity.startActivity(intent) // A handoff request, never verified alarm creation/ringing.
  }
}
