import Foundation
import UserNotifications
#if canImport(AlarmKit)
import AlarmKit
import SwiftUI
#endif

@MainActor final class AppleScheduleDriver {
  static let alarmMarker = "contexify.owned-alarm-registrations"
  private let center = UNUserNotificationCenter.current()
  nonisolated static var enabled: Bool { Bundle.main.object(forInfoDictionaryKey: "ContexifyAssistantExtensionsEnabled") as? Bool == true }
  nonisolated static var alarmsSupported: Bool {
    #if canImport(AlarmKit)
    if #available(iOS 26.0, *) {
      let purpose = Bundle.main.object(forInfoDictionaryKey: "NSAlarmKitUsageDescription") as? String
      return enabled && purpose?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
    }
    #endif
    return false
  }
  nonisolated static var timerSupported: Bool {
    guard alarmsSupported, Bundle.main.object(forInfoDictionaryKey: "ContexifyAssistantCountdownWidget") as? Bool == true,
          let plugins = Bundle.main.builtInPlugInsURL,
          let widget = Bundle(url: plugins.appendingPathComponent("ContexifyScheduleWidget.appex")),
          let appId = Bundle.main.bundleIdentifier, widget.bundleIdentifier == appId + ".schedules",
          widget.executableURL != nil,
          let info = widget.infoDictionary?["NSExtension"] as? [String: Any],
          info["NSExtensionPointIdentifier"] as? String == "com.apple.widgetkit-extension" else { return false }
    return true
  }
  func requestNotifications() async throws -> Bool {
    guard Self.enabled else { throw AppleScheduleFailure.unavailable }
    return try await center.requestAuthorization(options: [.alert, .sound])
  }
  func notificationsAllowed() async -> Bool {
    let value = await center.notificationSettings()
    return value.authorizationStatus == .authorized || value.authorizationStatus == .provisional || value.authorizationStatus == .ephemeral
  }
  func requestAlarms() async throws -> Bool {
    #if canImport(AlarmKit)
    if #available(iOS 26.0, *), Self.alarmsSupported { return try await AlarmManager.shared.requestAuthorization() == .authorized }
    #endif
    throw AppleScheduleFailure.unavailable
  }
  func alarmsAllowed() -> Bool {
    #if canImport(AlarmKit)
    if #available(iOS 26.0, *), Self.alarmsSupported { return AlarmManager.shared.authorizationState == .authorized }
    #endif
    return false
  }
  func pendingNotifications() async -> Set<String> {
    Set(await center.pendingNotificationRequests().map(\.identifier).filter { $0.hasPrefix("contexify.reminder.") })
  }
  func deliveredNotifications() async -> Set<String> {
    Set(await center.deliveredNotifications().map { $0.request.identifier }.filter { $0.hasPrefix("contexify.reminder.") })
  }
  func pendingAlarms() throws -> Set<String> {
    #if canImport(AlarmKit)
    if #available(iOS 26.0, *) { return Set(try AlarmManager.shared.alarms.map { $0.id.uuidString.lowercased() }) }
    #endif
    return []
  }
  func schedule(_ row: AppleScheduleEntry, check: () throws -> Void) async throws {
    try check()
    if row.kind == "notification" {
      guard await notificationsAllowed() else { throw AppleScheduleFailure.unavailable }
      let total = await center.pendingNotificationRequests().count
      guard total + row.systemIds.count <= 32 else { throw AppleScheduleFailure.limit }
      for (index, timestamp) in row.times.enumerated() {
        try check()
        let delay = Double(timestamp) / 1000 - Date().timeIntervalSince1970
        guard delay > 0 else { throw AppleScheduleFailure.time }
        let content = UNMutableNotificationContent()
        content.title = "Contexify reminder"; content.body = "Open Contexify to view your reminder."; content.sound = .default
        let request = UNNotificationRequest(identifier: row.systemIds[index], content: content,
          trigger: UNTimeIntervalNotificationTrigger(timeInterval: delay, repeats: false))
        try await center.add(request)
        try check()
      }
      guard Set(row.systemIds).isSubset(of: await pendingNotifications()) else { throw AppleScheduleFailure.unknown }
      return
    }
    #if canImport(AlarmKit)
    if #available(iOS 26.0, *), Self.alarmsSupported {
      guard alarmsAllowed(), row.kind != "timer" || Self.timerSupported else { throw AppleScheduleFailure.unavailable }
      guard try pendingAlarms().count + row.systemIds.count <= 32 else { throw AppleScheduleFailure.limit }
      UserDefaults.standard.set(true, forKey: Self.alarmMarker)
      for (index, value) in row.systemIds.enumerated() {
        try check()
        guard let id = UUID(uuidString: value) else { throw AppleScheduleFailure.invalid }
        let alert = AlarmPresentation.Alert(title: "Contexify alert",
          stopButton: AlarmButton(text: "Stop", textColor: .white, systemImageName: "stop.circle"))
        let presentation: AlarmPresentation
        if row.kind == "timer" {
          presentation = AlarmPresentation(alert: alert, countdown: AlarmPresentation.Countdown(title: "Contexify timer"),
            paused: AlarmPresentation.Paused(title: "Timer paused", resumeButton: AlarmButton(text: "Resume", textColor: .white, systemImageName: "play.circle")))
        } else { presentation = AlarmPresentation(alert: alert) }
        let attributes = AlarmAttributes(presentation: presentation, metadata: ContexifyAlarmMetadata(id: id), tintColor: Color.teal)
        let config: AlarmManager.AlarmConfiguration<ContexifyAlarmMetadata>
        if row.kind == "timer", let duration = row.duration {
          config = .timer(duration: TimeInterval(duration), attributes: attributes)
        } else {
          let date = Date(timeIntervalSince1970: Double(row.times[index]) / 1000)
          guard date > Date() else { throw AppleScheduleFailure.time }
          config = .alarm(schedule: .fixed(date), attributes: attributes)
        }
        _ = try await AlarmManager.shared.schedule(id: id, configuration: config)
        try check()
      }
      guard Set(row.systemIds).isSubset(of: try pendingAlarms()) else { throw AppleScheduleFailure.unknown }
      return
    }
    #endif
    throw AppleScheduleFailure.unavailable
  }
  func remove(_ row: AppleScheduleEntry) async throws {
    if row.kind == "notification" {
      center.removePendingNotificationRequests(withIdentifiers: row.systemIds)
      center.removeDeliveredNotifications(withIdentifiers: row.systemIds)
      guard Set(row.systemIds).isDisjoint(with: await pendingNotifications()) else { throw AppleScheduleFailure.unknown }
    } else {
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) {
        for value in row.systemIds where try pendingAlarms().contains(value) {
          guard let id = UUID(uuidString: value) else { throw AppleScheduleFailure.invalid }
          try AlarmManager.shared.cancel(id: id)
        }
        guard Set(row.systemIds).isDisjoint(with: try pendingAlarms()) else { throw AppleScheduleFailure.unknown }
        return
      }
      #endif
      throw AppleScheduleFailure.unavailable
    }
  }
  /** Cancels only this app's namespace/AlarmKit client, never Apple's Clock or another app. */
  func clear() async throws {
    center.removePendingNotificationRequests(withIdentifiers: Array(await pendingNotifications()))
    center.removeDeliveredNotifications(withIdentifiers: Array(await deliveredNotifications()))
    #if canImport(AlarmKit)
    if #available(iOS 26.0, *), UserDefaults.standard.bool(forKey: Self.alarmMarker) || AlarmManager.shared.authorizationState == .authorized {
      for id in try AlarmManager.shared.alarms.map(\.id) { try AlarmManager.shared.cancel(id: id) }
      guard try pendingAlarms().isEmpty else { throw AppleScheduleFailure.unknown }
      UserDefaults.standard.removeObject(forKey: Self.alarmMarker)
    }
    #endif
    guard await pendingNotifications().isEmpty else { throw AppleScheduleFailure.unknown }
  }
}
