import ContactsUI
import ExpoModulesCore
import MessageUI
import UIKit

private struct CommunicationDraft {
  let kind: String
  let number: String
  let body: String
  init(_ encoded: String) throws {
    guard encoded.utf8.count <= 8192,
          let data = encoded.data(using: .utf8),
          let value = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          Set(value.keys) == Set(["kind", "number", "body"]),
          let kind = value["kind"] as? String, ["dial", "sms"].contains(kind),
          let number = value["number"] as? String,
          number.range(of: #"^\+[1-9][0-9]{7,14}$"#, options: .regularExpression) != nil,
          let body = value["body"] as? String, body.utf16.count <= 1000,
          body.unicodeScalars.allSatisfy({ scalar in
            let code = scalar.value
            return !(code <= 9 || (11...31).contains(code) || (127...159).contains(code) ||
              (0x202a...0x202e).contains(code) || (0x2066...0x2069).contains(code))
          }),
          kind == "dial" ? body.isEmpty : !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      throw NSError(domain: "ContexifyCommunication", code: 1)
    }
    self.kind = kind; self.number = number; self.body = body
  }
}

/** Local OS presentation. No contact enumeration, network, store, sendMessage or call API. */
final class CommunicationEditor: NSObject, CNContactPickerDelegate, MFMessageComposeViewControllerDelegate {
  private var controller: UIViewController?
  private var pending: Promise?
  private var requestId: String?
  private var phase = ""
  private var timeout: Timer?
  private var deadline: TimeInterval = 0
  private var generation: UInt64 = 0
  var active: Bool { pending != nil }
  private var fresh: Bool { active && ProcessInfo.processInfo.systemUptime < deadline }
  private func foreground() -> Bool {
    AssistantEntry.enabled && UIApplication.shared.applicationState == .active && UIApplication.shared.isProtectedDataAvailable
  }
  private func begin(_ id: String, phase: String, promise: Promise, lifetime: TimeInterval = 60) -> Bool {
    guard !active, foreground(), id.utf8.count <= 100,
      id.range(of: #"^communication-[0-9]+-[0-9]+$"#, options: .regularExpression) != nil else {
      promise.reject("ERR_COMMUNICATION_UNAVAILABLE", "Phone presentation unavailable or already open."); return false
    }
    generation &+= 1
    requestId = id; pending = promise; self.phase = phase
    arm(id, seconds: lifetime)
    return true
  }
  private func arm(_ id: String, seconds: TimeInterval) {
    timeout?.invalidate()
    deadline = ProcessInfo.processInfo.systemUptime + seconds
    let ticket = generation
    timeout = Timer.scheduledTimer(withTimeInterval: seconds, repeats: false) { [weak self] _ in
      guard let self, self.generation == ticket else { return }; self.cancel(id)
    }
  }
  private func finish(_ result: Any) {
    let promise = pending
    let view = controller
    generation &+= 1
    controller = nil; pending = nil; requestId = nil; phase = ""; deadline = 0
    timeout?.invalidate(); timeout = nil
    (view as? CNContactPickerViewController)?.delegate = nil
    (view as? MFMessageComposeViewController)?.messageComposeDelegate = nil
    view?.dismiss(animated: false)
    promise?.resolve(result)
  }
  func cancel(_ id: String? = nil) {
    guard active, id == nil || requestId == id else { return }
    if phase == "picker" { finish(["outcome": "outcome_unknown", "number": NSNull()] as [String: Any]) }
    else { finish("outcome_unknown") }
  }
  func resignActive() {
    if phase == "confirmation" { cancel() }
  }
  func pick(_ presenter: UIViewController, id: String, promise: Promise) {
    guard begin(id, phase: "picker", promise: promise) else { return }
    let picker = CNContactPickerViewController()
    picker.displayedPropertyKeys = [CNContactPhoneNumbersKey]
    picker.predicateForEnablingContact = NSPredicate(format: "phoneNumbers.@count > 0")
    picker.predicateForSelectionOfContact = NSPredicate(value: false)
    picker.predicateForSelectionOfProperty = NSPredicate(format: "key == %@", CNContactPhoneNumbersKey)
    picker.delegate = self
    picker.isModalInPresentation = true
    controller = picker
    presenter.present(picker, animated: true)
  }
  func contactPickerDidCancel(_ picker: CNContactPickerViewController) {
    guard picker === controller else { return }
    finish(["outcome": "cancelled", "number": NSNull()] as [String: Any])
  }
  func contactPicker(_ picker: CNContactPickerViewController, didSelect contactProperty: CNContactProperty) {
    guard picker === controller, fresh, foreground(), contactProperty.key == CNContactPhoneNumbersKey,
      let phone = contactProperty.value as? CNPhoneNumber else { cancel(); return }
    let number = phone.stringValue
    guard number.utf16.count <= 64, number.range(of: #"^[+0-9 ()-]+$"#, options: .regularExpression) != nil else { cancel(); return }
    finish(["outcome": "selected", "number": number])
  }
  func open(_ presenter: UIViewController, id: String, encoded: String, promise: Promise, expiresAt: Double? = nil) {
    let remaining = expiresAt.map { ($0 - Date().timeIntervalSince1970 * 1000) / 1000 } ?? 60
    guard remaining.isFinite, remaining > 0, remaining <= 185 else {
      promise.reject("ERR_COMMUNICATION_EXPIRED", "Review a fresh communication request."); return
    }
    let draft: CommunicationDraft
    do { draft = try CommunicationDraft(encoded) }
    catch { promise.reject("ERR_COMMUNICATION_INPUT", "Review one international number and the message."); return }
    guard (draft.kind != "sms" || MFMessageComposeViewController.canSendText()),
      (draft.kind != "dial" || UIApplication.shared.canOpenURL(URL(string: "tel:" + draft.number)!)) else {
      promise.reject("ERR_COMMUNICATION_UNAVAILABLE", "Use the phone's Phone or Messages app directly."); return
    }
    guard begin(id, phase: "confirmation", promise: promise, lifetime: min(60, remaining)) else { return }
    let ticket = generation
    let alert = UIAlertController(title: draft.kind == "dial" ? "Open phone request?" : "Open message composer?",
      message: "Number: \(draft.number)\n" + (draft.kind == "sms" ? "\nMessage:\n\(draft.body)\n" : "") +
        "\nReview again in the phone interface and choose Call or Send yourself. Charges may apply. That app may retain drafts, messages or call history; Contexify sign-out cannot remove them.", preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in
      guard self?.requestId == id, self?.generation == ticket else { return }; self?.finish("cancelled")
    })
    alert.addAction(UIAlertAction(title: "Open", style: .default) { [weak self, weak presenter, weak alert] _ in
      guard let self, self.generation == ticket, self.requestId == id else { return }
      guard self.fresh, self.foreground(), let presenter, let alert else { self.cancel(id); return }
      self.controller = nil
      self.phase = "opening"
      // Wait for dismissal of this exact native approval before presenting the composer.
      alert.dismiss(animated: false) { [weak self, weak presenter] in
        guard let self, self.generation == ticket, self.requestId == id else { return }
        guard self.fresh, self.foreground(), let presenter else { self.cancel(id); return }
        if draft.kind == "sms" {
          guard MFMessageComposeViewController.canSendText() else { self.finish("failed"); return }
          let composer = MFMessageComposeViewController()
          composer.recipients = [draft.number]; composer.body = draft.body
          composer.messageComposeDelegate = self
          composer.isModalInPresentation = true
          self.controller = composer; self.phase = "composer"
          self.arm(id, seconds: 300)
          presenter.present(composer, animated: true)
        } else {
          UIApplication.shared.open(URL(string: "tel:" + draft.number)!, options: [:]) { [weak self] opened in
            guard let self, self.generation == ticket, self.requestId == id else { return }
            self.finish(opened ? "handoff_requested" : "failed")
          }
        }
      }
    })
    controller = alert
    presenter.present(alert, animated: true)
  }
  func messageComposeViewController(_ controller: MFMessageComposeViewController, didFinishWith result: MessageComposeResult) {
    guard controller === self.controller else { return }
    switch result {
    case .sent: finish("sent_in_composer")
    case .cancelled: finish("cancelled_in_composer")
    case .failed: finish("failed")
    @unknown default: finish("outcome_unknown")
    }
  }
}
