import ExpoModulesCore
import AVFoundation

public class VoiceEngineModule: Module {
  private var engine: VoiceAudioEngine?

  public func definition() -> ModuleDefinition {
    Name("VoiceEngine")

    Events(
      "onMic", "onPlaybackEnded", "onInterruption", "onMusicEnded",
      "onVoipToken", "onCallAnswered", "onCallEnded", "onCallMuted", "onCallAudioActivated", "onCallDeclined"
    )

    // Events fired before JS subscribes are recoverable via getVoipToken/getPendingCall
    OnCreate {
      CallManager.shared.emit = { [weak self] name, body in
        self?.sendEvent(name, body)
      }
    }

    OnDestroy {
      CallManager.shared.emit = nil
    }

    // ── CallKit / PushKit ────────────────────────────────────────────────────

    Function("getVoipToken") { () -> String? in
      CallManager.shared.voipToken
    }

    Function("getPendingCall") { () -> [String: Any]? in
      CallManager.shared.pendingCall()
    }

    Function("isCallAudioActive") { () -> Bool in
      CallManager.shared.audioActive
    }

    Function("endCall") { (callId: String) in
      DispatchQueue.main.async { CallManager.shared.endCall(callId) }
    }

    Function("reportCallConnected") { (callId: String) in
      DispatchQueue.main.async { CallManager.shared.reportConnected(callId) }
    }

    // Android-only incoming-call notification; CallKit handles this on iOS
    Function("showIncomingCall") { (_: String, _: String, _: String) in }
    Function("dismissIncomingCall") {}
    // Android-only ongoing notifications; Live Activities cover this on iOS
    Function("showLiveUpdate") { (_: String, _: String, _: String, _: Double?, _: Double?, _: Bool, _: String) in }
    Function("clearLiveUpdate") { (_: String) in }

    /// Starts mic capture + playback. `manageSession` = false when CallKit owns the
    /// audio session (it activates it in provider:didActivate).
    AsyncFunction("start") { (manageSession: Bool) -> Bool in
      if self.engine == nil {
        let e = VoiceAudioEngine()
        e.onMic = { [weak self] base64, level in
          self?.sendEvent("onMic", ["pcm": base64, "level": level])
        }
        e.onPlaybackEnded = { [weak self] id in
          self?.sendEvent("onPlaybackEnded", ["id": id])
        }
        e.onInterruption = { [weak self] type in
          self?.sendEvent("onInterruption", ["type": type])
        }
        e.onMusicEnded = { [weak self] in
          self?.sendEvent("onMusicEnded", [:])
        }
        self.engine = e
      }
      return self.engine!.start(manageSession: manageSession)
    }.runOnQueue(.main)

    Function("stop") {
      DispatchQueue.main.async {
        self.engine?.stop()
        self.engine = nil
      }
    }

    Function("setMicEnabled") { (enabled: Bool) in
      DispatchQueue.main.async { self.engine?.micEnabled = enabled }
    }

    Function("enqueue") { (id: Int, pcm: Data) in
      DispatchQueue.main.async { self.engine?.enqueue(id: id, pcm: pcm) }
    }

    Function("markEnd") { (id: Int) in
      DispatchQueue.main.async { self.engine?.markEnd(id: id) }
    }

    Function("stopPlayback") {
      DispatchQueue.main.async { self.engine?.stopPlayback() }
    }

    Function("setPlaybackVolume") { (volume: Double) in
      DispatchQueue.main.async { self.engine?.setVolume(Float(volume)) }
    }

    /// Background music mixed into the same output, so the AEC removes it from the mic too
    AsyncFunction("playMusic") { (uri: String, volume: Double, loop: Bool) -> Bool in
      return self.engine?.playMusic(uri: uri, volume: Float(volume), loop: loop) ?? false
    }.runOnQueue(.main)

    Function("stopMusic") {
      DispatchQueue.main.async { self.engine?.stopMusic() }
    }

    Function("setMusicVolume") { (volume: Double) in
      DispatchQueue.main.async { self.engine?.setMusicVolume(Float(volume)) }
    }
  }
}

/// AVAudioEngine with Apple's voice processing (AEC + noise suppression), so the
/// assistant's voice coming out of the speaker is removed from the mic signal.
/// Mic audio is delivered as 16 kHz mono PCM16 (base64); playback takes the same.
/// All state is touched on the main queue only.
final class VoiceAudioEngine {
  static let sampleRate: Double = 16000

