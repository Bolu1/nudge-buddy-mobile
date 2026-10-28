package expo.modules.voiceengine

import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.typedarray.Uint8Array

/** Must match `scheme` in app.config.ts */
private const val APP_SCHEME = "nudgebuddy"

class VoiceEngineModule : Module() {
  private var engine: VoiceAudioEngine? = null

  private val context
    get() = requireNotNull(appContext.reactContext) { "React context is not available" }

  override fun definition() = ModuleDefinition {
    Name("VoiceEngine")

    Events(
      "onMic", "onPlaybackEnded", "onInterruption", "onMusicEnded",
      "onVoipToken", "onCallAnswered", "onCallEnded", "onCallMuted", "onCallAudioActivated", "onCallDeclined"
    )

    OnCreate {
      IncomingCall.onDeclined = { callId -> sendEvent("onCallDeclined", mapOf("callId" to callId)) }
    }

    // ── incoming calls (CallKit equivalents are iOS-only no-ops here) ────────

    Function("showIncomingCall") { callId: String, title: String, body: String ->
      IncomingCall.show(context, APP_SCHEME, callId, title, body)
    }

    Function("dismissIncomingCall") {
      IncomingCall.dismiss(context)
    }

    // Android's take on Live Activities — ongoing notification with a live chronometer
    Function("showLiveUpdate") { kind: String, title: String, text: String, startEpoch: Double?, endEpoch: Double?, paused: Boolean, colorHex: String ->
      LiveUpdates.show(context, APP_SCHEME, kind, title, text, startEpoch, endEpoch, paused, colorHex)
    }

    Function("clearLiveUpdate") { kind: String ->
      LiveUpdates.clear(context, kind)
    }

    Function("getVoipToken") { null as String? }
    Function("getPendingCall") { null as Map<String, Any>? }
    Function("isCallAudioActive") { false }
    Function("endCall") { _: String -> }
    Function("reportCallConnected") { _: String -> }

    // `manageSession` only matters on iOS (CallKit owns the session there)
    AsyncFunction("start") { _: Boolean ->
      startService()
      val e = engine ?: VoiceAudioEngine(context).also { created ->
        created.onMic = { pcm, level -> sendEvent("onMic", mapOf("pcm" to pcm, "level" to level)) }
        created.onPlaybackEnded = { id -> sendEvent("onPlaybackEnded", mapOf("id" to id)) }
        created.onInterruption = { type -> sendEvent("onInterruption", mapOf("type" to type)) }
        created.onMusicEnded = { sendEvent("onMusicEnded", mapOf<String, Any>()) }
        engine = created
      }
      val ok = e.start()
      if (!ok) {
        engine = null
        stopService()
      }
      ok
    }

    Function("stop") {
      engine?.stop()
      engine = null
      stopService()
    }

    Function("setMicEnabled") { enabled: Boolean ->
      engine?.micEnabled = enabled
    }

    Function("enqueue") { id: Int, pcm: Uint8Array ->
      val bytes = ByteArray(pcm.byteLength)
      pcm.read(bytes, 0, pcm.byteLength)
      engine?.enqueue(id, bytes)
    }

    Function("markEnd") { id: Int ->
      engine?.markEnd(id)
    }

    Function("stopPlayback") {
      engine?.stopPlayback()
    }

    Function("setPlaybackVolume") { volume: Double ->
      engine?.setVolume(volume.toFloat())
    }

    AsyncFunction("playMusic") { uri: String, volume: Double, loop: Boolean ->
      engine?.playMusic(uri, volume.toFloat(), loop) ?: false
    }

    Function("stopMusic") {
      engine?.stopMusic()
    }

    Function("setMusicVolume") { volume: Double ->
      engine?.setMusicVolume(volume.toFloat())
    }

    OnDestroy {
      IncomingCall.onDeclined = null
      engine?.stop()
      engine = null
      stopService()
    }
  }

  private fun startService() {
    val intent = Intent(context, VoiceCallService::class.java)
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        ContextCompat.startForegroundService(context, intent)
      } else {
        context.startService(intent)
      }
    } catch (e: Exception) {
      // e.g. ForegroundServiceStartNotAllowedException when started from the background
      Log.w("VoiceEngine", "could not start foreground service", e)
    }
  }

  private fun stopService() {
    try {
      context.stopService(Intent(context, VoiceCallService::class.java))
    } catch (_: Exception) {}
  }
}
