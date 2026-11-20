import ExpoModulesCore
import AppIntents
import EventKit
import EventKitUI
import UIKit
import MessageUI

// An entry request carries no command, private data or authority. Main queue only.
public enum AssistantEntry {
  static let notification = Notification.Name("ContexifyAssistantEntry")
  private static var requestedAt: TimeInterval?
  static var enabled: Bool {
    Bundle.main.object(forInfoDictionaryKey: "ContexifyAssistantExtensionsEnabled") as? Bool == true
  }
  @MainActor public static func request() {
    guard enabled else { return }
    requestedAt = ProcessInfo.processInfo.systemUptime
    NotificationCenter.default.post(name: notification, object: nil)
  }
  static func consume() -> Bool {
    let at = requestedAt
    requestedAt = nil
    guard enabled, let at else { return false }
    let age = ProcessInfo.processInfo.systemUptime - at
    return age >= 0 && age < 30
  }
}

@available(iOS 16.4, *)
public struct OpenContexifyAssistantIntent: AppIntent {
  public static var title: LocalizedStringResource = "Open Assistant"
  public static var description = IntentDescription("Open Contexify Assistant. Microphone and device actions need separate approval in the app.")
  public static var openAppWhenRun: Bool = true
  public static var authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication
  public init() {}
  @MainActor public func perform() async throws -> some IntentResult {
    AssistantEntry.request()
    return .result()
  }
}

@available(iOS 17.0, *)
public struct AssistantPlatformIntentsPackage: AppIntentsPackage {}

private final class CalendarEditor: NSObject, EKEventEditViewDelegate {
  private var editor: EKEventEditViewController?
  private var pending: Promise?
  private var requestId: String?
  var active: Bool { pending != nil }
  func open(_ presenter: UIViewController, id: String, promise: Promise) {
    guard editor == nil, !id.isEmpty, id.utf8.count <= 128 else {
      promise.reject("ERR_EDITOR_BUSY", "An editor is already open or unavailable."); return
    }
    let store = EKEventStore()
    let controller = EKEventEditViewController()
    controller.eventStore = store
    let event = EKEvent(eventStore: store)
    event.startDate = Date().addingTimeInterval(3600)
    event.endDate = event.startDate.addingTimeInterval(3600)
    controller.event = event
    controller.isModalInPresentation = true
    controller.editViewDelegate = self
    // Apple's editor owns title/time/calendar selection and the Save/Cancel decision.
    // Never fetch calendars, read events, call store.save or request broad access.
    editor = controller
    requestId = id
    pending = promise
    presenter.present(controller, animated: true)
  }
  private func finish(_ result: String) {
    let controller = editor
    let promise = pending
    editor = nil
    pending = nil
    requestId = nil
    controller?.editViewDelegate = nil
    controller?.dismiss(animated: false)
    promise?.resolve(result)
  }
  func cancel(_ id: String? = nil) {
    if editor != nil && (id == nil || id == requestId) { finish("outcome_unknown") }
  }
  func eventEditViewController(_ controller: EKEventEditViewController, didCompleteWith action: EKEventEditViewAction) {
    guard controller === editor else { return }
    switch action {
    case .saved: finish("saved_in_editor")
    case .canceled: finish("cancelled")
    default: finish("outcome_unknown")
    }
  }
}

