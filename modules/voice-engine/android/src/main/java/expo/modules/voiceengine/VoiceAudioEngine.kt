package expo.modules.voiceengine

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import android.net.Uri
import android.os.Build
import android.util.Base64
import android.util.Log
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import kotlin.math.sqrt

/**
 * Echo-cancelled 16 kHz mono PCM16 mic capture (VOICE_COMMUNICATION source +
 * platform AEC) and streamed PCM playback through a voice-communication track,
 * so the platform AEC knows exactly what the speaker is playing.
 */
class VoiceAudioEngine(private val context: Context) {
  var onMic: ((String, Double) -> Unit)? = null
  var onPlaybackEnded: ((Int) -> Unit)? = null
  var onInterruption: ((String) -> Unit)? = null
  var onMusicEnded: (() -> Unit)? = null

  @Volatile var micEnabled = true

  private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private var record: AudioRecord? = null
  private var track: AudioTrack? = null
  private var aec: AcousticEchoCanceler? = null
  private var ns: NoiseSuppressor? = null
  private var focusRequest: AudioFocusRequest? = null
  private var music: MediaPlayer? = null
  private var micThread: Thread? = null
  private var playThread: Thread? = null
  @Volatile private var running = false

  // Playback state. `generation` changes on every flush so in-flight work bails.
  private sealed class Item(val gen: Int, val id: Int) {
    class Chunk(gen: Int, id: Int, val bytes: ByteArray) : Item(gen, id)
    class End(gen: Int, id: Int) : Item(gen, id)
  }
  private val queue = LinkedBlockingQueue<Item>()
  private val trackLock = Object()
  @Volatile private var generation = 0
  private var framesWritten = 0L

