// 16 kHz mono PCM16 helpers: decoding mic chunks and synthesising UI cues.

export const SAMPLE_RATE = 16000;

/** base64 PCM16 (little-endian) → samples in -1..1 */
export function decodePcm16(b64: string): Float32Array {
  const bin = atob(b64);
  const n = bin.length >> 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
    if (v >= 0x8000) v -= 0x10000;
    out[i] = v / 32768;
  }
  return out;
}

export function floatToPcm16(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    const v = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
    out[2 * i] = v & 0xff;
    out[2 * i + 1] = (v >> 8) & 0xff;
  }
  return out;
}

// ── UI cues (same shapes as the web app's Web Audio oscillators) ─────────────

type Note = { at: number; dur: number; f0: number; f1?: number; peak: number; partial?: [number, number] };

function render(notes: Note[]): Uint8Array {
  const total = Math.max(...notes.map((n) => n.at + n.dur)) + 0.02;
  const buf = new Float32Array(Math.ceil(total * SAMPLE_RATE));
  for (const n of notes) {
    const start = Math.floor(n.at * SAMPLE_RATE);
    const len = Math.floor(n.dur * SAMPLE_RATE);
    let phase = 0;
    let phase2 = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // exponential frequency glide, fast attack, exponential decay
      const f = n.f1 ? n.f0 * Math.pow(n.f1 / n.f0, t) : n.f0;
      phase += (2 * Math.PI * f) / SAMPLE_RATE;
      const attack = Math.min(1, i / (0.008 * SAMPLE_RATE));
      const env = attack * n.peak * Math.pow(0.001 / n.peak, t);
      let v = Math.sin(phase);
      if (n.partial) {
        phase2 += (2 * Math.PI * f * n.partial[0]) / SAMPLE_RATE;
        v += Math.sin(phase2) * n.partial[1];
      }
      buf[start + i] += v * env;
    }
  }
  return floatToPcm16(buf);
}

const cache = new Map<string, Uint8Array>();
function cached(key: string, make: () => Uint8Array) {
  let v = cache.get(key);
  if (!v) { v = make(); cache.set(key, v); }
  return v;
}

export type Cue = "mute" | "unmute" | "end" | "thinking" | "taskComplete" | "phaseChime";

export function cuePcm(cue: Cue): Uint8Array {
  return cached(cue, () => {
    switch (cue) {
      case "mute":
        return render([{ at: 0, dur: 0.14, f0: 520, f1: 280, peak: 0.22 }]);
      case "unmute":
        return render([{ at: 0, dur: 0.14, f0: 340, f1: 620, peak: 0.22 }]);
      case "thinking":
        return render([
          { at: 0, dur: 0.1, f0: 660, peak: 0.08 },
          { at: 0.11, dur: 0.1, f0: 880, peak: 0.08 },
        ]);
      case "end":
        return render([
          { at: 0, dur: 0.12, f0: 480, peak: 0.2 },
          { at: 0.14, dur: 0.12, f0: 360, peak: 0.2 },
          { at: 0.28, dur: 0.12, f0: 240, peak: 0.2 },
        ]);
      case "taskComplete":
        return render([
          { at: 0, dur: 0.45, f0: 1046.5, peak: 0.11, partial: [2.76, 0.18] },
          { at: 0.09, dur: 0.7, f0: 1568, peak: 0.09, partial: [2.76, 0.18] },
        ]);
      case "phaseChime":
        // Three soft rising bells (G5 C6 E6) before a focus phase is announced
        return render([
          { at: 0, dur: 0.9, f0: 784, peak: 0.16, partial: [2.76, 0.15] },
          { at: 0.18, dur: 0.9, f0: 1046.5, peak: 0.14, partial: [2.76, 0.15] },
          { at: 0.36, dur: 1.2, f0: 1318.5, peak: 0.12, partial: [2.76, 0.15] },
        ]);
    }
  });
}

/** Wrap PCM16 in a WAV header (for playing cues through expo-audio outside a call) */
export function pcmToWavBase64(pcm: Uint8Array): string {
  const header = new Uint8Array(44);
  const dv = new DataView(header.buffer);
  const write = (o: number, s: string) => { for (let i = 0; i < s.length; i++) header[o + i] = s.charCodeAt(i); };
  write(0, "RIFF");
  dv.setUint32(4, 36 + pcm.length, true);
  write(8, "WAVE");
  write(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, SAMPLE_RATE, true);
  dv.setUint32(28, SAMPLE_RATE * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  write(36, "data");
  dv.setUint32(40, pcm.length, true);
  const all = new Uint8Array(44 + pcm.length);
  all.set(header, 0);
  all.set(pcm, 44);
  let bin = "";
  for (let i = 0; i < all.length; i += 0x8000) {
    bin += String.fromCharCode(...all.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
