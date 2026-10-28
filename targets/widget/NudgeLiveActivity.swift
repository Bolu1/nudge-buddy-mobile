import ActivityKit
import SwiftUI
import WidgetKit

private extension Color {
  init(hex: String) {
    let s = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
    var v: UInt64 = 0
    Scanner(string: s).scanHexInt64(&v)
    self.init(
      .sRGB,
      red: Double((v >> 16) & 0xff) / 255,
      green: Double((v >> 8) & 0xff) / 255,
      blue: Double(v & 0xff) / 255,
      opacity: 1
    )
  }
}

private let ink = Color(hex: "e7e1de")
private let muted = Color(hex: "8d928a")
private let surface = Color(hex: "151311")

private typealias State = NudgeActivityAttributes.ContentState

private func date(_ epoch: Double?) -> Date? {
  epoch.map { Date(timeIntervalSince1970: $0) }
}

private func clock(_ seconds: Double) -> String {
  let s = max(0, Int(seconds.rounded()))
  return s >= 3600
    ? String(format: "%d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60)
    : String(format: "%d:%02d", s / 60, s % 60)
}

private func deepLink(_ kind: String) -> URL? {
  switch kind {
  case "focus": return URL(string: "nudgebuddy://focus")
  case "block": return URL(string: "nudgebuddy://workday")
  default: return URL(string: "nudgebuddy://workspace")
  }
}

/// Live countdown (to endEpoch), live count-up (call duration), or a frozen value when paused
private struct TimeText: View {
  let state: State
  let kind: String

  var body: some View {
    if state.paused {
      Text(clock(state.pausedRemaining ?? 0))
    } else if let end = date(state.endEpoch), end > Date() {
      Text(timerInterval: Date()...end, countsDown: true)
    } else if kind == "call", let start = date(state.startEpoch) {
      Text(start, style: .timer)
    } else if kind == "reminder" {
      Text("Now")
    } else {
      Text("0:00")
    }
  }
}

/// Phase progress, driven by the system clock so it moves with the app closed
private struct PhaseProgress: View {
  let state: State

  var body: some View {
    if let start = date(state.startEpoch), let end = date(state.endEpoch), end > start {
      if state.paused, let left = state.pausedRemaining {
        let total = end.timeIntervalSince(start)
        ProgressView(value: max(0, min(1, (total - left) / total)))
          .tint(Color(hex: state.colorHex))
      } else {
        ProgressView(timerInterval: start...end, countsDown: false, label: { EmptyView() }, currentValueLabel: { EmptyView() })
          .tint(Color(hex: state.colorHex))
      }
    }
  }
}

private struct LockScreenView: View {
  let context: ActivityViewContext<NudgeActivityAttributes>

  var body: some View {
    let state = context.state
    let tint = Color(hex: state.colorHex)
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 12) {
        ZStack {
          Circle().fill(tint.opacity(0.18))
          Image(systemName: state.symbol).font(.system(size: 17, weight: .semibold)).foregroundColor(tint)
        }
        .frame(width: 38, height: 38)
        VStack(alignment: .leading, spacing: 2) {
          Text(state.title).font(.headline).foregroundColor(ink).lineLimit(1)
          Text(state.status.map { "\($0) · \(state.subtitle)" } ?? state.subtitle)
            .font(.subheadline).foregroundColor(muted).lineLimit(2)
        }
        Spacer(minLength: 8)
        TimeText(state: state, kind: context.attributes.kind)
          .font(.system(size: 28, weight: .semibold, design: .rounded))
          .monospacedDigit()
          .foregroundColor(state.paused ? muted : ink)
          .multilineTextAlignment(.trailing)
          .frame(maxWidth: 110, alignment: .trailing)
      }
      if context.attributes.kind == "focus" || context.attributes.kind == "block" {
        PhaseProgress(state: state)
      }
    }
    .padding(16)
  }
}

struct NudgeLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: NudgeActivityAttributes.self) { context in
      LockScreenView(context: context)
        .activityBackgroundTint(surface.opacity(0.94))
        .activitySystemActionForegroundColor(ink)
        .widgetURL(deepLink(context.attributes.kind))
    } dynamicIsland: { context in
      let state = context.state
      let tint = Color(hex: state.colorHex)
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          HStack(spacing: 8) {
            Image(systemName: state.symbol).foregroundColor(tint)
            Text(state.title).font(.headline).foregroundColor(ink).lineLimit(1)
          }
          .padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.trailing) {
          TimeText(state: state, kind: context.attributes.kind)
            .font(.system(.title3, design: .rounded).weight(.semibold))
            .monospacedDigit()
            .foregroundColor(state.paused ? muted : tint)
            .multilineTextAlignment(.trailing)
            .frame(maxWidth: 90, alignment: .trailing)
            .padding(.trailing, 4)
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(alignment: .leading, spacing: 8) {
            Text(state.status.map { "\($0) · \(state.subtitle)" } ?? state.subtitle)
              .font(.subheadline).foregroundColor(muted).lineLimit(2)
            if context.attributes.kind == "focus" || context.attributes.kind == "block" {
              PhaseProgress(state: state)
            }
          }
          .padding(.horizontal, 4)
        }
      } compactLeading: {
        Image(systemName: state.symbol).foregroundColor(tint)
      } compactTrailing: {
        TimeText(state: state, kind: context.attributes.kind)
          .monospacedDigit()
          .foregroundColor(state.paused ? muted : tint)
          .multilineTextAlignment(.trailing)
          .frame(maxWidth: 48)
      } minimal: {
        Image(systemName: state.symbol).foregroundColor(tint)
      }
      .widgetURL(deepLink(context.attributes.kind))
      .keylineTint(tint)
    }
  }
}