public final class AssistantPlatformModule: Module {
  private let calendar = CalendarEditor()
  private let communications = CommunicationEditor()
  private var observer: NSObjectProtocol?
  private var inactiveObserver: NSObjectProtocol?
  private func foreground() -> Bool {
    UIApplication.shared.applicationState == .active && UIApplication.shared.isProtectedDataAvailable
  }
  private func presenter() -> UIViewController? {
    guard foreground(), AssistantEntry.enabled, !calendar.active, !communications.active,
      let scene = UIApplication.shared.connectedScenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene,
      var presenter = scene.windows.first(where: { $0.isKeyWindow })?.rootViewController else { return nil }
    while let presented = presenter.presentedViewController { presenter = presented }
    return !(presenter is UIAlertController) && !presenter.isBeingDismissed && presenter.viewIfLoaded?.window != nil ? presenter : nil
  }
  public func definition() -> ModuleDefinition {
    Name("AssistantPlatform")
    Events("onAssistantEntry")
    OnCreate {
      self.inactiveObserver = NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
        self?.communications.resignActive()
      }
      self.observer = NotificationCenter.default.addObserver(forName: AssistantEntry.notification, object: nil, queue: .main) { [weak self] _ in
        self?.sendEvent("onAssistantEntry")
      }
    }
    OnAppEntersBackground { DispatchQueue.main.async { self.calendar.cancel(); self.communications.cancel() } }
    OnDestroy {
      if let observer = self.observer { NotificationCenter.default.removeObserver(observer) }
      self.observer = nil
      if let inactiveObserver = self.inactiveObserver { NotificationCenter.default.removeObserver(inactiveObserver) }
      self.inactiveObserver = nil
      DispatchQueue.main.async { self.calendar.cancel(); self.communications.cancel() }
    }
    AsyncFunction("support") { () -> [String: Bool] in
      if #available(iOS 17.0, *) {
        return ["calendar_editor": AssistantEntry.enabled, "shortcuts": AssistantEntry.enabled]
      }
      return ["calendar_editor": false, "shortcuts": false]
    }.runOnQueue(.main)
    AsyncFunction("consumeAssistantEntry") { () -> Bool in
      guard self.foreground() else { return false }
      return AssistantEntry.consume()
    }.runOnQueue(.main)
    AsyncFunction("editCalendarEvent") { (id: String, promise: Promise) in
      guard #available(iOS 17.0, *), !self.communications.active, AssistantEntry.enabled, self.foreground(),
            let scene = UIApplication.shared.connectedScenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene,
            var presenter = scene.windows.first(where: { $0.isKeyWindow })?.rootViewController else {
        promise.reject("ERR_EDITOR_UNAVAILABLE", "Use Calendar directly on this device."); return
      }
      while let presented = presenter.presentedViewController { presenter = presented }
      guard !presenter.isBeingDismissed, presenter.viewIfLoaded?.window != nil else {
        promise.reject("ERR_EDITOR_UNAVAILABLE", "Calendar editor unavailable."); return
      }
      self.calendar.open(presenter, id: id, promise: promise)
    }.runOnQueue(.main)
    AsyncFunction("cancelCalendarEditor") { (id: String) in self.calendar.cancel(id) }.runOnQueue(.main)
    AsyncFunction("communicationSupport") { () -> [String: Bool] in
      let enabled = AssistantEntry.enabled
      return ["picker": enabled, "dial": enabled && UIApplication.shared.canOpenURL(URL(string: "tel:+12025550123")!),
        "sms": enabled && MFMessageComposeViewController.canSendText()]
    }.runOnQueue(.main)
    AsyncFunction("pickPhoneNumber") { (id: String, promise: Promise) in
      guard let presenter = self.presenter() else {
        promise.reject("ERR_CONTACT_PICKER", "Contact picker unavailable. Enter a number manually."); return
      }
      self.communications.pick(presenter, id: id, promise: promise)
    }.runOnQueue(.main)
    AsyncFunction("openCommunication") { (id: String, encoded: String, promise: Promise) in
      guard let presenter = self.presenter() else {
        promise.reject("ERR_COMMUNICATION_UNAVAILABLE", "Phone presentation unavailable or already open."); return
      }
      self.communications.open(presenter, id: id, encoded: encoded, promise: promise)
    }.runOnQueue(.main)
    AsyncFunction("cancelCommunicationRequest") { (id: String) in self.communications.cancel(id) }.runOnQueue(.main)
    AsyncFunction("openPlannedCommunication") { (id: String, encoded: String, expiresAt: Double, promise: Promise) in
      guard let presenter = self.presenter() else {
        promise.reject("ERR_COMMUNICATION_UNAVAILABLE", "Phone presentation unavailable or already open."); return
      }
      self.communications.open(presenter, id: id, encoded: encoded, promise: promise, expiresAt: expiresAt)
    }.runOnQueue(.main)
  }
}
