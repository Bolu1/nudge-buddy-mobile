import { SAMPLE_RATE } from "./pcm";

// Voice activity detection on the echo-cancelled mic stream. Same idea as the
// web app's analyser-based VAD: a frame counts as the user talking only if it
// looks like a human voice (pitched, not noise-like), not merely loud — fans,
// typing, knocks and claps are rejected.

const FRAME = 320;                 // 20 ms
const WINDOW_FRAMES = 15;          // look at the last ~300 ms…
const ONSET_VOICED = 9;            // …and need ~180 ms of it voiced → "user is talking"
const RELEASE_MS = 400;            // no voiced frame for this long → "user stopped"
const PERIODICITY_MIN = 0.5;       // normalised autocorrelation peak at a speech pitch (80–400 Hz)
const ZCR_MAX = 0.35;              // zero-crossing rate: hiss/noise crosses far more often than voice

export type VadCallbacks = {
  onSpeechStart: () => void;
  onSpeechEnd: () => void;
};

export class Vad {
  speaking = false;
  lastVoicedAt = 0;
  speechStartAt = 0;
  voicedSinceStart = 0;
  framesSinceStart = 0;

  private floor = 0.005;
  private recent: boolean[] = [];
  private carry = new Float32Array(0);

  constructor(private cb: VadCallbacks) {}

  reset() {
    this.recent = [];
    this.carry = new Float32Array(0);
    if (this.speaking) {
      this.speaking = false;
      this.cb.onSpeechEnd();
    }
  }

  /**
   * Feed mic samples. `assistantTalking` raises the bar: native AEC removes most
   * of the assistant's voice, but what leaks through must not count as the user.
   */
  push(samples: Float32Array, assistantTalking: boolean) {
    let buf = samples;
    if (this.carry.length) {
      buf = new Float32Array(this.carry.length + samples.length);
      buf.set(this.carry, 0);
      buf.set(samples, this.carry.length);
    }
    let off = 0;
    for (; off + FRAME <= buf.length; off += FRAME) {
      this.frame(buf.subarray(off, off + FRAME), assistantTalking);
    }
    this.carry = buf.slice(off);
  }

  private frame(x: Float32Array, assistantTalking: boolean) {
    const { rms, voiceLike } = analyzeFrame(x);
    // Adaptive noise floor: drops fast, rises slowly, frozen while someone talks
    if (rms < this.floor) this.floor = this.floor * 0.8 + rms * 0.2;
    else if (!this.speaking && !assistantTalking) this.floor = this.floor * 0.995 + rms * 0.005;

    const thresh = assistantTalking ? Math.max(this.floor * 4, 0.03) : Math.max(this.floor * 2.5, 0.012);
    const voiced = voiceLike && rms > thresh;
    const now = Date.now();
    if (voiced) this.lastVoicedAt = now;

    this.recent.push(voiced);
    if (this.recent.length > WINDOW_FRAMES) this.recent.shift();
    const voicedCount = this.recent.reduce((n, v) => n + (v ? 1 : 0), 0);

    if (!this.speaking) {
      if (voicedCount >= ONSET_VOICED) {
        this.speaking = true;
        this.speechStartAt = now;
        this.voicedSinceStart = voicedCount;
        this.framesSinceStart = this.recent.length;
        this.cb.onSpeechStart();
      }
    } else {
      this.framesSinceStart++;
      if (voiced) this.voicedSinceStart++;
      if (now - this.lastVoicedAt >= RELEASE_MS) {
        this.speaking = false;
        this.cb.onSpeechEnd();
      }
    }
  }
}

function analyzeFrame(x: Float32Array): { rms: number; voiceLike: boolean } {
  let sum = 0;
  let crossings = 0;
  for (let i = 0; i < x.length; i++) {
    sum += x[i] * x[i];
    if (i > 0 && (x[i] >= 0) !== (x[i - 1] >= 0)) crossings++;
  }
  const rms = Math.sqrt(sum / x.length);
  if (rms < 1e-4) return { rms, voiceLike: false };
  if (crossings / x.length > ZCR_MAX) return { rms, voiceLike: false };

  // Pitch periodicity: normalised autocorrelation on a 2x-downsampled frame
  const half = x.length >> 1;
  const d = new Float32Array(half);
  for (let i = 0; i < half; i++) d[i] = x[2 * i] + x[2 * i + 1];
  const sr = SAMPLE_RATE / 2;
  const minLag = Math.floor(sr / 400);
  const maxLag = Math.min(half - 16, Math.ceil(sr / 80));
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let xy = 0, xx = 0, yy = 0;
    for (let i = 0; i + lag < half; i++) {
      const a = d[i], b = d[i + lag];
      xy += a * b; xx += a * a; yy += b * b;
    }
    const r = xy / (Math.sqrt(xx * yy) + 1e-12);
    if (r > best) best = r;
  }
  return { rms, voiceLike: best >= PERIODICITY_MIN };
}
