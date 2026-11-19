import XCTest
@testable import AssistantSchedulePolicy

final class AppleSchedulePolicyTests: XCTestCase {
  private func instant(_ text: String) -> Date { ISO8601DateFormatter().date(from: text)! }
  private func draft(_ changes: [String: Any] = [:]) throws -> AppleReminderDraft {
    var value: [String: Any] = ["title": "Synthetic reminder", "date": "2026-11-19", "time": "09:00", "zone": "Asia/Kolkata", "repeat": "none", "until": NSNull(), "overlap": "ask"]
    value.merge(changes) { _, new in new }; return try AppleReminderDraft(value)
  }
  func testSelectedZoneProducesOneImmutableUTCInstant() throws {
    let now = instant("2026-11-18T00:00:00Z")
    let times = try draft().occurrences(now: now)
    XCTAssertEqual(times, [Int64(instant("2026-11-19T03:30:00Z").timeIntervalSince1970 * 1000)])
  }
  func testNonexistentAndAmbiguousTimesRequireAnExplicitChoice() throws {
    XCTAssertThrowsError(try draft(["date": "2026-03-08", "time": "02:30", "zone": "America/New_York"]).occurrences(now: instant("2026-03-07T00:00:00Z")))
    let value: [String: Any] = ["date": "2026-11-01", "time": "01:30", "zone": "America/New_York"]
    let now = instant("2026-10-31T00:00:00Z")
    XCTAssertThrowsError(try draft(value).occurrences(now: now))
    var first = value; first["overlap"] = "earlier"
    var last = value; last["overlap"] = "later"
    XCTAssertEqual(try draft(last).occurrences(now: now)[0] - draft(first).occurrences(now: now)[0], 3600000)
  }
  func testRecurrenceIsFiniteAndCapacityBounded() throws {
    let now = instant("2026-11-18T00:00:00Z")
    XCTAssertEqual(try draft(["repeat": "daily", "until": "2026-11-20"]).occurrences(now: now).count, 2)
    XCTAssertEqual(try draft(["repeat": "weekly", "until": "2026-12-03"]).occurrences(now: now).count, 3)
    XCTAssertThrowsError(try draft(["repeat": "daily", "until": "2026-12-30"]).occurrences(now: now))
    XCTAssertThrowsError(try draft(["repeat": "daily", "until": "2026-11-18"]).occurrences(now: now))
  }
  func testMalformedPrivateInputNeverBecomesASchedule() throws {
    let changes: [[String: Any]] = [["title": "spoof\u{202e}label"], ["title": "line\nline"], ["time": "25:00"], ["zone": "invalid-zone"], ["extra": "unknown"]]
    for change in changes {
      XCTAssertThrowsError(try draft(change))
    }
    XCTAssertThrowsError(try draft(["date": "2026-02-30"]).occurrences(now: instant("2026-02-28T00:00:00Z")))
    XCTAssertThrowsError(try draft().occurrences(now: instant("2026-11-19T03:29:30Z")))
    XCTAssertThrowsError(try AppleScheduleJSON.integer(true))
    XCTAssertThrowsError(try AppleScheduleJSON.integer(1.5))
  }
  @MainActor func testProtocolRejectsWrongOriginRedirectPathsAndChangedAction() async throws {
    for origin in ["http://example.invalid", "https://user:password@example.invalid", "https://example.invalid/path", "https://example.invalid?token=x"] {
      XCTAssertThrowsError(try AppleScheduleProtocol(origin: origin, user: "fixture", installation: UUID().uuidString.lowercased(), publicKey: "fixture", active: {}))
    }
    let wire = try AppleScheduleProtocol(origin: "https://example.invalid", user: "fixture", installation: UUID().uuidString.lowercased(), publicKey: "fixture", active: {})
    do { _ = try await wire.post(String(repeating: "x", count: 43), "https://other.invalid"); XCTFail("URL must be rejected before networking") } catch {}
    XCTAssertThrowsError(try wire.envelope(["payload": "{}"], purpose: "authorize", revision: 1,
      token: String(repeating: "x", count: 43), task: UUID().uuidString.lowercased(), action: [:]))
    wire.cancel()
  }
}
