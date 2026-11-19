import ExpoModulesCore
import Security
import LocalAuthentication
import CryptoKit
import UIKit

public class AssistantDeviceSecurityModule: Module {
  private struct Approval {
    let snapshot: Data
    let revision: Int
    let deadline: Date
  }
  private var approvals: [String: Approval] = [:]
  private var confirming = false
  private var cancelConfirmation: (() -> Void)?
  private var schedules: AppleScheduleController?
  private func failure() -> NSError {
    NSError(domain: "ContexifyDeviceSecurity", code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Device security unavailable. Unlock this device or enroll again."])
  }
  private func identifier(_ value: String) throws -> String {
    guard UUID(uuidString: value)?.uuidString.lowercased() == value else { throw failure() }
    return value
  }
  private func query(_ id: String) throws -> [String: Any] {
    [kSecClass as String: kSecClassKey,
     kSecAttrApplicationTag as String: Data(("ai.contexify.assistant." + (try identifier(id))).utf8),
     kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom]
  }
  private func marker(_ id: String) throws -> URL {
    let root = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                          appropriateFor: nil, create: true)
    var url = root.appendingPathComponent("assistant-" + (try identifier(id)))
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    // Set resource values after creating the marker, in createKey.
    if FileManager.default.fileExists(atPath: url.path) { try url.setResourceValues(values) }
    return url
  }
  private func binding(_ origin: String, _ user: String) -> Data {
    Data(SHA256.hash(data: Data((origin + "\n" + user).utf8)))
  }
  private func unlocked() throws {
    guard UIApplication.shared.isProtectedDataAvailable,
          UIApplication.shared.applicationState == .active,
          LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) else { throw failure() }
  }
  private func key(_ id: String) throws -> SecKey {
    var attributes = try query(id)
    attributes[kSecReturnRef as String] = true
    var result: CFTypeRef?
    guard SecItemCopyMatching(attributes as CFDictionary, &result) == errSecSuccess,
          let result else { throw failure() }
    return result as! SecKey
  }
  private func publicKey(_ key: SecKey) throws -> String {
    guard let publicKey = SecKeyCopyPublicKey(key),
          let bytes = SecKeyCopyExternalRepresentation(publicKey, nil) else { throw failure() }
    return (bytes as Data).base64EncodedString()
  }

  private func simulation(_ id: String, _ payload: String) throws -> SimulationPolicy.Envelope {
    try unlocked()
    let envelope = try SimulationPolicy.validate(payload)
    guard envelope.fields["installation_id"] as? String == id,
          envelope.fields["public_key"] as? String == (try publicKey(key(id))),
          let origin = envelope.fields["origin"] as? String, let user = envelope.fields["user_id"] as? String,
          try Data(contentsOf: marker(id)) == binding(origin, user) else { throw failure() }
    approvals = approvals.filter { $0.value.deadline > Date() }
    return envelope
  }
  private func sign(_ id: String, _ payload: String) throws -> String {
    guard let signature = SecKeyCreateSignature(try key(id), .ecdsaSignatureMessageX962SHA256,
                                               Data(payload.utf8) as CFData, nil) else { throw failure() }
    return (signature as Data).base64EncodedString()
  }
  private func resetSimulation() {
    approvals.removeAll()
    cancelConfirmation?()
  }

  public func definition() -> ModuleDefinition {
    Name("AssistantDeviceSecurity")
    OnAppEntersBackground { Task { @MainActor in self.schedules?.cancel(); self.resetSimulation() } }
    OnDestroy { Task { @MainActor in self.schedules?.cancel(); self.schedules = nil; self.resetSimulation() } }

    Function("reminderSupport") { AppleScheduleDriver.enabled }
    Function("appleAlarmSupport") { AppleScheduleDriver.alarmsSupported }
    Function("appleTimerSupport") { AppleScheduleDriver.timerSupported }
    AsyncFunction("requestReminderNotifications") { (promise: Promise) -> Void in
      Task { @MainActor in
        guard UIApplication.shared.applicationState == .active else { promise.reject("ERR_VOICE_FOREGROUND", "Open this app first."); return }
        do { promise.resolve(["granted": try await AppleScheduleDriver().requestNotifications()]) }
        catch { promise.resolve(["granted": false]) }
      }
    }.runOnQueue(.main)
    AsyncFunction("requestAppleAlarmPermission") { (promise: Promise) -> Void in
      Task { @MainActor in
        guard UIApplication.shared.applicationState == .active else { promise.resolve(false); return }
        do { promise.resolve(try await AppleScheduleDriver().requestAlarms()) } catch { promise.resolve(false) }
      }
    }.runOnQueue(.main)
    AsyncFunction("cancelReminders") { () -> Void in Task { @MainActor in self.schedules?.cancel() } }.runOnQueue(.main)
    AsyncFunction("clearReminders") { (promise: Promise) -> Void in
      Task { @MainActor in
        do { try await self.scheduleController().clear(); promise.resolve() }
        catch { promise.reject("ERR_REMINDER_CLEANUP", "Check this app's pending alerts in Settings. Cleanup will be checked again before scheduling.") }
      }
    }.runOnQueue(.main)
    AsyncFunction("readReminders") { (origin: String, user: String, installation: String, token: String, promise: Promise) in
      self.scheduleCall(promise) { try await $0.read(origin, user, installation, token) }
    }.runOnQueue(.main)
    AsyncFunction("readAppleAlarms") { (origin: String, user: String, installation: String, token: String, promise: Promise) in
      self.scheduleCall(promise) { try await $0.read(origin, user, installation, token, alarms: true) }
    }.runOnQueue(.main)
    AsyncFunction("executeReminder") { (origin: String, user: String, installation: String, token: String, kind: String, payload: String, promise: Promise) in
      self.scheduleCall(promise) { try await $0.execute(origin, user, installation, token, kind: kind, encoded: payload) }
    }.runOnQueue(.main)
    AsyncFunction("executeAppleAlarm") { (origin: String, user: String, installation: String, token: String, kind: String, delivery: String, payload: String, promise: Promise) in
      self.scheduleCall(promise) { try await $0.execute(origin, user, installation, token, kind: kind, encoded: payload, delivery: delivery) }
    }.runOnQueue(.main)
    AsyncFunction("listSavedReminders") { (origin: String, user: String, installation: String, token: String, after: String?, promise: Promise) in
      self.scheduleCall(promise) { try await $0.saved(origin, user, installation, token, after: after) }
    }.runOnQueue(.main)
    AsyncFunction("saveReminderCopy") { (origin: String, user: String, installation: String, token: String, id: String, promise: Promise) in
      self.scheduleCall(promise) { try await $0.saveCopy(origin, user, installation, token, id: id) }
    }.runOnQueue(.main)

    AsyncFunction("createKey") { (origin: String, userId: String) -> [String: String] in
      try self.unlocked()
      guard let url = URLComponents(string: origin), url.scheme == "https", url.host != nil,
            url.path.isEmpty, url.user == nil, url.password == nil,
            url.query == nil, url.fragment == nil, (url.port == nil || url.port == 443),
            !userId.isEmpty, userId.utf8.count <= 128, !userId.contains("\n") else { throw self.failure() }
      let id = UUID().uuidString.lowercased()
      guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
                                                        .privateKeyUsage, nil) else { throw self.failure() }
      let attributes: [String: Any] = [
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
        kSecAttrKeySizeInBits as String: 256,
        kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
        kSecPrivateKeyAttrs as String: [
          kSecAttrIsPermanent as String: true,
          kSecAttrApplicationTag as String: Data(("ai.contexify.assistant." + id).utf8),
          kSecAttrAccessControl as String: access
        ]
      ]
      // No exportable/software fallback if Secure Enclave is unavailable.
      guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, nil) else { throw self.failure() }
      do {
        let marker = try self.marker(id)
        try self.binding(origin, userId).write(to: marker, options: [.atomic, .completeFileProtection])
        _ = try self.marker(id)
        return ["installation_id": id, "public_key": try self.publicKey(key)]
      } catch {
        SecItemDelete(try self.query(id) as CFDictionary)
        throw self.failure()
      }
    }.runOnQueue(.main)

    AsyncFunction("signChallenge") { (id: String, payload: String) -> String in
      try self.unlocked()
      guard payload.utf8.count <= 2048,
            let data = payload.data(using: .utf8),
            let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            object["protocol_version"] as? Int == 1,
            ["enroll", "session"].contains(object["purpose"] as? String ?? ""),
            object["platform"] as? String == "ios",
            object["installation_id"] as? String == id,
            let origin = object["origin"] as? String, let user = object["user_id"] as? String,
            let expiry = object["expires_at"] as? Double, expiry.isFinite,
            expiry > Date().timeIntervalSince1970, expiry <= Date().timeIntervalSince1970 + 65,
            try Data(contentsOf: self.marker(id)) == self.binding(origin, user) else { throw self.failure() }
      let key = try self.key(id)
      guard object["public_key"] as? String == (try self.publicKey(key)),
            let signature = SecKeyCreateSignature(key, .ecdsaSignatureMessageX962SHA256, data as CFData, nil)
      else { throw self.failure() }
      return (signature as Data).base64EncodedString()
    }.runOnQueue(.main)

    AsyncFunction("confirmSimulation") { (id: String, payload: String, promise: Promise) in
      guard !self.confirming else { promise.reject(self.failure()); return }
      do {
        let envelope = try self.simulation(id, payload)
        guard envelope.fields["purpose"] as? String == "assistant_simulation_authorize", envelope.revision == 1,
              self.approvals.count < 32,
              let scene = UIApplication.shared.connectedScenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene,
              var presenter = scene.windows.first(where: { $0.isKeyWindow })?.rootViewController else { throw self.failure() }
        while let presented = presenter.presentedViewController { presenter = presented }
        guard !presenter.isBeingDismissed, presenter.viewIfLoaded?.window != nil else { throw self.failure() }
        let dialog = UIAlertController(title: "Simulation only",
          message: envelope.label + "\n\nNo device action will be performed.", preferredStyle: .alert)
        self.confirming = true
        var settled = false
        var expiry: DispatchWorkItem?
        func finish(_ signature: String?, error: Error? = nil) {
          guard !settled else { return }
          settled = true
          expiry?.cancel()
          expiry = nil
          self.confirming = false
          self.cancelConfirmation = nil
          if let error { promise.reject(error) } else { promise.resolve(signature) }
        }
        dialog.addAction(UIAlertAction(title: "Approve simulation", style: .default) { _ in
          guard !settled else { return }
          do {
            let current = try self.simulation(id, payload)
            guard current.snapshot == envelope.snapshot, let action = current.fields["action_id"] as? String else { throw self.failure() }
            let signature = try self.sign(id, payload)
            self.approvals[action] = Approval(snapshot: current.snapshot, revision: 1, deadline: Date().addingTimeInterval(90))
            finish(signature)
          } catch { finish(nil, error: self.failure()) }
        })
        dialog.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in
          finish(nil)
        })
        self.cancelConfirmation = { finish(nil); dialog.dismiss(animated: false) }
        let timeout = DispatchWorkItem { self.cancelConfirmation?() }
        expiry = timeout
        presenter.present(dialog, animated: true)
        let remaining = max(0, min(65, (envelope.fields["expires_at"] as? Double ?? 0) - Date().timeIntervalSince1970))
        DispatchQueue.main.asyncAfter(deadline: .now() + remaining, execute: timeout)
      } catch { self.confirming = false; promise.reject(self.failure()) }
    }.runOnQueue(.main)

    AsyncFunction("signSimulationStep") { (id: String, payload: String) -> String in
      let envelope = try self.simulation(id, payload)
      guard let action = envelope.fields["action_id"] as? String, let approval = self.approvals[action],
            approval.snapshot == envelope.snapshot, envelope.revision == approval.revision + 1 else { throw self.failure() }
      switch envelope.fields["purpose"] as? String {
      case "assistant_simulation_claim":
        guard approval.revision == 1 else { throw self.failure() }
        self.approvals[action] = Approval(snapshot: approval.snapshot, revision: 2, deadline: approval.deadline)
      case "assistant_simulation_receipt":
        guard approval.revision == 2 else { throw self.failure() }
        self.approvals.removeValue(forKey: action)
      default: throw self.failure()
      }
      return try self.sign(id, payload)
    }.runOnQueue(.main)

    AsyncFunction("deleteKey") { (id: String, promise: Promise) -> Void in
      Task { @MainActor in
        do {
          try await self.scheduleController().clear()
          self.resetSimulation()
          let status = SecItemDelete(try self.query(id) as CFDictionary)
          guard status == errSecSuccess || status == errSecItemNotFound else { throw self.failure() }
          let marker = try self.marker(id)
          if FileManager.default.fileExists(atPath: marker.path) { try FileManager.default.removeItem(at: marker) }
          promise.resolve()
        } catch { promise.reject("ERR_REMINDER_CLEANUP", "Check pending app alerts before forgetting this device.") }
      }
    }.runOnQueue(.main)
  }

  private func scheduleCall(_ promise: Promise, work: @escaping @MainActor (AppleScheduleController) async throws -> String) {
    Task { @MainActor in
      do {
        let schedules = self.scheduleController()
        promise.resolve(try await work(schedules))
      } catch AppleScheduleFailure.unauthorized {
        promise.reject("ERR_REMINDER_AUTH", "Device scheduling authority changed. Sign in and enroll again.")
      } catch AppleScheduleFailure.gap {
        promise.reject("ERR_REMINDER_DST_GAP", "Choose a valid local time.")
      } catch AppleScheduleFailure.overlap {
        promise.reject("ERR_REMINDER_DST_OVERLAP", "Choose which occurrence of the repeated local time to use.")
      } catch AppleScheduleFailure.time {
        promise.reject("ERR_REMINDER_HORIZON", "Choose a time at least one minute ahead and within 90 days.")
      } catch AppleScheduleFailure.limit {
        promise.reject("ERR_APPLE_SCHEDULE_LIMIT", "At most 32 owned pending occurrences are supported. Cancel older requests or shorten the repetition.")
      } catch {
        promise.reject("ERR_REMINDER_UNAVAILABLE", "Scheduling is interrupted or unavailable. Check your existing alerts before trying again.")
      }
    }
  }

  @MainActor private func scheduleController() -> AppleScheduleController {
    if let schedules { return schedules }
    let controller = AppleScheduleController(binding: { [weak self] origin, user, installation in
      guard let self else { throw AppleScheduleFailure.unavailable }
      try self.unlocked()
      guard try Data(contentsOf: self.marker(installation)) == self.binding(origin, user) else { throw AppleScheduleFailure.unauthorized }
    }, publicKey: { [weak self] installation in
      guard let self else { throw AppleScheduleFailure.unavailable }
      return try self.publicKey(self.key(installation))
    }, sign: { [weak self] installation, payload in
      guard let self else { throw AppleScheduleFailure.unavailable }
      return try self.sign(installation, payload)
    }, acquire: { [weak self] in
      guard let self, !self.confirming else { throw AppleScheduleFailure.interrupted }
      self.confirming = true
    }, release: { [weak self] in self?.confirming = false })
    schedules = controller
    return controller
  }
}