  var onMic: ((String, Double) -> Void)?
  var onPlaybackEnded: ((Int) -> Void)?
  var onInterruption: ((String) -> Void)?
  var onMusicEnded: (() -> Void)?
  var micEnabled = true

  private let avEngine = AVAudioEngine()
  private let player = AVAudioPlayerNode()
  private let musicPlayer = AVAudioPlayerNode()
  private var musicGeneration = 0
  private let ioFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: VoiceAudioEngine.sampleRate, channels: 1, interleaved: false)!
  private let micFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: VoiceAudioEngine.sampleRate, channels: 1, interleaved: true)!
  private var converter: AVAudioConverter?
  private var observers: [NSObjectProtocol] = []
  private var running = false
  private var manageSession = true

  // Playback bookkeeping
  private var generation = 0
  private var pending: [Int: Int] = [:]   // utterance id → buffers not yet played
  private var ended: Set<Int> = []        // ids with no more data coming

  // Mic batching: ~100 ms per event keeps the JS bridge quiet
  private var micBuffer = Data()
  private let micChunkBytes = Int(VoiceAudioEngine.sampleRate / 10) * 2

  init() {
    avEngine.attach(player)
    avEngine.attach(musicPlayer)
    let center = NotificationCenter.default
    observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] n in
      self?.handleInterruption(n)
    })
    observers.append(center.addObserver(forName: .AVAudioEngineConfigurationChange, object: avEngine, queue: .main) { [weak self] _ in
      self?.restartAfterConfigChange()
    })
    observers.append(center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { [weak self] _ in
      self?.restartAfterConfigChange()
    })
  }

  deinit {
    observers.forEach { NotificationCenter.default.removeObserver($0) }
  }

  func start(manageSession: Bool) -> Bool {
    if running { return true }
    self.manageSession = manageSession
    let session = AVAudioSession.sharedInstance()
    do {
      try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth, .allowBluetoothA2DP])
      if manageSession { try session.setActive(true) }
    } catch {
      print("[VoiceEngine] session setup failed: \(error)")
    }
    do {
      try avEngine.inputNode.setVoiceProcessingEnabled(true)
    } catch {
      print("[VoiceEngine] voice processing unavailable: \(error)")
    }
    avEngine.connect(player, to: avEngine.mainMixerNode, format: ioFormat)
    installTap()
    do {
      avEngine.prepare()
      try avEngine.start()
      player.play()
      running = true
      return true
    } catch {
      print("[VoiceEngine] engine start failed: \(error)")
      return false
    }
  }

  func stop() {
    stopPlayback()
    stopMusic()
    running = false
    avEngine.inputNode.removeTap(onBus: 0)
    player.stop()
    avEngine.stop()
    micBuffer.removeAll()
    if manageSession {
      try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
  }

  private func installTap() {
    let input = avEngine.inputNode
    input.removeTap(onBus: 0)
    let inFormat = input.outputFormat(forBus: 0)
    guard inFormat.sampleRate > 0, inFormat.channelCount > 0 else { return }
    converter = AVAudioConverter(from: inFormat, to: micFormat)
    input.installTap(onBus: 0, bufferSize: 1024, format: inFormat) { [weak self] buffer, _ in
      self?.processMic(buffer)
    }
  }

  // Runs on the audio tap thread — convert, then hop to main for state
  private func processMic(_ buffer: AVAudioPCMBuffer) {
    guard let converter = converter else { return }
    let ratio = micFormat.sampleRate / buffer.format.sampleRate
    let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 32
    guard let out = AVAudioPCMBuffer(pcmFormat: micFormat, frameCapacity: capacity) else { return }
    var fed = false
    var err: NSError?
    converter.convert(to: out, error: &err) { _, status in
      if fed { status.pointee = .noDataNow; return nil }
      fed = true
      status.pointee = .haveData
      return buffer
    }
    guard err == nil, out.frameLength > 0, let ch = out.int16ChannelData?[0] else { return }
    let bytes = Data(bytes: ch, count: Int(out.frameLength) * 2)
    DispatchQueue.main.async { [weak self] in
      guard let self = self, self.running, self.micEnabled else { return }
      self.micBuffer.append(bytes)
      while self.micBuffer.count >= self.micChunkBytes {
        let chunk = Data(self.micBuffer.prefix(self.micChunkBytes))
        self.micBuffer.removeFirst(self.micChunkBytes)
        self.onMic?(chunk.base64EncodedString(), VoiceAudioEngine.rms(chunk))
      }
    }
  }

  static func rms(_ data: Data) -> Double {
    let n = data.count / 2
    if n == 0 { return 0 }
    var sum: Double = 0
    data.withUnsafeBytes { raw in
      let s = raw.bindMemory(to: Int16.self)
      for i in 0..<n {
        let v = Double(s[i]) / 32768.0
        sum += v * v
      }
    }
    return (sum / Double(n)).squareRoot()
  }

  // MARK: playback

  func enqueue(id: Int, pcm: Data) {
    let frames = pcm.count / 2
    guard running, frames > 0,
          let buf = AVAudioPCMBuffer(pcmFormat: ioFormat, frameCapacity: AVAudioFrameCount(frames)),
          let dst = buf.floatChannelData?[0] else { return }
    buf.frameLength = AVAudioFrameCount(frames)
    pcm.withUnsafeBytes { raw in
      let src = raw.bindMemory(to: Int16.self)
      for i in 0..<frames { dst[i] = Float(src[i]) / 32768.0 }
    }
    let gen = generation
    pending[id, default: 0] += 1
    player.scheduleBuffer(buf, completionCallbackType: .dataPlayedBack) { [weak self] _ in
      DispatchQueue.main.async {
        guard let self = self, gen == self.generation else { return }
        self.pending[id, default: 1] -= 1
        self.checkEnded(id)
      }
    }
    if !player.isPlaying { player.play() }
  }

  func markEnd(id: Int) {
    ended.insert(id)
    checkEnded(id)
  }

  private func checkEnded(_ id: Int) {
    guard ended.contains(id), (pending[id] ?? 0) <= 0 else { return }
    ended.remove(id)
    pending.removeValue(forKey: id)
    onPlaybackEnded?(id)
  }

  /// Drops everything queued or playing. Completion handlers from the dropped
  /// buffers carry the old generation and are ignored.
  func stopPlayback() {
    generation += 1
    pending.removeAll()
    ended.removeAll()
    player.stop()
    if running { player.play() }
  }

  func setVolume(_ v: Float) {
    player.volume = max(0, min(1, v))
  }

  // MARK: music

  func playMusic(uri: String, volume: Float, loop: Bool) -> Bool {
    guard running else { return false }
    let url = URL(string: uri).flatMap { $0.scheme == nil ? nil : $0 } ?? URL(fileURLWithPath: uri)
    do {
      let file = try AVAudioFile(forReading: url)
      musicGeneration += 1
      let gen = musicGeneration
      musicPlayer.stop()
      avEngine.connect(musicPlayer, to: avEngine.mainMixerNode, format: file.processingFormat)
      musicPlayer.volume = max(0, min(1, volume))
      scheduleMusic(file, gen: gen, loop: loop)
      musicPlayer.play()
      return true
    } catch {
      print("[VoiceEngine] music load failed: \(error)")
      return false
    }
  }

  private func scheduleMusic(_ file: AVAudioFile, gen: Int, loop: Bool) {
    musicPlayer.scheduleFile(file, at: nil, completionCallbackType: .dataPlayedBack) { [weak self] _ in
      DispatchQueue.main.async {
        guard let self = self, gen == self.musicGeneration, self.running else { return }
        if loop {
          file.framePosition = 0
          self.scheduleMusic(file, gen: gen, loop: loop)
        } else {
          self.onMusicEnded?()
        }
      }
    }
  }

  func stopMusic() {
    musicGeneration += 1
    musicPlayer.stop()
  }

  func setMusicVolume(_ v: Float) {
    musicPlayer.volume = max(0, min(1, v))
  }

  // MARK: session events

  private func handleInterruption(_ n: Notification) {
    guard let info = n.userInfo,
          let raw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
          let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
    switch type {
    case .began:
      onInterruption?("began")
    case .ended:
      if manageSession { try? AVAudioSession.sharedInstance().setActive(true) }
      restartAfterConfigChange()
      onInterruption?("ended")
    @unknown default:
      break
    }
  }

  private func restartAfterConfigChange() {
    guard running else { return }
    installTap()
    if !avEngine.isRunning {
      do { try avEngine.start() } catch { print("[VoiceEngine] restart failed: \(error)") }
    }
    if !player.isPlaying { player.play() }
  }
}
