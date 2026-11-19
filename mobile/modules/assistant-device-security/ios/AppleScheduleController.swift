import Foundation
import UIKit

/** One foreground transaction at a time; only immutable approved OS registrations outlive it. */
@MainActor final class AppleScheduleController {
  private let vault = AppleScheduleVault()
  private let driver = AppleScheduleDriver()
  private let binding: (String, String, String) throws -> Void
  private let publicKey: (String) throws -> String
  private let sign: (String, String) throws -> String
  private let acquire: () throws -> Void
  private let release: () -> Void
  private var generation = 0
  private var busy = false
  private var client: AppleScheduleProtocol?
  private var dismiss: (() -> Void)?

  init(binding: @escaping (String, String, String) throws -> Void, publicKey: @escaping (String) throws -> String,
       sign: @escaping (String, String) throws -> String, acquire: @escaping () throws -> Void, release: @escaping () -> Void) {
    self.binding = binding; self.publicKey = publicKey; self.sign = sign; self.acquire = acquire; self.release = release
  }
  func cancel() { generation += 1; dismiss?(); client?.cancel() }
  func clear() async throws {
    cancel()
    var failure: Error?
    do { try vault.markCleanup() } catch { failure = error }
    do { try await driver.clear() } catch { failure = error }
    // Private data is removed even if the OS could not acknowledge cancellation.
    do { try vault.erase() } catch { failure = error }
    if let failure { throw failure }
    if !busy { try vault.finishCleanup() }
  }
  private func active(_ ticket: Int, _ origin: String, _ user: String, _ installation: String) throws {
    guard AppleScheduleDriver.enabled, ticket == generation,
          UIApplication.shared.applicationState == .active, UIApplication.shared.isProtectedDataAvailable else { throw AppleScheduleFailure.interrupted }
    try binding(origin, user, installation)
  }
  private func session<T>(_ origin: String, _ user: String, _ installation: String, _ management: String,
                         _ work: (AppleScheduleProtocol, String, String, Int) async throws -> T) async throws -> T {
    guard !busy else { throw AppleScheduleFailure.interrupted }
    try acquire(); busy = true
    let ticket = generation
    defer { client?.cancel(); client = nil; busy = false; release() }
    do {
      try active(ticket, origin, user, installation)
      if try vault.cleanupPending() {
        try await driver.clear(); try active(ticket, origin, user, installation)
        try vault.erase(); try vault.finishCleanup()
      }
      let wire = try AppleScheduleProtocol(origin: origin, user: user, installation: installation, publicKey: publicKey(installation)) {
        try self.active(ticket, origin, user, installation)
      }
      client = wire
      let token = try await wire.scope(management)
      let owner = AppleScheduleJSON.hash(origin + "\n" + user + "\n" + installation)
      try wire.check()
      // A missing/key-lost vault cannot silently adopt old OS registrations or another account.
      let stored: AppleScheduleState?
      do { stored = try vault.load(owner: owner) }
      catch {
        try vault.markCleanup()
        try await driver.clear(); try wire.check(); try vault.erase()
        throw AppleScheduleFailure.unknown // Reset safely; never restore/replay an unreadable schedule.
      }
      if stored == nil {
        try await driver.clear()
        try wire.check()
        try vault.save(AppleScheduleState(version: 1, owner: owner, entries: []))
      }
      return try await work(wire, token, owner, ticket)
    } catch let error as AppleScheduleHTTPFailure where error.status == 401 {
      try? await clear()
      throw AppleScheduleFailure.unauthorized
    }
  }
  private func state(_ owner: String) throws -> AppleScheduleState {
    guard let value = try vault.load(owner: owner) else { throw AppleScheduleFailure.unauthorized }
    return value
  }
  private func confirm(_ message: String, expires: Double, check: @escaping () throws -> Void) async throws -> Bool {
    try check()
    guard dismiss == nil, expires.isFinite, expires > Date().timeIntervalSince1970,
          let scene = UIApplication.shared.connectedScenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene,
          var presenter = scene.windows.first(where: { $0.isKeyWindow })?.rootViewController else { throw AppleScheduleFailure.interrupted }
    while let presented = presenter.presentedViewController { presenter = presented }
    guard !presenter.isBeingDismissed, presenter.viewIfLoaded?.window != nil else { throw AppleScheduleFailure.interrupted }
    let monotonicExpiry = ProcessInfo.processInfo.systemUptime + min(60, expires - Date().timeIntervalSince1970)
    return await withCheckedContinuation { continuation in
      let alert = UIAlertController(title: "Review iPhone schedule", message: message, preferredStyle: .alert)
      var settled = false
      var timeout: DispatchWorkItem?
      func finish(_ approved: Bool) {
        guard !settled else { return }; settled = true
        timeout?.cancel(); self.dismiss = nil
        alert.dismiss(animated: false)
        continuation.resume(returning: approved)
      }
      alert.addAction(UIAlertAction(title: "Approve", style: .default) { _ in
        do {
          try check()
          guard Date().timeIntervalSince1970 < expires, ProcessInfo.processInfo.systemUptime < monotonicExpiry else { throw AppleScheduleFailure.interrupted }
          finish(true)
        } catch { finish(false) }
      })
      alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in finish(false) })
      dismiss = { finish(false) }
      let deadline = DispatchWorkItem { finish(false) }; timeout = deadline
      DispatchQueue.main.asyncAfter(deadline: .now() + max(0, monotonicExpiry - ProcessInfo.processInfo.systemUptime), execute: deadline)
      presenter.present(alert, animated: true)
    }
  }
  private func result(_ outcome: String, id: String?, recorded: Bool = false, copy: String = "not_requested") throws -> String {
    try AppleScheduleJSON.text(["protocol_version": 1, "outcome": outcome, "reminder_id": id as Any? ?? NSNull(), "receipt_recorded": recorded, "account_copy": copy])
  }
  private func prepare(_ input: [String: Any], delivery: String, id: String, task: String, salt: String) throws -> AppleScheduleEntry {
    let draft: AppleReminderDraft?
    let title: String
    let duration: Int?
    let times: [Int64]
    if delivery == "timer" {
      try AppleScheduleJSON.fields(input, ["title", "duration_seconds"])
      title = try AppleScheduleJSON.title(input["title"])
      let seconds = try AppleScheduleJSON.integer(input["duration_seconds"])
      guard (60...86400).contains(seconds), AppleScheduleDriver.timerSupported else { throw AppleScheduleFailure.unavailable }
      duration = Int(seconds); draft = nil
      times = [Int64((Date().timeIntervalSince1970 + Double(seconds)) * 1000)]
    } else {
      let value = try AppleReminderDraft(input); draft = value; title = value.title; duration = nil
      times = try value.occurrences()
    }
    var body = draft?.dictionary() ?? input
    body["reminder_id"] = id
    if delivery == "notification" { body["occurrences"] = times }
    else { body["delivery_kind"] = delivery; if delivery != "timer" { body["occurrences"] = times } }
    let payload = try AppleScheduleJSON.text(body)
    guard payload.utf8.count <= 4096 else { throw AppleScheduleFailure.limit }
    return AppleScheduleEntry(id: id, kind: delivery, title: title, times: times,
      systemIds: times.indices.map { delivery == "notification" ? "contexify.reminder.\(id).\($0)" : UUID().uuidString.lowercased() },
      state: "schedule_unknown", taskId: task, payload: payload, salt: salt, duration: duration, draft: draft, revision: 1)
  }
  func execute(_ origin: String, _ user: String, _ installation: String, _ management: String,
               kind: String, encoded: String, delivery: String = "notification") async throws -> String {
    guard ["create", "cancel", "storage", "delete_saved"].contains(kind), ["notification", "alarm", "timer"].contains(delivery),
          delivery == "notification" || kind == "create" || kind == "cancel" else { throw AppleScheduleFailure.invalid }
    let input = try AppleScheduleJSON.object(encoded)
    return try await session(origin, user, installation, management) { wire, token, owner, ticket in
      var local = try self.state(owner)
      let storage = try await wire.post(token, "/storage")
      let operation = UUID().uuidString.lowercased()
      let salt = Data((0..<32).map { _ in UInt8.random(in: 0...255) }).base64EncodedString()
        .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
      let id: String?
      var entry: AppleScheduleEntry?
      var storageMode: String?
      var storageRevision: Int64?
      let payload: String
      let message: String
      switch kind {
      case "create":
        let value = UUID().uuidString.lowercased(); id = value
        if delivery == "notification" { guard await self.driver.notificationsAllowed() else { throw AppleScheduleFailure.unavailable } }
        else { guard self.driver.alarmsAllowed() else { throw AppleScheduleFailure.unavailable } }
        let row = try self.prepare(input, delivery: delivery, id: value, task: operation, salt: salt); entry = row
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let notificationIds = await self.driver.pendingNotifications()
        let alarmIds = local.entries.contains(where: { $0.kind != "notification" }) ? try self.driver.pendingAlarms() : []
        try wire.check()
        let activeRows = local.entries.filter { row in
          row.state == "schedule_unknown" || row.times.last! >= now ||
            !Set(row.systemIds).isDisjoint(with: row.kind == "notification" ? notificationIds : alarmIds)
        }
        guard activeRows.count < 32,
              activeRows.reduce(0, { $0 + $1.times.filter { $0 >= now }.count }) + row.systemIds.count <= 32 else { throw AppleScheduleFailure.limit }
        let activeIds = Set(activeRows.map(\.id))
        local.entries = activeRows + local.entries.filter { !activeIds.contains($0.id) }.suffix(7)
        payload = row.payload
        let schedule = row.duration.map { "Timer: \($0) seconds, starting after approval and authorization." }
          ?? "\(row.draft!.date) \(row.draft!.time) (\(row.draft!.zone)); \(row.draft!.repeat), \(row.times.count) occurrence(s), ending \(row.draft!.until ?? row.draft!.date)."
        message = "\(row.title)\n\n\(schedule)\n\n" + (delivery == "notification"
          ? "Generic local notifications; iOS may delay them. Alerts already approved can notify offline. Signing out cancels them."
          : "Ringing AlarmKit alert. It may sound through silent mode or Focus. The locked screen shows a generic label. Signing out cancels this app's alarms. Other Clock alarms remain separate.")
      case "cancel":
        try AppleScheduleJSON.fields(input, ["reminder_id"])
        let value = try AppleScheduleJSON.id(input["reminder_id"] as? String ?? ""); id = value
        guard let row = local.entries.first(where: { $0.id == value }), row.kind == delivery || (delivery == "alarm" && row.kind == "timer") else { throw AppleScheduleFailure.invalid }
        entry = row; payload = try AppleScheduleJSON.text(["reminder_id": value, "revision": row.revision])
        message = "Cancel future alerts and remove this phone's private details for:\n\n\(row.title)\n\nAn account copy from this phone is deleted only when the server receipt succeeds."
      case "storage":
        try AppleScheduleJSON.fields(input, ["mode", "revision"])
        let revision = try AppleScheduleJSON.integer(input["revision"])
        guard revision == (try AppleScheduleJSON.integer(storage["revision"])), let mode = input["mode"] as? String,
              ["device_only", "account"].contains(mode), mode != "account" || storage["account_storage_available"] as? Bool == true else { throw AppleScheduleFailure.unavailable }
        id = nil; storageMode = mode; storageRevision = revision; payload = try AppleScheduleJSON.text(input)
        message = mode == "account" ? "Save encrypted account copies of new notification reminders?\n\nTheir titles and schedules go to your configured server over HTTPS, encrypted at rest. Your server can decrypt them after authentication. Nothing goes to Gemini. Existing reminders do not upload automatically. AlarmKit alarms/timers stay device-only. Restoring a copy creates an unscheduled draft."
          : "Keep new reminder details on this phone only?\n\nDelete this device's saved account copies. Local schedules and other devices' copies remain."
      default:
        try AppleScheduleJSON.fields(input, ["reminder_id"])
        let value = try AppleScheduleJSON.id(input["reminder_id"] as? String ?? ""); id = value
        let saved = try await wire.post(token, "/stored/read", ["reminder_id": value])
        guard let details = saved["details"] as? [String: Any], details["reminder_id"] as? String == value else { throw AppleScheduleFailure.invalid }
        let title = try AppleScheduleJSON.title(details["title"])
        payload = try AppleScheduleJSON.text(input)
        message = "Delete the saved account copy for:\n\n\(title)\n\nThis does not cancel alerts on another phone."
      }
      let action: [String: Any] = ["capability_id": "reminder." + kind, "schema_version": 1,
        "commitment": AppleScheduleJSON.hash("reminder-v1\n" + salt + "\n" + payload),
        "reminder_id": id as Any? ?? NSNull(), "storage_mode": storageMode as Any? ?? NSNull(),
        "settings_revision": storageRevision as Any? ?? NSNull()]
      var claimed = false, recorded = false, outcome = "failed", copy = "not_requested"
      do {
        let created = try await wire.post(token, "/operations", ["protocol_version": 2, "plan_id": operation, "plan_revision": 1, "step_id": 0, "action": action])
        guard let task = created["task_id"] as? String, created["mode"] as? String == "reminder",
              created["state"] as? String == "awaiting_confirmation", try AppleScheduleJSON.integer(created["revision"]) == 1 else { throw AppleScheduleFailure.invalid }
        _ = try AppleScheduleJSON.id(task)
        let path = "/tasks/" + task
        let challenge = try await wire.post(token, path + "/authorization-challenge", ["expected_revision": 1])
        let bytes = try wire.envelope(challenge, purpose: "authorize", revision: 1, token: token, task: task, action: action)
        let check = {
          try wire.check()
          if kind == "cancel", let row = entry { guard try self.state(owner).entries.first(where: { $0.id == row.id }) == row else { throw AppleScheduleFailure.interrupted } }
          if kind == "create", let row = entry, row.kind != "timer" {
            guard row.times.first! > Int64(Date().timeIntervalSince1970 * 1000 + 1000) else { throw AppleScheduleFailure.time }
          }
        }
        guard try await self.confirm(message, expires: challenge["expires_at"] as? Double ?? 0, check: check) else {
          if ticket == self.generation { _ = try? await wire.post(token, path + "/cancel") }
          return try self.result("cancelled", id: id)
        }
        try check()
        func proof(_ value: [String: Any], _ payload: String, _ revision: Int) throws -> [String: Any] {
          guard let challenge = value["challenge_id"] as? String else { throw AppleScheduleFailure.invalid }
          return ["expected_revision": revision, "challenge_id": challenge, "signature": try self.sign(installation, payload)]
        }
        let permit = try await wire.post(token, path + "/authorize", proof(challenge, bytes, 1))
        guard try AppleScheduleJSON.integer(permit["action_revision"]) == 2,
              let claimChallenge = permit["claim_challenge"] as? [String: Any], let permitValue = permit["permit"] as? String else { throw AppleScheduleFailure.invalid }
        let claimBytes = try wire.envelope(claimChallenge, purpose: "claim", revision: 2, token: token, task: task, action: action)
        guard try AppleScheduleJSON.object(claimBytes)["permit_hash"] as? String == AppleScheduleJSON.hash(permitValue) else { throw AppleScheduleFailure.unauthorized }
        if kind == "create", var row = entry {
          row = AppleScheduleEntry(id: row.id, kind: row.kind, title: row.title, times: row.times, systemIds: row.systemIds,
            state: row.state, taskId: task, payload: row.payload, salt: row.salt, duration: row.duration, draft: row.draft, revision: row.revision)
          entry = row
          local.entries.append(row); try self.vault.save(local) // Durable uncertainty before an ambiguous claim.
        }
        var claimProof = try proof(claimChallenge, claimBytes, 2); claimProof["permit"] = permitValue
        claimed = true
        let claim = try await wire.post(token, path + "/claim", claimProof)
        guard claim["execution"] as? String == "ios_owned_schedule", try AppleScheduleJSON.integer(claim["action_revision"]) == 3,
              let claimId = claim["claim_id"] as? String, let expiry = claim["expires_at"] as? Double,
              expiry > Date().timeIntervalSince1970, expiry <= Date().timeIntervalSince1970 + 20 else { throw AppleScheduleFailure.unauthorized }
        _ = try AppleScheduleJSON.id(claimId)
        let monotonic = ProcessInfo.processInfo.systemUptime + min(15, expiry - Date().timeIntervalSince1970)
        let effectCheck = {
          try check()
          guard Date().timeIntervalSince1970 < expiry, ProcessInfo.processInfo.systemUptime < monotonic else { throw AppleScheduleFailure.interrupted }
        }
        try effectCheck()
        if kind == "create", var row = entry {
          if let duration = row.duration { row.times = [Int64((Date().timeIntervalSince1970 + Double(duration)) * 1000)] }
          try await self.driver.schedule(row, check: effectCheck)
          row.state = "scheduled"; row.revision += 1
          local.entries.removeAll { $0.id == row.id }; local.entries.append(row); try self.vault.save(local)
          outcome = "schedule_requested"
        } else if kind == "cancel", let row = entry {
          try await self.driver.remove(row); try effectCheck()
          local.entries.removeAll { $0.id == row.id }; try self.vault.save(local); outcome = "reminder_cancelled"
        } else { outcome = kind == "storage" ? "storage_updated" : "saved_copy_deleted" }
        let evidence: [String: Any] = ["expected_revision": 3, "claim_id": claimId, "outcome": outcome]
        do {
          let receiptChallenge = try await wire.post(token, path + "/receipt-challenge", evidence)
          let receiptBytes = try wire.envelope(receiptChallenge, purpose: "receipt", revision: 3, token: token, task: task, action: action)
          let fields = try AppleScheduleJSON.object(receiptBytes)
          guard fields["claim_id"] as? String == claimId, fields["outcome"] as? String == outcome else { throw AppleScheduleFailure.unauthorized }
          var body = evidence; body.merge(try proof(receiptChallenge, receiptBytes, 3)) { _, new in new }
          let receipt = try await wire.post(token, path + "/receipt", body)
          guard receipt["task_id"] as? String == task, receipt["state"] as? String == outcome else { throw AppleScheduleFailure.unknown }
          recorded = true
        } catch let error as AppleScheduleHTTPFailure where error.status == 401 { throw error }
        catch { if kind == "storage" || kind == "delete_saved" { outcome = "outcome_unknown" } }
        if delivery == "notification", kind == "create", storage["mode"] as? String == "account" {
          copy = "unavailable"
          if recorded, let row = entry {
            do {
              let current = try await wire.post(token, "/storage")
              guard current["mode"] as? String == "account",
                    try AppleScheduleJSON.integer(current["revision"]) == AppleScheduleJSON.integer(storage["revision"]) else { throw AppleScheduleFailure.interrupted }
              let saved = try await wire.post(token, "/stored/save", ["task_id": task, "salt": salt, "payload_json": row.payload])
              guard saved["reminder_id"] as? String == row.id, saved["stored"] as? Bool == true else { throw AppleScheduleFailure.unknown }
              copy = "stored"
            }
            catch let error as AppleScheduleHTTPFailure where error.status == 401 { throw error }
            catch { /* No automatic private upload retry. */ }
          }
        }
      } catch let error as AppleScheduleHTTPFailure where error.status == 401 { throw error }
      catch {
        outcome = claimed ? "outcome_unknown" : (ticket == self.generation ? "failed" : "cancelled")
        // Roll back only this operation's known system IDs. Never schedule again after uncertainty.
        if claimed, kind == "create", let row = entry { try? await self.driver.remove(row) }
      }
      return try self.result(outcome, id: id, recorded: recorded, copy: copy)
    }
  }
  func read(_ origin: String, _ user: String, _ installation: String, _ management: String, alarms: Bool = false) async throws -> String {
    try await session(origin, user, installation, management) { wire, token, owner, _ in
      var local = try self.state(owner)
      let pending = await self.driver.pendingNotifications(), delivered = await self.driver.deliveredNotifications()
      let alarmIds = local.entries.contains(where: { $0.kind != "notification" }) ? try self.driver.pendingAlarms() : []
      let now = Int64(Date().timeIntervalSince1970 * 1000)
      var items: [[String: Any]] = []
      for row in local.entries where (row.kind != "notification") == alarms {
        let indices = row.systemIds.indices.filter { (row.kind == "notification" ? pending : alarmIds).contains(row.systemIds[$0]) }
        let current = indices.first ?? row.times.indices.last!
        let state = row.state == "schedule_unknown" ? "schedule_unknown" : (indices.isEmpty ? "notification_unknown" : "scheduled")
        if alarms {
          items.append(["reminder_id": row.id, "kind": row.kind, "title": row.title, "state": state,
            "next_at": row.times[current], "remaining": indices.count])
        } else {
          var details = row.draft!.dictionary(); details["reminder_id"] = row.id; details["occurrences"] = row.times
          let requested = !Set(row.systemIds).isDisjoint(with: delivered)
          items.append(["reminder_id": row.id, "state": indices.isEmpty && requested ? "notification_requested" : state,
            "next_at": row.times[current], "remaining": indices.count, "last_outcome": requested ? "notification_requested" : NSNull(), "details": details])
        }
      }
      // Expired private history is deleted on foreground access; no background reader or replay worker.
      let expired = local.entries.filter { $0.times.last! + 7 * 86400000 < now }
      for row in expired { try await self.driver.remove(row) }
      local.entries.removeAll { row in expired.contains(where: { $0.id == row.id }) }
      try wire.check(); try self.vault.save(local)
      items.removeAll { value in expired.contains(where: { $0.id == value["reminder_id"] as? String }) }
      if alarms { return try AppleScheduleJSON.text(["protocol_version": 1, "items": items, "alarms_allowed": self.driver.alarmsAllowed()]) }
      let settings = try await wire.post(token, "/storage")
      return try AppleScheduleJSON.text(["protocol_version": 1, "items": items, "storage": settings,
        "time_zone": TimeZone.current.identifier, "notifications_allowed": await self.driver.notificationsAllowed()])
    }
  }
  func saved(_ origin: String, _ user: String, _ installation: String, _ management: String, after: String?) async throws -> String {
    try await session(origin, user, installation, management) { wire, token, _, _ in
      if let after { _ = try AppleScheduleJSON.id(after) }
      let value = try await wire.post(token, "/stored/list", ["after": after as Any? ?? NSNull()])
      return try AppleScheduleJSON.text(value)
    }
  }
  func saveCopy(_ origin: String, _ user: String, _ installation: String, _ management: String, id: String) async throws -> String {
    try await session(origin, user, installation, management) { wire, token, owner, _ in
      _ = try AppleScheduleJSON.id(id)
      guard let row = try self.state(owner).entries.first(where: { $0.id == id && $0.kind == "notification" && $0.state == "scheduled" }) else { throw AppleScheduleFailure.invalid }
      let settings = try await wire.post(token, "/storage")
      guard settings["mode"] as? String == "account" else { throw AppleScheduleFailure.unauthorized }
      guard try await self.confirm("Save an encrypted account copy?\n\n\(row.title)\n\nThis sends the reminder details to your configured server, not Gemini.",
        expires: Date().timeIntervalSince1970 + 60, check: { try wire.check() }) else { throw AppleScheduleFailure.interrupted }
      let current = try await wire.post(token, "/storage")
      guard current["mode"] as? String == "account",
            try AppleScheduleJSON.integer(current["revision"]) == AppleScheduleJSON.integer(settings["revision"]) else { throw AppleScheduleFailure.interrupted }
      let result = try await wire.post(token, "/stored/save", ["task_id": row.taskId, "salt": row.salt, "payload_json": row.payload])
      return try AppleScheduleJSON.text(result)
    }
  }
}
