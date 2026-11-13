import Foundation
import CryptoKit
import CoreFoundation

/** Compiled allowlist shared in meaning with Android and server schemas. */
enum SimulationPolicy {
  struct Envelope {
    let fields: [String: Any]
    let snapshot: Data
    let revision: Int
    let label: String
  }
  static func invalid() -> NSError {
    NSError(domain: "ContexifySimulation", code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Unsupported or expired simulation payload."])
  }
  static func integer(_ value: Any?) throws -> Int {
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
          number.doubleValue.isFinite, number.doubleValue.rounded() == number.doubleValue,
          number.doubleValue >= 0, number.doubleValue <= Double(Int32.max) else { throw invalid() }
    return number.intValue
  }
  static func validate(_ payload: String) throws -> Envelope {
    guard payload.utf8.count <= 2048,
          let data = payload.data(using: .utf8),
          let fields = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          let purpose = fields["purpose"] as? String else { throw invalid() }
    let base: Set<String> = ["protocol_version", "mode", "purpose", "policy_version", "origin", "user_id",
      "device_id", "installation_id", "public_key", "session_hash", "task_id", "action_id", "action_revision",
      "arguments_json", "arguments_digest", "nonce", "challenge_id", "expires_at"]
    let extra: Set<String>
    switch purpose {
    case "assistant_simulation_authorize": extra = []
    case "assistant_simulation_claim": extra = ["permit_hash"]
    case "assistant_simulation_receipt": extra = ["claim_id", "outcome"]
    default: throw invalid()
    }
    guard Set(fields.keys) == base.union(extra), fields["mode"] as? String == "simulation",
          try integer(fields["protocol_version"]) == 1, try integer(fields["policy_version"]) == 1,
          let expiry = fields["expires_at"] as? Double, expiry.isFinite,
          expiry > Date().timeIntervalSince1970, expiry <= Date().timeIntervalSince1970 + 65 else { throw invalid() }
    let identifiers = ["task_id", "action_id", "device_id", "installation_id", "challenge_id"] +
      (purpose == "assistant_simulation_receipt" ? ["claim_id"] : [])
    for key in identifiers {
      guard let value = fields[key] as? String, UUID(uuidString: value)?.uuidString.lowercased() == value else { throw invalid() }
    }
    func matches(_ key: String, _ pattern: String) -> Bool {
      guard let value = fields[key] as? String else { return false }
      return value.range(of: pattern, options: .regularExpression) != nil
    }
    guard matches("nonce", "^[A-Za-z0-9_-]{43}$"), matches("session_hash", "^[a-f0-9]{64}$") else { throw invalid() }
    if purpose == "assistant_simulation_claim" && !matches("permit_hash", "^[a-f0-9]{64}$") { throw invalid() }
    if purpose == "assistant_simulation_receipt" && !["simulated", "failed", "outcome_unknown"].contains(fields["outcome"] as? String ?? "") { throw invalid() }
    guard let encoded = fields["arguments_json"] as? String,
          let bytes = encoded.data(using: .utf8),
          fields["arguments_digest"] as? String == SHA256.hash(data: bytes).map({ String(format: "%02x", $0) }).joined(),
          let action = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
          try integer(action["schema_version"]) == 1 else { throw invalid() }
    let label: String
    switch action["capability_id"] as? String {
    case "brightness.set_app":
      guard Set(action.keys) == ["capability_id", "schema_version", "percent"] else { throw invalid() }
      let percent = try integer(action["percent"])
      guard (10...100).contains(percent) else { throw invalid() }
      label = "Set app brightness to \(percent)%"
    case "application.open":
      guard Set(action.keys) == ["capability_id", "schema_version", "application_id"],
            let application = action["application_id"] as? String, ["spotify", "clock"].contains(application) else { throw invalid() }
      label = "Open \(application)"
    default: throw invalid() // Media volume has no iOS adapter in the compiled catalog.
    }
    let snapshotKeys = ["origin", "user_id", "device_id", "installation_id", "public_key", "session_hash",
      "task_id", "action_id", "arguments_digest", "arguments_json"]
    let snapshot = try snapshotKeys.map { key -> String in
      guard let value = fields[key] as? String else { throw invalid() }
      return value
    }
    return Envelope(fields: fields, snapshot: try JSONSerialization.data(withJSONObject: snapshot),
                    revision: try integer(fields["action_revision"]), label: label)
  }
}
