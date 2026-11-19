package ai.contexify.security

import org.json.JSONArray
import org.json.JSONObject

internal object ReminderJSON {
  fun fields(value: JSONObject, names: Set<String>) { require(value.keys().asSequence().toSet() == names) }
  fun parse(encoded: String): JSONObject {
    require(encoded.toByteArray(Charsets.UTF_8).size <= 4096)
    return JSONObject(encoded)
  }
  fun schedule(value: JSONObject, now: Long): ReminderSchedule {
    fields(value, setOf("title", "date", "time", "zone", "repeat", "until", "overlap"))
    for (field in listOf("title", "date", "time", "zone", "repeat", "overlap")) require(value.get(field) is String)
    require(value.isNull("until") || value.get("until") is String)
    return ReminderSchedule.resolve(value.getString("title"), value.getString("date"), value.getString("time"),
      value.getString("zone"), value.getString("repeat"), if (value.isNull("until")) null else value.getString("until"),
      value.getString("overlap"), now)
  }
  fun details(id: String, value: ReminderSchedule): JSONObject = JSONObject().put("reminder_id", id)
    .put("title", value.title).put("date", value.date).put("time", value.time).put("zone", value.zone)
    .put("repeat", value.repeat).put("until", value.until ?: JSONObject.NULL).put("overlap", value.overlap)
    .put("occurrences", JSONArray(value.occurrences))
}
