import ActivityKit
import ExpoModulesCore

struct LiveStateRecord: Record {
  @Field var title: String = ""
  @Field var subtitle: String = ""
  @Field var startEpoch: Double? = nil
  @Field var endEpoch: Double? = nil
  @Field var paused: Bool = false
  @Field var pausedRemaining: Double? = nil
  @Field var status: String? = nil
  @Field var colorHex: String = "#8da38a"
  @Field var symbol: String = "sparkles"

  var contentState: NudgeActivityAttributes.ContentState {
    .init(
      title: title, subtitle: subtitle, startEpoch: startEpoch, endEpoch: endEpoch,
      paused: paused, pausedRemaining: pausedRemaining, status: status,
      colorHex: colorHex, symbol: symbol
    )
  }
}

struct LiveAlertRecord: Record {
  @Field var title: String = ""
  @Field var body: String = ""
}

/// Live Activities (Dynamic Island + lock screen) for focus sessions,
/// reminders, the current workday block and buddy calls.
public class LiveActivityModule: Module {
  private var tokenTasks: [String: Task<Void, Never>] = [:]
  private var pushToStartTask: Task<Void, Never>?

  public func definition() -> ModuleDefinition {
    Name("LiveActivity")

    Events("onPushToken", "onPushToStartToken", "onActivityEnded")

    OnCreate {
      // Watch activities that outlived the last JS session (app relaunch)
      for activity in Activity<NudgeActivityAttributes>.activities {
        self.observe(activity)
      }
      if #available(iOS 17.2, *) {
        self.pushToStartTask = Task { [weak self] in
          for await data in Activity<NudgeActivityAttributes>.pushToStartTokenUpdates {
            self?.sendEvent("onPushToStartToken", ["token": data.hexString])
          }
        }
      }
    }

    OnDestroy {
      self.tokenTasks.values.forEach { $0.cancel() }
      self.pushToStartTask?.cancel()
    }

    Function("areActivitiesEnabled") { () -> Bool in
      ActivityAuthorizationInfo().areActivitiesEnabled
    }

    /// Running activities as [{ id, kind }]
    Function("list") { () -> [[String: String]] in
      Activity<NudgeActivityAttributes>.activities
        .filter { $0.activityState == .active || $0.activityState == .stale }
        .map { ["id": $0.id, "kind": $0.attributes.kind] }
    }

    /// Returns the ActivityKit id. Rejects with the reason when iOS refuses.
    AsyncFunction("start") { (kind: String, state: LiveStateRecord, staleEpoch: Double?) -> String in
      guard ActivityAuthorizationInfo().areActivitiesEnabled else {
        throw LiveActivityError("Live Activities are turned off for Nudge Buddy (Settings → Nudge Buddy → Live Activities)")
      }
      let attributes = NudgeActivityAttributes(kind: kind)
      let content = ActivityContent(state: state.contentState, staleDate: staleEpoch.map { Date(timeIntervalSince1970: $0) })
      do {
        // Push updates let the backend move the island while the app is suspended…
        let activity = try Activity.request(attributes: attributes, content: content, pushType: .token)
        self.observe(activity)
        return activity.id
      } catch {
        // …but they need the push entitlement, which free Apple ID builds don't
        // have. Fall back to an activity the app updates itself.
        do {
          let activity = try Activity.request(attributes: attributes, content: content, pushType: nil)
          self.observe(activity)
          return activity.id
        } catch let fallback {
          throw LiveActivityError("Live Activity request failed: \(fallback.localizedDescription) (with push: \(error.localizedDescription))")
        }
      }
    }

    AsyncFunction("update") { (id: String, state: LiveStateRecord, alert: LiveAlertRecord?, staleEpoch: Double?) in
      guard let activity = self.find(id) else { return }
      let content = ActivityContent(state: state.contentState, staleDate: staleEpoch.map { Date(timeIntervalSince1970: $0) })
      if let alert = alert {
        await activity.update(content, alertConfiguration: AlertConfiguration(
          title: LocalizedStringResource(stringLiteral: alert.title),
          body: LocalizedStringResource(stringLiteral: alert.body),
          sound: .default
        ))
      } else {
        await activity.update(content)
      }
    }

    /// Ends one activity; `dismissAfter` seconds keeps the final state on the lock screen
    AsyncFunction("end") { (id: String, state: LiveStateRecord?, dismissAfter: Double?) in
      guard let activity = self.find(id) else { return }
      let policy: ActivityUIDismissalPolicy = dismissAfter.map { .after(Date().addingTimeInterval($0)) } ?? .immediate
      let content = state.map { ActivityContent(state: $0.contentState, staleDate: nil) }
      await activity.end(content, dismissalPolicy: policy)
    }

    AsyncFunction("endAll") { (kind: String?) in
      for activity in Activity<NudgeActivityAttributes>.activities where kind == nil || activity.attributes.kind == kind {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
    }
  }

  private func find(_ id: String) -> Activity<NudgeActivityAttributes>? {
    Activity<NudgeActivityAttributes>.activities.first { $0.id == id }
  }

  /// Forward the activity's APNs push token (the backend uses it to update the
  /// activity while the app is suspended) and tell JS when it ends.
  private func observe(_ activity: Activity<NudgeActivityAttributes>) {
    guard tokenTasks[activity.id] == nil else { return }
    let id = activity.id
    let kind = activity.attributes.kind
    tokenTasks[id] = Task { [weak self] in
      await withTaskGroup(of: Void.self) { group in
        group.addTask {
          for await data in activity.pushTokenUpdates {
            self?.sendEvent("onPushToken", ["id": id, "kind": kind, "token": data.hexString])
          }
        }
        group.addTask {
          for await state in activity.activityStateUpdates where state == .ended || state == .dismissed {
            self?.sendEvent("onActivityEnded", ["id": id, "kind": kind])
            break
          }
        }
      }
      self?.tokenTasks.removeValue(forKey: id)
    }
  }
}

struct LiveActivityError: LocalizedError {
  let message: String
  init(_ message: String) { self.message = message }
  var errorDescription: String? { message }
}

private extension Data {
  var hexString: String { map { String(format: "%02x", $0) }.joined() }
}