  @SuppressLint("MissingPermission")
  fun start(): Boolean {
    if (running) return true
    try {
      audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
      requestFocus()
      routeOutput()

      val minRec = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
      val rec = AudioRecord(
        MediaRecorder.AudioSource.VOICE_COMMUNICATION,
        SAMPLE_RATE,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
        maxOf(minRec, CHUNK_BYTES * 2)
      )
      if (rec.state != AudioRecord.STATE_INITIALIZED) {
        rec.release()
        Log.e(TAG, "AudioRecord failed to initialize")
        return false
      }
      if (AcousticEchoCanceler.isAvailable()) {
        aec = AcousticEchoCanceler.create(rec.audioSessionId)?.apply { enabled = true }
      }
      if (NoiseSuppressor.isAvailable()) {
        ns = NoiseSuppressor.create(rec.audioSessionId)?.apply { enabled = true }
      }
      record = rec

      val minPlay = AudioTrack.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
      track = AudioTrack.Builder()
        .setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
        )
        .setAudioFormat(
          AudioFormat.Builder()
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .setSampleRate(SAMPLE_RATE)
            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
            .build()
        )
        .setBufferSizeInBytes(maxOf(minPlay, CHUNK_BYTES * 4))
        .setTransferMode(AudioTrack.MODE_STREAM)
        .build()
        .apply { play() }
      framesWritten = 0L

      running = true
      rec.startRecording()
      micThread = Thread({ micLoop() }, "VoiceEngine-mic").apply { start() }
      playThread = Thread({ playLoop() }, "VoiceEngine-play").apply { start() }
      return true
    } catch (e: Exception) {
      Log.e(TAG, "start failed", e)
      stop()
      return false
    }
  }

  fun stop() {
    stopMusic()
    running = false
    generation++
    queue.clear()
    micThread?.interrupt()
    playThread?.interrupt()
    try { micThread?.join(500) } catch (_: InterruptedException) {}
    try { playThread?.join(500) } catch (_: InterruptedException) {}
    micThread = null
    playThread = null
    try { record?.stop() } catch (_: Exception) {}
    record?.release()
    record = null
    aec?.release(); aec = null
    ns?.release(); ns = null
    synchronized(trackLock) {
      try { track?.pause(); track?.flush() } catch (_: Exception) {}
      track?.release()
      track = null
    }
    abandonFocus()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      try { audioManager.clearCommunicationDevice() } catch (_: Exception) {}
    } else {
      @Suppress("DEPRECATION")
      audioManager.isSpeakerphoneOn = false
    }
    audioManager.mode = AudioManager.MODE_NORMAL
  }

  // ── mic ────────────────────────────────────────────────────────────────────

  private fun micLoop() {
    val rec = record ?: return
    val frame = ByteArray(FRAME_BYTES)
    val batch = ByteArray(CHUNK_BYTES)
    var filled = 0
    while (running) {
      val n = try { rec.read(frame, 0, frame.size) } catch (e: Exception) { -1 }
      if (n <= 0) {
        if (!running) break
        try { Thread.sleep(10) } catch (_: InterruptedException) { break }
        continue
      }
      if (!micEnabled) { filled = 0; continue }
      var off = 0
      while (off < n) {
        val take = minOf(n - off, CHUNK_BYTES - filled)
        System.arraycopy(frame, off, batch, filled, take)
        filled += take
        off += take
        if (filled == CHUNK_BYTES) {
          onMic?.invoke(Base64.encodeToString(batch, Base64.NO_WRAP), rms(batch))
          filled = 0
        }
      }
    }
  }

  private fun rms(bytes: ByteArray): Double {
    val n = bytes.size / 2
    if (n == 0) return 0.0
    var sum = 0.0
    for (i in 0 until n) {
      val s = ((bytes[2 * i + 1].toInt() shl 8) or (bytes[2 * i].toInt() and 0xff)).toShort()
      val v = s / 32768.0
      sum += v * v
    }
    return sqrt(sum / n)
  }

  // ── playback ───────────────────────────────────────────────────────────────

  fun enqueue(id: Int, bytes: ByteArray) {
    if (!running || bytes.isEmpty()) return
    queue.offer(Item.Chunk(generation, id, bytes))
  }

  fun markEnd(id: Int) {
    if (!running) return
    queue.offer(Item.End(generation, id))
  }

  fun stopPlayback() {
    synchronized(trackLock) {
      generation++
      queue.clear()
      val t = track ?: return
      try {
        t.pause()
        t.flush()
        t.play()
      } catch (e: Exception) {
        Log.w(TAG, "flush failed", e)
      }
      framesWritten = headPosition(t)
    }
  }

  fun setVolume(v: Float) {
    track?.setVolume(v.coerceIn(0f, 1f))
  }

  private fun headPosition(t: AudioTrack): Long = t.playbackHeadPosition.toLong() and 0xffffffffL

  private fun playLoop() {
    while (running) {
      val item = try { queue.poll(200, TimeUnit.MILLISECONDS) } catch (_: InterruptedException) { break } ?: continue
      if (item.gen != generation) continue
      when (item) {
        is Item.Chunk -> writeChunk(item)
        is Item.End -> waitDrained(item)
      }
    }
  }

  private fun writeChunk(item: Item.Chunk) {
    var off = 0
    while (off < item.bytes.size && running) {
      val n = synchronized(trackLock) {
        if (item.gen != generation) return
        val t = track ?: return
        val written = t.write(item.bytes, off, item.bytes.size - off, AudioTrack.WRITE_NON_BLOCKING)
        if (written < 0) return
        framesWritten += written / 2
        written
      }
      off += n
      // Track buffer full — wait for it to drain a bit
      if (n == 0) {
        try { Thread.sleep(5) } catch (_: InterruptedException) { return }
      }
    }
  }

  private fun waitDrained(item: Item.End) {
    val target = synchronized(trackLock) { framesWritten }
    while (running) {
      val done = synchronized(trackLock) {
        if (item.gen != generation) return
        val t = track ?: return
        headPosition(t) >= target
      }
      if (done) break
      try { Thread.sleep(20) } catch (_: InterruptedException) { return }
    }
    if (running && item.gen == generation) onPlaybackEnded?.invoke(item.id)
  }

  // ── music ──────────────────────────────────────────────────────────────────

  /** Played on the voice-communication stream so the platform AEC removes it from the mic */
  fun playMusic(uri: String, volume: Float, loop: Boolean): Boolean {
    if (!running) return false
    stopMusic()
    return try {
      val mp = MediaPlayer()
      mp.setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
          .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
          .build()
      )
      mp.setDataSource(context, Uri.parse(uri))
      mp.isLooping = loop
      val v = volume.coerceIn(0f, 1f)
      mp.setVolume(v, v)
      mp.setOnCompletionListener { player ->
        if (music === player && !loop) onMusicEnded?.invoke()
      }
      mp.prepare()
      mp.start()
      music = mp
      true
    } catch (e: Exception) {
      Log.w(TAG, "music failed", e)
      false
    }
  }

  fun stopMusic() {
    val mp = music ?: return
    music = null
    try { mp.stop() } catch (_: Exception) {}
    mp.release()
  }

  fun setMusicVolume(v: Float) {
    val c = v.coerceIn(0f, 1f)
    music?.setVolume(c, c)
  }

  // ── routing / focus ────────────────────────────────────────────────────────

  private fun routeOutput() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val devices = audioManager.availableCommunicationDevices
      val external = devices.firstOrNull {
        it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
          it.type == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
          it.type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES ||
          it.type == AudioDeviceInfo.TYPE_USB_HEADSET ||
          (Build.VERSION.SDK_INT >= 31 && it.type == AudioDeviceInfo.TYPE_BLE_HEADSET)
      }
      val target = external ?: devices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
      if (target != null) {
        try { audioManager.setCommunicationDevice(target) } catch (e: Exception) { Log.w(TAG, "route failed", e) }
      }
    } else {
      val outputs = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
      val external = outputs.any {
        it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
          it.type == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
          it.type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES
      }
      @Suppress("DEPRECATION")
      audioManager.isSpeakerphoneOn = !external
    }
  }

  private fun requestFocus() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
      .setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build()
      )
      .setOnAudioFocusChangeListener { change ->
        when (change) {
          AudioManager.AUDIOFOCUS_LOSS, AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> onInterruption?.invoke("began")
          AudioManager.AUDIOFOCUS_GAIN -> onInterruption?.invoke("ended")
        }
      }
      .build()
    focusRequest = req
    audioManager.requestAudioFocus(req)
  }

  private fun abandonFocus() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    focusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
    focusRequest = null
  }

  companion object {
    private const val TAG = "VoiceEngine"
    const val SAMPLE_RATE = 16000
    private const val FRAME_BYTES = 640            // 20 ms
    private const val CHUNK_BYTES = SAMPLE_RATE / 10 * 2 // 100 ms per JS event
  }
}
