#if canImport(AlarmKit)
import AlarmKit
import Foundation

/** Shared with the widget target. No title, account, credentials or other private content. */
@available(iOS 26.0, *)
public struct ContexifyAlarmMetadata: AlarmMetadata {
  public let id: UUID
  public init(id: UUID) { self.id = id }
}
#endif
