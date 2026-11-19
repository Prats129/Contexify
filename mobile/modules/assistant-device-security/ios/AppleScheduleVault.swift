import Foundation
import Security
import CryptoKit

/** Device-only AES-GCM metadata. The key and encrypted file are excluded from restore. */
final class AppleScheduleVault {
  private let tag = "ai.contexify.assistant.schedules.v1"
  private let context = Data("contexify-ios-schedules-v1".utf8)
  private func root() throws -> URL {
    var root = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
      .appendingPathComponent("assistant-schedules", isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true,
      attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
    var values = URLResourceValues(); values.isExcludedFromBackup = true; try root.setResourceValues(values)
    return root
  }
  private func query() -> [String: Any] {
    [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: tag,
     kSecAttrAccount as String: "key", kSecAttrSynchronizable as String: false]
  }
  private func key(create: Bool) throws -> SymmetricKey {
    var query = query(); query[kSecReturnData as String] = true
    var value: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &value)
    if status == errSecSuccess, let bytes = value as? Data, bytes.count == 32 { return SymmetricKey(data: bytes) }
    guard create, status == errSecItemNotFound else { throw AppleScheduleFailure.unauthorized }
    var bytes = Data(count: 32)
    let random = bytes.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 32, $0.baseAddress!) }
    guard random == errSecSuccess else { throw AppleScheduleFailure.unavailable }
    var add = self.query(); add[kSecValueData as String] = bytes
    add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    guard SecItemAdd(add as CFDictionary, nil) == errSecSuccess else { throw AppleScheduleFailure.unavailable }
    return SymmetricKey(data: bytes)
  }
  func load(owner: String) throws -> AppleScheduleState? {
    let path = try root().appendingPathComponent("state.aesgcm")
    guard FileManager.default.fileExists(atPath: path.path) else { return nil }
    let attributes = try FileManager.default.attributesOfItem(atPath: path.path)
    guard let size = attributes[.size] as? NSNumber, size.intValue <= 524288 else { throw AppleScheduleFailure.invalid }
    let clear = try AES.GCM.open(AES.GCM.SealedBox(combined: Data(contentsOf: path)), using: key(create: false), authenticating: context)
    let state = try JSONDecoder().decode(AppleScheduleState.self, from: clear)
    guard state.version == 1, state.owner == owner, state.entries.count <= 40,
          Set(state.entries.map(\.id)).count == state.entries.count else { throw AppleScheduleFailure.unauthorized }
    return state
  }
  func save(_ state: AppleScheduleState) throws {
    guard state.entries.count <= 40 else { throw AppleScheduleFailure.limit }
    let clear = try JSONEncoder().encode(state)
    guard clear.count <= 500000, let sealed = try AES.GCM.seal(clear, using: key(create: true), authenticating: context).combined else { throw AppleScheduleFailure.limit }
    let path = try root().appendingPathComponent("state.aesgcm")
    try sealed.write(to: path, options: [.atomic, .completeFileProtection])
  }
  func erase() throws {
    let path = try root().appendingPathComponent("state.aesgcm")
    if FileManager.default.fileExists(atPath: path.path) { try FileManager.default.removeItem(at: path) }
    let status = SecItemDelete(query() as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else { throw AppleScheduleFailure.unavailable }
  }
  func cleanupPending() throws -> Bool {
    FileManager.default.fileExists(atPath: try root().appendingPathComponent("cleanup.pending").path)
  }
  func markCleanup() throws {
    // Generic control metadata is writable after first unlock; private ciphertext stays Complete-protected.
    try Data([1]).write(to: root().appendingPathComponent("cleanup.pending"),
      options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
  }
  func finishCleanup() throws {
    let path = try root().appendingPathComponent("cleanup.pending")
    if FileManager.default.fileExists(atPath: path.path) { try FileManager.default.removeItem(at: path) }
  }
}
