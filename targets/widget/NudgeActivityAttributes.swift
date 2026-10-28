import ActivityKit
import Foundation

// Keep in sync with modules/live-activity/ios/NudgeActivityAttributes.swift —
// ActivityKit matches the two copies by type name and Codable shape.
// Times are plain epoch seconds so the backend can push updates without
// caring about Swift's Date encoding.
struct NudgeActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    var title: String
    var subtitle: String
    /// Phase / block / call start (epoch seconds)
    var startEpoch: Double?
    /// Countdown target (epoch seconds)
    var endEpoch: Double?
    var paused: Bool
    /// Seconds left when paused
    var pausedRemaining: Double?
    /// Call: "Listening", "Speaking", "Muted"…
    var status: String?
    var colorHex: String
    /// SF Symbol shown in the island
    var symbol: String
  }

  /// "focus" | "reminder" | "block" | "call"
  var kind: String
}
