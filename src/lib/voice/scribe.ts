// Realtime speech-to-text over ElevenLabs Scribe — the same protocol as the web
// app's lib/scribe-stt.ts. The native voice engine already delivers
// echo-cancelled 16 kHz PCM16 as base64, so chunks are forwarded as-is.

export type ScribeCallbacks = {
  /** Text of the segment currently being spoken (replaces the previous partial) */
  onPartial: (text: string) => void;
  /** Final text of a segment; the server commits after a short silence */
  onCommitted: (text: string) => void;
  onError?: (message: string) => void;
};

const SCRIBE_URL = "wss://api.elevenlabs.io/v1/speech-to-text/realtime";

export class ScribeStt {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 500;
  private closed = false;
  private paused = false;

  constructor(
    private fetchToken: () => Promise<string>,
    private cb: ScribeCallbacks,
  ) {}

  async start(): Promise<void> {
    await this.connect();
  }

  /** Stop sending audio (mute). The server commits whatever was in flight. */
  pause() { this.paused = true; }
  resume() { this.paused = false; }

  /** Forward one base64 PCM16 chunk; dropped while (re)connecting or muted */
  send(pcmBase64: string) {
    if (this.paused || this.closed) return;
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      message_type: "input_audio_chunk",
      audio_base_64: pcmBase64,
      commit: false,
      sample_rate: 16000,
    }));
  }

  stop() {
    this.closed = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null; ws.onmessage = null; ws.onerror = null;
      try { ws.close(); } catch { /* ignore */ }
    }
  }

  private async connect(): Promise<void> {
    const token = await this.fetchToken();
    if (this.closed) return;
    const params = new URLSearchParams({
      model_id: "scribe_v2_realtime",
      token,
      audio_format: "pcm_16000",
      language_code: "en",
      commit_strategy: "vad",
      vad_silence_threshold_secs: "0.5",
      filter_background_audio: "true",
    });
    const ws = new WebSocket(`${SCRIBE_URL}?${params.toString()}`);
    this.ws = ws;
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("Speech-to-text connection failed"));
    });
    this.reconnectDelay = 500;
    ws.onerror = null;
    ws.onmessage = (ev) => {
      let msg: { message_type?: string; text?: string; error?: string };
      try { msg = JSON.parse(String(ev.data)); } catch { return; }
      switch (msg.message_type) {
        case "partial_transcript": this.cb.onPartial(msg.text ?? ""); break;
        case "committed_transcript": this.cb.onCommitted(msg.text ?? ""); break;
        case "session_started": break;
        default:
          if (msg.error) this.cb.onError?.(`${msg.message_type}: ${msg.error}`);
      }
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      if (this.closed) return;
      // Session limits / network blips — reconnect with a fresh single-use token
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect().catch((e) => this.cb.onError?.(String(e)));
      }, this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 8000);
    };
  }
}
