import Foundation

final class AppleScheduleRedirectGuard: NSObject, URLSessionTaskDelegate {
  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                  newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

struct AppleScheduleHTTPFailure: Error { let status: Int }

/** Fixed HTTPS origin and reminder scope; no cookies, redirects, retries or model-selected URLs. */
@MainActor final class AppleScheduleProtocol {
  let origin: String
  let user: String
  let installation: String
  let publicKey: String
  private let active: () throws -> Void
  private let delegate = AppleScheduleRedirectGuard()
  private let session: URLSession
  private let deadline = ProcessInfo.processInfo.systemUptime + 120
  private var deviceId: String?
  init(origin: String, user: String, installation: String, publicKey: String, active: @escaping () throws -> Void) throws {
    guard let url = URLComponents(string: origin), url.scheme == "https", url.host != nil,
          url.user == nil, url.password == nil, url.path.isEmpty, url.query == nil, url.fragment == nil,
          url.port == nil || url.port == 443 else { throw AppleScheduleFailure.invalid }
    self.origin = origin; self.user = user; self.installation = installation; self.publicKey = publicKey; self.active = active
    let config = URLSessionConfiguration.ephemeral
    config.httpCookieStorage = nil; config.httpShouldSetCookies = false; config.urlCredentialStorage = nil
    config.requestCachePolicy = .reloadIgnoringLocalCacheData; config.urlCache = nil
    config.timeoutIntervalForRequest = 5; config.timeoutIntervalForResource = 8
    session = URLSession(configuration: config, delegate: delegate, delegateQueue: nil)
  }
  func cancel() { session.invalidateAndCancel() }
  func check() throws {
    try active()
    guard ProcessInfo.processInfo.systemUptime < deadline else { throw AppleScheduleFailure.interrupted }
  }
  func post(_ token: String, _ path: String, _ body: [String: Any] = [:]) async throws -> [String: Any] {
    try check()
    guard token.range(of: #"^[A-Za-z0-9_-]{43}$"#, options: .regularExpression) != nil,
          path.range(of: #"^/(sessions|storage|operations(?:/identity)?|stored/(?:list|read|save)|tasks/[a-f0-9-]{36}/(?:cancel|authorization-challenge|authorize|claim|receipt-challenge|receipt))$"#, options: .regularExpression) != nil,
          let url = URL(string: origin + "/api/v1/assistant/reminder" + path) else { throw AppleScheduleFailure.invalid }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"; request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.httpBody = try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys, .withoutEscapingSlashes])
    guard request.httpBody!.count <= 8192 else { throw AppleScheduleFailure.invalid }
    let (bytes, response) = try await session.bytes(for: request)
    guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
      throw AppleScheduleHTTPFailure(status: (response as? HTTPURLResponse)?.statusCode ?? 0)
    }
    var data = Data()
    for try await byte in bytes {
      guard data.count < 65536 else { throw AppleScheduleFailure.limit }
      data.append(byte)
    }
    try check()
    guard let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw AppleScheduleFailure.invalid }
    return value
  }
  func scope(_ management: String) async throws -> String {
    let result = try await post(management, "/sessions")
    guard result["scope"] as? String == "assistant:reminder", let token = result["access_token"] as? String else { throw AppleScheduleFailure.unauthorized }
    let identity = try await post(token, "/operations/identity")
    guard try AppleScheduleJSON.integer(identity["protocol_version"]) == 2,
          identity["origin"] as? String == origin, identity["user_id"] as? String == user,
          identity["installation_id"] as? String == installation, identity["public_key"] as? String == publicKey,
          let device = identity["device_id"] as? String else { throw AppleScheduleFailure.unauthorized }
    _ = try AppleScheduleJSON.id(device)
    deviceId = device
    return token
  }
  func envelope(_ challenge: [String: Any], purpose: String, revision: Int, token: String,
                task: String, action: [String: Any]) throws -> String {
    try check()
    guard let payload = challenge["payload"] as? String else { throw AppleScheduleFailure.invalid }
    let value = try AppleScheduleJSON.object(payload)
    var keys: Set<String> = ["protocol_version", "mode", "policy_version", "purpose", "origin", "user_id", "device_id", "installation_id", "public_key", "session_hash", "task_id", "action_revision", "arguments_json", "arguments_digest", "nonce", "challenge_id", "expires_at"]
    if purpose == "claim" { keys.insert("permit_hash") }
    else if purpose == "receipt" { keys.formUnion(["claim_id", "outcome"]) }
    else if purpose != "authorize" { throw AppleScheduleFailure.invalid }
    try AppleScheduleJSON.fields(value, keys)
    guard try AppleScheduleJSON.integer(value["protocol_version"]) == 1,
          try AppleScheduleJSON.integer(value["policy_version"]) == 1,
          try AppleScheduleJSON.integer(value["action_revision"]) == revision,
          value["mode"] as? String == "reminder", value["purpose"] as? String == "assistant_reminder_" + purpose,
          value["origin"] as? String == origin, value["user_id"] as? String == user,
          value["installation_id"] as? String == installation, value["public_key"] as? String == publicKey,
          value["session_hash"] as? String == AppleScheduleJSON.hash(token), value["task_id"] as? String == task,
          let id = value["challenge_id"] as? String, id == challenge["challenge_id"] as? String,
          let device = value["device_id"] as? String, let nonce = value["nonce"] as? String,
          device == deviceId,
          nonce.range(of: #"^[A-Za-z0-9_-]{43}$"#, options: .regularExpression) != nil,
          let expiry = value["expires_at"] as? Double, expiry.isFinite,
          expiry > Date().timeIntervalSince1970, expiry <= Date().timeIntervalSince1970 + 65,
          expiry == challenge["expires_at"] as? Double,
          let encoded = value["arguments_json"] as? String,
          value["arguments_digest"] as? String == AppleScheduleJSON.hash(encoded),
          try AppleScheduleJSON.text(AppleScheduleJSON.object(encoded)) == AppleScheduleJSON.text(action) else { throw AppleScheduleFailure.unauthorized }
    _ = try AppleScheduleJSON.id(id); _ = try AppleScheduleJSON.id(device)
    return payload
  }
}
