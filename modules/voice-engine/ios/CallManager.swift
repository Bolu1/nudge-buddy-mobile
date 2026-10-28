import AVFoundation
import CallKit
import ExpoModulesCore
import PushKit

/// Owns CallKit + PushKit so the buddy can "call" the user while the app is
/// closed. iOS requires every VoIP push to be reported to CallKit immediately,
/// in native code, before JS is even loaded — so that happens here.
final class CallManager: NSObject {
  static let shared = CallManager()

  /// Set by VoiceEngineModule while JS is alive
  var emit: ((String, [String: Any]) -> Void)?

  private(set) var voipToken: String?
  private(set) var audioActive = false

  private let provider: CXProvider
  private let controller = CXCallController()
  private var registry: PKPushRegistry?
  private var calls: [UUID: [String: Any]] = [:]   // active call → push payload
  private var answered: Set<UUID> = []

  private override init() {
    let config = CXProviderConfiguration()
    config.supportsVideo = false
    config.maximumCallsPerCallGroup = 1
    config.maximumCallGroups = 1
    config.supportedHandleTypes = [.generic]
    config.includesCallsInRecents = false
    provider = CXProvider(configuration: config)
    super.init()
    provider.setDelegate(self, queue: .main)
  }

  func registerVoIP() {
    guard registry == nil else { return }
    let r = PKPushRegistry(queue: .main)
    r.delegate = self
    r.desiredPushTypes = [.voIP]
    registry = r
  }

  /// A call CallKit reported (and maybe the user answered) before JS was listening
  func pendingCall() -> [String: Any]? {
    guard let (uuid, payload) = calls.first else { return nil }
    return ["callId": uuid.uuidString, "payload": payload, "answered": answered.contains(uuid)]
  }

  func endCall(_ id: String) {
    guard let uuid = UUID(uuidString: id), calls[uuid] != nil else { return }
    let tx = CXTransaction(action: CXEndCallAction(call: uuid))
    controller.request(tx) { err in
      if let err = err { print("[CallManager] end call failed: \(err)") }
    }
  }

  func reportConnected(_ id: String) {
    guard let uuid = UUID(uuidString: id) else { return }
    provider.reportOutgoingCall(with: uuid, connectedAt: Date())
  }

  private func reportIncoming(payload: [String: Any], completion: @escaping () -> Void) {
    let uuid = (payload["callId"] as? String).flatMap(UUID.init(uuidString:)) ?? UUID()
    let update = CXCallUpdate()
    update.remoteHandle = CXHandle(type: .generic, value: "Nudge Buddy")
    update.localizedCallerName = (payload["title"] as? String) ?? "Nudge Buddy"
    update.hasVideo = false
    update.supportsHolding = false
    update.supportsGrouping = false
    update.supportsUngrouping = false
    update.supportsDTMF = false
    calls[uuid] = payload
    provider.reportNewIncomingCall(with: uuid, update: update) { [weak self] error in
      if let error = error {
        print("[CallManager] reportNewIncomingCall failed: \(error)")
        self?.calls.removeValue(forKey: uuid)
      }
      completion()
    }
  }
}

extension CallManager: PKPushRegistryDelegate {
  func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
    let token = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
    voipToken = token
    emit?("onVoipToken", ["token": token])
  }

  func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
    voipToken = nil
  }

  func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload, for type: PKPushType, completion: @escaping () -> Void) {
    var data: [String: Any] = [:]
    for (k, v) in payload.dictionaryPayload {
      if let key = k as? String { data[key] = v }
    }
    reportIncoming(payload: data, completion: completion)
  }
}

extension CallManager: CXProviderDelegate {
  func providerDidReset(_ provider: CXProvider) {
    for uuid in calls.keys { emit?("onCallEnded", ["callId": uuid.uuidString]) }
    calls.removeAll()
    answered.removeAll()
    audioActive = false
  }

  func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
    // Configure (not activate) — CallKit activates the session and calls didActivate
    let session = AVAudioSession.sharedInstance()
    try? session.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth, .allowBluetoothA2DP])
    answered.insert(action.callUUID)
    action.fulfill()
    emit?("onCallAnswered", ["callId": action.callUUID.uuidString, "payload": calls[action.callUUID] ?? [:]])
  }

  func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
    calls.removeValue(forKey: action.callUUID)
    answered.remove(action.callUUID)
    action.fulfill()
    emit?("onCallEnded", ["callId": action.callUUID.uuidString])
  }

  func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
    action.fulfill()
    emit?("onCallMuted", ["callId": action.callUUID.uuidString, "muted": action.isMuted])
  }

  func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
    audioActive = true
    emit?("onCallAudioActivated", [:])
  }

  func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
    audioActive = false
  }
}

/// Registers for VoIP pushes at launch — before JS loads — so a push that woke
/// the app can be reported to CallKit in time.
public class VoiceEngineAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    CallManager.shared.registerVoIP()
    return true
  }
}
