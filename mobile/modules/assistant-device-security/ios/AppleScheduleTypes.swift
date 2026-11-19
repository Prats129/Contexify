import Foundation
import CryptoKit
import CoreFoundation

enum AppleScheduleFailure: Error {
  case unavailable, invalid, time, gap, overlap, limit, interrupted, unauthorized, unknown
}

enum AppleScheduleJSON {
  static func object(_ text: String, limit: Int = 4096) throws -> [String: Any] {
    guard text.utf8.count <= limit, let data = text.data(using: .utf8),
          let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw AppleScheduleFailure.invalid }
    return value
  }
  static func text(_ object: [String: Any]) throws -> String {
    let bytes = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes])
    guard let text = String(data: bytes, encoding: .utf8) else { throw AppleScheduleFailure.invalid }
    return text
  }
  static func fields(_ value: [String: Any], _ keys: Set<String>) throws {
    guard Set(value.keys) == keys else { throw AppleScheduleFailure.invalid }
  }
  static func integer(_ value: Any?) throws -> Int64 {
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
          number.doubleValue.isFinite, number.doubleValue.rounded() == number.doubleValue,
          abs(number.doubleValue) <= 9_007_199_254_740_991 else { throw AppleScheduleFailure.invalid }
    return number.int64Value
  }
  static func id(_ value: String) throws -> String {
    guard let id = UUID(uuidString: value), id.uuidString.lowercased() == value,
          value[value.index(value.startIndex, offsetBy: 14)] == "4" else { throw AppleScheduleFailure.invalid }
    return value
  }
  static func hash(_ text: String) -> String {
    SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
  }
  static func title(_ value: Any?) throws -> String {
    guard let text = value as? String, !text.isEmpty, text.count <= 120, text.utf8.count <= 512,
          text == text.trimmingCharacters(in: .whitespacesAndNewlines).precomposedStringWithCanonicalMapping,
          !text.unicodeScalars.contains(where: { $0.value < 32 || (127...159).contains($0.value)
            || (0x202a...0x202e).contains($0.value) || (0x2066...0x2069).contains($0.value) }) else { throw AppleScheduleFailure.invalid }
    return text
  }
}

struct AppleReminderDraft: Codable, Equatable {
  let title: String
  let date: String
  let time: String
  let zone: String
  let `repeat`: String
  let until: String?
  let overlap: String

  init(_ value: [String: Any]) throws {
    try AppleScheduleJSON.fields(value, ["title", "date", "time", "zone", "repeat", "until", "overlap"])
    title = try AppleScheduleJSON.title(value["title"])
    guard let date = value["date"] as? String, let time = value["time"] as? String,
          let zone = value["zone"] as? String, zone.utf8.count <= 64, TimeZone(identifier: zone) != nil,
          let cadence = value["repeat"] as? String, ["none", "daily", "weekly"].contains(cadence),
          let overlap = value["overlap"] as? String, ["ask", "earlier", "later"].contains(overlap),
          value["until"] is NSNull || value["until"] is String else { throw AppleScheduleFailure.invalid }
    self.date = date; self.time = time; self.zone = zone; self.repeat = cadence; self.overlap = overlap
    until = value["until"] as? String
    guard (cadence == "none") == (until == nil) else { throw AppleScheduleFailure.invalid }
    _ = try components(date, time)
    if let until { _ = try components(until, time) }
  }
  func dictionary() -> [String: Any] {
    ["title": title, "date": date, "time": time, "zone": zone, "repeat": self.repeat,
     "until": until as Any? ?? NSNull(), "overlap": overlap]
  }
  private func components(_ day: String, _ time: String) throws -> DateComponents {
    guard day.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil,
          time.range(of: #"^(?:[01]\d|2[0-3]):[0-5]\d$"#, options: .regularExpression) != nil else { throw AppleScheduleFailure.invalid }
    let d = day.split(separator: "-").compactMap { Int($0) }, t = time.split(separator: ":").compactMap { Int($0) }
    guard d.count == 3, t.count == 2, (2000...2200).contains(d[0]) else { throw AppleScheduleFailure.invalid }
    var result = DateComponents(); result.year = d[0]; result.month = d[1]; result.day = d[2]
    result.hour = t[0]; result.minute = t[1]; result.second = 0
    return result
  }
  func occurrences(now: Date = Date()) throws -> [Int64] {
    var cal = Calendar(identifier: .gregorian); cal.timeZone = TimeZone(identifier: zone)!
    var utc = Calendar(identifier: .gregorian); utc.timeZone = TimeZone(secondsFromGMT: 0)!
    let first = try components(date, time)
    var day = DateComponents(); day.year = first.year; day.month = first.month; day.day = first.day; day.hour = 12
    guard let start = utc.date(from: day), utc.dateComponents([.year, .month, .day], from: start).year == first.year,
          utc.component(.month, from: start) == first.month, utc.component(.day, from: start) == first.day else { throw AppleScheduleFailure.invalid }
    let endDay = try until.map { try components($0, time) } ?? first
    guard let end = utc.date(from: DateComponents(year: endDay.year, month: endDay.month, day: endDay.day, hour: 12)),
          utc.component(.month, from: end) == endDay.month, utc.component(.day, from: end) == endDay.day,
          end >= start, end.timeIntervalSince(start) <= 90 * 86400 else { throw AppleScheduleFailure.time }
    var result: [Int64] = [], current = start
    while current <= end {
      let fields = utc.dateComponents([.year, .month, .day], from: current)
      var target = fields; target.hour = first.hour; target.minute = first.minute; target.second = 0
      // Match strictly; never shift a nonexistent wall time silently. Both repeated-hour choices are explicit.
      let anchor = current.addingTimeInterval(-3 * 86400)
      guard let earlier = cal.nextDate(after: anchor, matching: target, matchingPolicy: .strict, repeatedTimePolicy: .first),
            let later = cal.nextDate(after: anchor, matching: target, matchingPolicy: .strict, repeatedTimePolicy: .last),
            cal.component(.year, from: earlier) == target.year, cal.component(.month, from: earlier) == target.month,
            cal.component(.day, from: earlier) == target.day, cal.component(.hour, from: earlier) == target.hour,
            cal.component(.minute, from: earlier) == target.minute else { throw AppleScheduleFailure.gap }
      if earlier != later && overlap == "ask" { throw AppleScheduleFailure.overlap }
      let selected = overlap == "later" ? later : earlier
      guard selected.timeIntervalSince(now) >= 60, selected.timeIntervalSince(now) <= 90 * 86400 else { throw AppleScheduleFailure.time }
      result.append(Int64(selected.timeIntervalSince1970 * 1000))
      guard result.count <= 32 else { throw AppleScheduleFailure.limit }
      if self.repeat == "none" { break }
      guard let next = utc.date(byAdding: .day, value: self.repeat == "daily" ? 1 : 7, to: current) else { throw AppleScheduleFailure.invalid }
      current = next
    }
    return result
  }
}

struct AppleScheduleEntry: Codable, Equatable {
  let id: String
  let kind: String
  let title: String
  var times: [Int64]
  let systemIds: [String]
  var state: String
  let taskId: String
  let payload: String
  let salt: String
  let duration: Int?
  var draft: AppleReminderDraft?
  var revision: Int
}

struct AppleScheduleState: Codable {
  let version: Int
  let owner: String
  var entries: [AppleScheduleEntry]
}
