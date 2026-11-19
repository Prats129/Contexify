// swift-tools-version: 5.9
import PackageDescription

// Offline policy tests on a Mac; native UIKit/AlarmKit integration still needs the iOS target.
let package = Package(name: "AssistantSchedulePolicy", platforms: [.macOS(.v13), .iOS(.v16)], targets: [
  .target(name: "AssistantSchedulePolicy", path: "ios", exclude: ["AssistantDeviceSecurity.podspec", "PrivacyInfo.xcprivacy", "AssistantDeviceSecurityModule.swift", "SimulationPolicy.swift", "AppleScheduleController.swift", "AppleScheduleDriver.swift", "AppleScheduleVault.swift", "AppleAlarmMetadata.swift"], sources: ["AppleScheduleTypes.swift", "AppleScheduleProtocol.swift"]),
  .testTarget(name: "AssistantSchedulePolicyTests", dependencies: ["AssistantSchedulePolicy"], path: "ios-tests")
])
