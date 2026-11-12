import ExpoModulesCore
import Security
import LocalAuthentication
import CryptoKit
import UIKit

public class AssistantDeviceSecurityModule: Module {
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

  public func definition() -> ModuleDefinition {
    Name("AssistantDeviceSecurity")

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

    AsyncFunction("deleteKey") { (id: String) in
      let status = SecItemDelete(try self.query(id) as CFDictionary)
      guard status == errSecSuccess || status == errSecItemNotFound else { throw self.failure() }
      let marker = try self.marker(id)
      if FileManager.default.fileExists(atPath: marker.path) { try FileManager.default.removeItem(at: marker) }
    }
  }
}
