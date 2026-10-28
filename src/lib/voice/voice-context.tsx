import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { fetch as streamingFetch } from "expo/fetch";
import { createAudioPlayer, requestRecordingPermissionsAsync, type AudioPlayer } from "expo-audio";
import { File, Paths } from "expo-file-system";
import VoiceEngine from "@modules/voice-engine";
import { account, getToken } from "../api";
import { WEB_URL } from "../config";
import { getPref, setPref } from "../storage";
import { PREFS } from "../prefs";
import { DEFAULT_VOICE_ID } from "../voices";
import {
  AMBIENT_TRACKS_INFO,
  cachedTrackUri,
  type MusicCategory,
  type MusicMixConfig,
} from "../music";
import { ScribeStt } from "./scribe";
import { Vad } from "./vad";
import { cuePcm, decodePcm16, type Cue } from "./pcm";
import {
  INTERRUPT_WORDS,
  TRAILING_RE,
  analyzeHeard,
  isBackchannel,
  isCompleteShort,
  normWords,
  soundsLikeSaid,
  splitSentences,
  type InterruptedInfo,
  type TranscriptMeta,
} from "./text";

export type { TranscriptMeta } from "./text";

const SILENCE_MS = 60000; // start ambient music after 1 minute of silence on a call

// ─── turn-taking tuning (same values as the web app) ─────────────────────────
const MAX_HOLD_MS = 2000;          // cap on extra waiting while VAD still hears voice
const VAD_BARGE_IN_MS = 1000;      // this long of clear voice over the assistant with no transcript → yield
const VAD_CONFIRM_WINDOW_MS = 1200; // transcript-based interrupts need voice detected within this window
const DUCK_VOLUME = 0.2;           // assistant volume while it "notices" the user
const WAIT_FOR_GAP_MS = 4000;      // max time a reply waits for the user to stop talking before it starts
const ECHO_TAIL_MS = 2000;         // after TTS ends, transcripts matching it are still treated as echo
const MUSIC_VOLUME = 0.35;
const BYTES_PER_SEC = 32000;       // 16 kHz PCM16 mono

const MUSIC_INTRO_PHRASES = [
  "Playing some music to help you focus.",
  "Let's get some focus music going.",
  "Cueing up some tunes to help you focus.",
  "Time for some background music to help you concentrate.",
  "Starting some focus beats for you.",
  "Here's some music to help you stay in the zone.",
  "Let me queue up some focus sounds.",
  "Putting on some music to help you concentrate.",
  "Kicking off some background tunes to help you focus.",
  "Let's get some music playing to help you focus.",
];

export type StartSessionOptions = {
  onTranscript: (text: string, meta?: TranscriptMeta) => void;
  onEnd?: () => void;
  /** Answering a CallKit call (iOS): CallKit owns the audio session */
  callKitCallId?: string;
};

interface VoiceCtx {
  micActive: boolean;
  muted: boolean;
  ttsActive: boolean;
  ttsLoading: boolean;
  /** Mic hears the user talking right now (VAD / live transcript) */
  userSpeaking: boolean;
  /** Words recognised so far in the user's current turn, before it's sent */
  interimTranscript: string;
  sessionSeconds: number;
  musicPlaying: boolean;
  musicTrackName: string | null;
  isPremium: boolean;
  selectedVoiceId: string;
  musicMixCats: MusicCategory[];
  musicOffTracks: string[];
  musicLoopSrc: string | null;
  setMusicMix: (cats: MusicCategory[], offTracks: string[]) => void;
  setMusicLoop: (src: string | null) => void;
  startSession: (opts: StartSessionOptions) => Promise<boolean>;
  endSession: () => void;
  toggleMute: () => void;
  setMutedState: (muted: boolean) => void;
  speak: (text: string) => void;
  stopSpeaking: () => void;
  nextTrack: () => void;
  stopMusic: () => void;
  playMusic: () => void;
  notifyActivity: () => void;
  setVoiceId: (id: string) => void;
  playThinkingCue: () => void;
  /** Speak a sample of a voice (settings) */
  previewVoice: (voiceId: string) => void;
}

const VoiceContext = createContext<VoiceCtx | null>(null);

export function useVoice(): VoiceCtx {
  const ctx = useContext(VoiceContext);
  if (!ctx) throw new Error("useVoice must be used inside VoiceProvider");
  return ctx;
}

type TtsItem = {
  id: number;
  text: string;
  abort: AbortController;
  chunks: Uint8Array[];
  bytes: number;
  started: boolean;
  done: boolean;
  failed: boolean;
  wake: (() => void) | null;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let nextUtteranceId = 1;

function readMixPref(): MusicMixConfig {
  try {
    const s = getPref(PREFS.musicMix);
    return s ? (JSON.parse(s) as MusicMixConfig) : { cats: ["vibe"], offTracks: [] };
  } catch {
    return { cats: ["vibe"], offTracks: [] };
  }
}

export function VoiceProvider({ children }: { children: ReactNode }) {
  const [micActive, setMicActive] = useState(false);
  const [muted, setMuted] = useState(false);
  const [ttsActive, setTtsActive] = useState(false);
  const [ttsLoading, setTtsLoading] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [musicTrackName, setMusicTrackName] = useState<string | null>(null);
  const [isPremium, setIsPremium] = useState(false);
  const [selectedVoiceId, setSelectedVoiceId] = useState(() => getPref(PREFS.voiceId) ?? DEFAULT_VOICE_ID);
  const [musicMixCats, setMusicMixCatsState] = useState<MusicCategory[]>(() => readMixPref().cats);
  const [musicOffTracks, setMusicOffTracksState] = useState<string[]>(() => readMixPref().offTracks ?? []);
  const [musicLoopSrc, setMusicLoopSrcState] = useState<string | null>(() => getPref(PREFS.musicLoop));

  const isPremiumRef = useRef(false);
  const mixCatsRef = useRef<MusicCategory[]>(musicMixCats);
  const offTracksRef = useRef<string[]>(musicOffTracks);
  const loopSrcRef = useRef<string | null>(musicLoopSrc);
  const selectedVoiceIdRef = useRef(selectedVoiceId);

  const mutedRef = useRef(false);
  const micActiveRef = useRef(false);
  const engineRunningRef = useRef(false);
  const callKitIdRef = useRef<string | null>(null);
  const interruptedBySystemRef = useRef(false);
  const onTranscriptRef = useRef<StartSessionOptions["onTranscript"] | null>(null);
  const onEndRef = useRef<(() => void) | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Assistant speech
  const ttsActiveRef = useRef(false);
  const ttsGenRef = useRef(0);                  // bumped on every halt — stale async work bails
  const ttsItemsRef = useRef<TtsItem[]>([]);
  const ttsSpokenRef = useRef<string[]>([]);    // sentences fully played so far
  const ttsFullTextRef = useRef("");
  const ttsPlayingRef = useRef<{ idx: number; startedAt: number } | null>(null);
  const playbackWaitersRef = useRef<Map<number, () => void>>(new Map());
  const lastTtsEndRef = useRef(0);
  const duckedRef = useRef(false);
  const interruptedRef = useRef<InterruptedInfo | null>(null);
  const afterTtsRef = useRef<(() => void) | null>(null);
  const filePlayerRef = useRef<AudioPlayer | null>(null);

  // Listening
  const vadRef = useRef<Vad | null>(null);
  const userSpeakingRef = useRef(false);
  const sttRef = useRef<ScribeStt | null>(null);
  const sessionIdRef = useRef(0);
  const segmentSkipRef = useRef(0);
  const finalBufferRef = useRef("");
  const finalDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Music
  const musicOnRef = useRef(false);
  const lastActivityRef = useRef(Date.now());
  const musicDisabledRef = useRef(getPref(PREFS.musicDisabled) === "1");
  const lastTrackIdxRef = useRef<number | null>(null);

  // Session timer
  useEffect(() => {
    if (micActive) {
      setSessionSeconds(0);
      timerRef.current = setInterval(() => setSessionSeconds((s) => s + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setSessionSeconds(0);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [micActive]);

  // Premium status
  useEffect(() => {
    account.getProfile().then((res) => {
      const sub = (res.data as { data?: { subscription?: unknown } } | null)?.data?.subscription;
      // TEMPORARY (mirrors the web app): premium gating disabled everywhere for
      // now — delete `true ||` to restore real premium detection.
      const premium = true || sub != null;
      isPremiumRef.current = premium;
      setIsPremium(premium);
    }).catch(() => {});
  }, []);

  // Silence watchdog — ambient music after SILENCE_MS of nobody talking on a call
  useEffect(() => {
    const id = setInterval(() => {
      const eligible = micActiveRef.current && !ttsActiveRef.current;
      if (!eligible) { lastActivityRef.current = Date.now(); return; }
      if (musicDisabledRef.current || musicOnRef.current) return;
      if (Date.now() - lastActivityRef.current >= SILENCE_MS) {
        const idx = pickAmbientIdx();
        if (idx !== null) announceAndPlayMusic(idx);
      }
    }, 1000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Native engine events (subscribed for the provider's lifetime)
  useEffect(() => {
    const subs = [
      VoiceEngine.addListener("onMic", (e) => onMicChunk(e.pcm)),
      VoiceEngine.addListener("onPlaybackEnded", (e) => {
        const w = playbackWaitersRef.current.get(e.id);
        if (w) { playbackWaitersRef.current.delete(e.id); w(); }
      }),
      VoiceEngine.addListener("onMusicEnded", () => {
        if (musicOnRef.current && !musicDisabledRef.current) playAmbient(pickAmbientIdx());
      }),
      VoiceEngine.addListener("onInterruption", (e) => {
        if (!micActiveRef.current) return;
        // A phone call / Siri took the audio — stop talking and listening until it's back
        if (e.type === "began") {
          interruptedBySystemRef.current = true;
          stopSpeakingInternal();
          VoiceEngine.setMicEnabled(false);
          sttRef.current?.pause();
        } else if (interruptedBySystemRef.current) {
          interruptedBySystemRef.current = false;
          if (!mutedRef.current) {
            VoiceEngine.setMicEnabled(true);
            sttRef.current?.resume();
          }
        }
      }),
    ];
    return () => subs.forEach((s) => s.remove());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── helpers ─────────────────────────────────────────────────────────────

  function setTts(val: boolean) {
    ttsActiveRef.current = val;
    setTtsActive(val);
  }

  function markActivity() {
    lastActivityRef.current = Date.now();
  }

  function setUserSpeakingState(val: boolean) {
    if (userSpeakingRef.current === val) return;
    userSpeakingRef.current = val;
    setUserSpeaking(val);
  }

  function clearPendingTranscript() {
    if (finalDebounceRef.current) { clearTimeout(finalDebounceRef.current); finalDebounceRef.current = null; }
    finalBufferRef.current = "";
    setInterimTranscript("");
  }

  /** Short UI sound through the call output (only while the engine runs) */
  function playCue(cue: Cue) {
    if (!engineRunningRef.current) return;
    const id = -nextUtteranceId++;
    VoiceEngine.enqueue(id, cuePcm(cue));
    VoiceEngine.markEnd(id);
  }

  // ─── music ───────────────────────────────────────────────────────────────

  function stopAmbient() {
    if (musicOnRef.current) VoiceEngine.stopMusic();
    musicOnRef.current = false;
    setMusicPlaying(false);
    setMusicTrackName(null);
  }

  function pickAmbientIdx(): number | null {
    if (loopSrcRef.current) {
      const idx = AMBIENT_TRACKS_INFO.findIndex((t) => t.src === loopSrcRef.current);
      return idx >= 0 ? idx : null;
    }
    const cats = mixCatsRef.current;
    if (cats.length === 0) return null;
    const off = offTracksRef.current;
    const eligible = AMBIENT_TRACKS_INFO
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => cats.includes(t.category) && (!t.premium || isPremiumRef.current) && !off.includes(t.src));
    if (eligible.length === 0) return null;
    const pool = eligible.filter(({ i }) => i !== lastTrackIdxRef.current);
    const choices = pool.length > 0 ? pool : eligible;
    const picked = choices[Math.floor(Math.random() * choices.length)];
    lastTrackIdxRef.current = picked.i;
    return picked.i;
  }

  function playAmbient(idx: number | null) {
    if (idx === null || !engineRunningRef.current) { stopAmbient(); return; }
    const track = AMBIENT_TRACKS_INFO[idx];
    musicOnRef.current = true;
    setMusicTrackName(track.label);
    const session = sessionIdRef.current;
    cachedTrackUri(track.src)
      .then((uri) => {
        if (session !== sessionIdRef.current || !musicOnRef.current) return false;
        return VoiceEngine.playMusic(uri, MUSIC_VOLUME, !!loopSrcRef.current);
      })
      .then((ok) => {
        if (ok) setMusicPlaying(true);
        else if (session === sessionIdRef.current) stopAmbient();
      })
      .catch(() => stopAmbient());
  }

  function announceAndPlayMusic(idx: number) {
    const phrase = MUSIC_INTRO_PHRASES[Math.floor(Math.random() * MUSIC_INTRO_PHRASES.length)];
    afterTtsRef.current = () => playAmbient(idx);
    speak(phrase);
  }

  // ─── mute / end ──────────────────────────────────────────────────────────

  function doMute() {
    if (!micActiveRef.current || mutedRef.current) return;
    playCue("mute");
    mutedRef.current = true;
    setMuted(true);
    VoiceEngine.setMicEnabled(false);
    sttRef.current?.pause();
    vadRef.current?.reset();
    clearPendingTranscript();
    setUserSpeakingState(false);
  }

  function doUnmute() {
    if (!micActiveRef.current || !mutedRef.current) return;
    playCue("unmute");
    mutedRef.current = false;
    setMuted(false);
    if (!interruptedBySystemRef.current) {
      VoiceEngine.setMicEnabled(true);
      sttRef.current?.resume();
    }
    markActivity();
  }

  function doEnd() {
    if (!micActiveRef.current && !engineRunningRef.current) return;
    playCue("end");
    stopAmbient();
    afterTtsRef.current = null;
    clearPendingTranscript();
    interruptedRef.current = null;
    haltTts();
    setTtsLoading(false);
    stopListening();
    mutedRef.current = false;
    micActiveRef.current = false;
    interruptedBySystemRef.current = false;
    setMicActive(false);
    setMuted(false);
    setTts(false);
    setUserSpeakingState(false);
    const callKitId = callKitIdRef.current;
    callKitIdRef.current = null;
    // Let the end cue play out before tearing the engine down
    const session = sessionIdRef.current;
    setTimeout(() => {
      if (session !== sessionIdRef.current || micActiveRef.current) return;
      engineRunningRef.current = false;
      VoiceEngine.stop();
      if (callKitId) VoiceEngine.endCall(callKitId);
    }, 450);
    const onEnd = onEndRef.current;
    onEndRef.current = null;
    onTranscriptRef.current = null;
    onEnd?.();
  }

  // ─── assistant speech (sentence queue) ───────────────────────────────────

  function setDuck(on: boolean) {
    duckedRef.current = on;
    VoiceEngine.setPlaybackVolume(on ? DUCK_VOLUME : 1);
  }

  /** Stop all assistant audio + pending synthesis. Doesn't touch React state. */
  function haltTts() {
    if (ttsActiveRef.current) lastTtsEndRef.current = Date.now();
    ttsGenRef.current++;
    ttsItemsRef.current.forEach((it) => { it.abort.abort(); it.wake?.(); });
    ttsItemsRef.current = [];
    ttsPlayingRef.current = null;
    for (const w of playbackWaitersRef.current.values()) w();
    playbackWaitersRef.current.clear();
    if (engineRunningRef.current) {
      VoiceEngine.stopPlayback();
      VoiceEngine.setPlaybackVolume(1);
    }
    if (filePlayerRef.current) {
      try { filePlayerRef.current.remove(); } catch { /* ignore */ }
      filePlayerRef.current = null;
    }
    duckedRef.current = false;
  }

  function finishTts() {
    lastTtsEndRef.current = Date.now();
    duckedRef.current = false;
    if (engineRunningRef.current) VoiceEngine.setPlaybackVolume(1);
    setTtsLoading(false);
    setTts(false);
    const after = afterTtsRef.current;
    afterTtsRef.current = null;
    after?.();
  }

  function ttsRequestBody(items: TtsItem[], i: number, format?: "pcm_16000") {
    return JSON.stringify({
      text: items[i].text,
      voiceId: selectedVoiceIdRef.current,
      previousText: items[i - 1]?.text,
      nextText: items[i + 1]?.text,
      ...(format ? { format } : {}),
    });
  }

  /** Stream one sentence's PCM into its item buffer */
  function fetchTtsItem(i: number) {
    const items = ttsItemsRef.current;
    const it = items[i];
    if (!it || it.started) return;
    it.started = true;
    const notify = () => { const w = it.wake; it.wake = null; w?.(); };
    void (async () => {
      try {
        const res = await streamingFetch(`${WEB_URL}/api/tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
          body: ttsRequestBody(items, i, "pcm_16000"),
          signal: it.abort.signal,
        });
        if (!res.ok || !res.body) throw new Error(`tts ${res.status}`);
        const reader = res.body.getReader();
        let odd: number | null = null; // PCM16 frames can straddle network chunks
        for (;;) {
          const { done, value } = await reader.read();
          if (done || it.abort.signal.aborted) break;
          let bytes = value;
          if (odd !== null) {
            const joined = new Uint8Array(bytes.length + 1);
            joined[0] = odd;
            joined.set(bytes, 1);
            bytes = joined;
            odd = null;
          }
          if (bytes.length % 2) {
            odd = bytes[bytes.length - 1];
            bytes = bytes.slice(0, bytes.length - 1);
          }
          if (bytes.length) {
            it.chunks.push(bytes);
            it.bytes += bytes.length;
            notify();
          }
        }
      } catch {
        it.failed = true;
      }
      it.done = true;
      notify();
    })();
  }

  function waitForPlayback(id: number): Promise<void> {
    return new Promise((resolve) => playbackWaitersRef.current.set(id, resolve));
  }

  async function runTtsQueue(gen: number) {
    // Don't start talking over the user — wait for a gap (bounded)
    const waitStart = Date.now();
    while (userSpeakingRef.current && Date.now() - waitStart < WAIT_FOR_GAP_MS) {
      await sleep(80);
      if (gen !== ttsGenRef.current) return;
    }
    const items = ttsItemsRef.current;
    const playbacks: Promise<void>[] = [];
    for (let i = 0; i < items.length; i++) {
      if (gen !== ttsGenRef.current) return;
      const it = items[i];
      fetchTtsItem(i);
      fetchTtsItem(i + 1); // prefetch the next sentence while this one streams/plays
      // Pump this sentence's audio into the engine as it arrives. The engine
      // plays queued audio back to back, so sentence i+1 is queued as soon as
      // i is fully downloaded — no gap between sentences.
      let sent = 0;
      for (;;) {
        while (sent < it.chunks.length) {
          if (gen !== ttsGenRef.current) return;
          VoiceEngine.enqueue(it.id, it.chunks[sent++]);
          if (sent === 1) setTtsLoading(false);
        }
        if (it.done) break;
        await new Promise<void>((r) => { it.wake = r; });
        if (gen !== ttsGenRef.current) return;
      }
      if (it.bytes === 0) continue; // failed sentence — skip it
      const prevPlayback = playbacks[playbacks.length - 1];
      const ended = waitForPlayback(it.id);
      VoiceEngine.markEnd(it.id);
      // Track which sentence is audible (for "what did the user hear" on barge-in)
      const idx = i;
      void (prevPlayback ?? Promise.resolve()).then(() => {
        if (gen === ttsGenRef.current) ttsPlayingRef.current = { idx, startedAt: Date.now() };
      });
      playbacks.push(ended.then(() => {
        if (gen === ttsGenRef.current) ttsSpokenRef.current.push(it.text);
      }));
    }
    await Promise.all(playbacks);
    if (gen !== ttsGenRef.current) return;
    ttsItemsRef.current = [];
    ttsPlayingRef.current = null;
    finishTts();
  }

  /** Outside a call the engine is off — download the clip and play it as a file */
  async function speakViaFile(text: string, gen: number) {
    try {
      const res = await streamingFetch(`${WEB_URL}/api/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
        body: JSON.stringify({ text, voiceId: selectedVoiceIdRef.current }),
      });
      if (!res.ok) throw new Error(`tts ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (gen !== ttsGenRef.current) return;
      const file = new File(Paths.cache, `speech-${gen}.mp3`);
      file.create({ overwrite: true });
      file.write(bytes);
      const player = createAudioPlayer({ uri: file.uri });
      filePlayerRef.current = player;
      setTtsLoading(false);
      await new Promise<void>((resolve) => {
        const sub = player.addListener("playbackStatusUpdate", (s) => {
          if (s.didJustFinish) { sub.remove(); resolve(); }
        });
        player.play();
      });
      if (gen !== ttsGenRef.current) return;
      try { player.remove(); } catch { /* ignore */ }
      filePlayerRef.current = null;
      try { file.delete(); } catch { /* ignore */ }
    } catch { /* fall through */ }
    if (gen === ttsGenRef.current) finishTts();
  }

  // User talked over the assistant — stop immediately and remember how far we got
  function bargeIn(reason: string) {
    if (!ttsActiveRef.current) return;
    console.debug("[voice] barge-in:", reason);
    let spoken = ttsSpokenRef.current.join(" ");
    const playing = ttsPlayingRef.current;
    const cur = playing ? ttsItemsRef.current[playing.idx] : undefined;
    if (cur && playing && cur.bytes > 0) {
      const duration = (cur.bytes / BYTES_PER_SEC) * 1000;
      const words = cur.text.split(/\s+/);
      const n = Math.round(words.length * Math.min(1, (Date.now() - playing.startedAt) / duration));
      if (n > 0) spoken = `${spoken} ${words.slice(0, n).join(" ")}`.trim();
    }
    interruptedRef.current = { spokenSoFar: spoken, fullText: ttsFullTextRef.current };
    afterTtsRef.current = null;
    haltTts();
    // Assistant audio stopped instantly, so there's no echo tail
    lastTtsEndRef.current = 0;
    setTtsLoading(false);
    setTts(false);
  }

  function stopSpeakingInternal() {
    afterTtsRef.current = null;
    haltTts();
    setTtsLoading(false);
    setTts(false);
  }

  const speak = useCallback((text: string) => {
    haltTts();
    const gen = ttsGenRef.current;
    setTts(true);
    stopAmbient();
    interruptedRef.current = null;
    ttsFullTextRef.current = text;
    ttsSpokenRef.current = [];
    setTtsLoading(true);
    if (!engineRunningRef.current) {
      ttsItemsRef.current = [];
      void speakViaFile(text, gen);
      return;
    }
    ttsItemsRef.current = splitSentences(text).map((t) => ({
      id: nextUtteranceId++,
      text: t,
      abort: new AbortController(),
      chunks: [],
      bytes: 0,
      started: false,
      done: false,
      failed: false,
      wake: null,
    }));
    if (ttsItemsRef.current.length === 0) { finishTts(); return; }
    void runTtsQueue(gen);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stopSpeaking = useCallback(() => stopSpeakingInternal(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const playThinkingCue = useCallback(() => {
    if (!ttsActiveRef.current) playCue("thinking");
  }, []);

  const previewVoice = useCallback((voiceId: string) => {
    haltTts();
    const gen = ttsGenRef.current;
    setTts(true);
    setTtsLoading(true);
    void (async () => {
      try {
        const res = await streamingFetch(`${WEB_URL}/api/tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
          body: JSON.stringify({ text: "preview", voiceId, isPreview: true }),
        });
        if (!res.ok) throw new Error();
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (gen !== ttsGenRef.current) return;
        const file = new File(Paths.cache, `preview-${voiceId}.mp3`);
        file.create({ overwrite: true });
        file.write(bytes);
        const player = createAudioPlayer({ uri: file.uri });
        filePlayerRef.current = player;
        setTtsLoading(false);
        const sub = player.addListener("playbackStatusUpdate", (s) => {
          if (s.didJustFinish) {
            sub.remove();
            if (gen === ttsGenRef.current) finishTts();
          }
        });
        player.play();
      } catch {
        if (gen === ttsGenRef.current) finishTts();
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── listening: transcript endpointing + VAD ─────────────────────────────

  function onMicChunk(pcm: string) {
    if (!micActiveRef.current || mutedRef.current) return;
    sttRef.current?.send(pcm);
    const vad = vadRef.current;
    if (!vad) return;
    vad.push(decodePcm16(pcm), ttsActiveRef.current);
    // Fallback for slow recognition: a long stretch of clearly voiced speech
    // over the assistant → yield. Normal interrupts come from transcripts.
    if (
      vad.speaking && ttsActiveRef.current &&
      Date.now() - vad.speechStartAt >= VAD_BARGE_IN_MS &&
      vad.voicedSinceStart / Math.max(1, vad.framesSinceStart) >= 0.5
    ) {
      bargeIn("sustained voice over assistant");
    }
  }

  function onUserSpeechStart() {
    setUserSpeakingState(true);
    markActivity();
    // Assistant "notices" right away by lowering its voice; it stops fully once
    // the transcript confirms real words
    if (ttsActiveRef.current) setDuck(true);
  }

  function onUserSpeechEnd() {
    setUserSpeakingState(false);
    if (ttsActiveRef.current && duckedRef.current) setDuck(false);
  }

  function flushTranscript(text: string) {
    if (finalDebounceRef.current) { clearTimeout(finalDebounceRef.current); finalDebounceRef.current = null; }
    finalBufferRef.current = "";
    setInterimTranscript("");
    const t = text.trim();
    if (!t) return;
    // Late-arriving transcript of the assistant's own voice — drop it
    if (Date.now() - lastTtsEndRef.current < ECHO_TAIL_MS && analyzeHeard(t, ttsFullTextRef.current).isEcho) return;
    const meta: TranscriptMeta | undefined = interruptedRef.current ? { interrupted: interruptedRef.current } : undefined;
    interruptedRef.current = null;
    onTranscriptRef.current?.(t, meta);
  }

  function scheduleFlush() {
    const buf = finalBufferRef.current.trim();
    const words = normWords(buf);
    // Scribe only commits after ~0.5s of silence, so little extra wait is needed
    const delay = isCompleteShort(buf) ? 0 : TRAILING_RE.test(buf) || words.length <= 2 ? 800 : 150;
    const scheduledAt = Date.now();
    const tick = () => {
      // Mic still hears voice — they're mid-thought; hold a little longer
      if (userSpeakingRef.current && Date.now() - scheduledAt < MAX_HOLD_MS) {
        finalDebounceRef.current = setTimeout(tick, 120);
        return;
      }
      finalDebounceRef.current = null;
      flushTranscript(finalBufferRef.current);
    };
    if (finalDebounceRef.current) clearTimeout(finalDebounceRef.current);
    finalDebounceRef.current = setTimeout(tick, delay);
  }

  async function fetchSttToken(): Promise<string> {
    const res = await fetch(`${WEB_URL}/api/stt-token`, {
      method: "POST",
      headers: { Authorization: `Bearer ${getToken() ?? ""}` },
    });
    if (!res.ok) throw new Error(`stt-token ${res.status}`);
    const { token } = (await res.json()) as { token: string };
    return token;
  }

  // Words heard while the assistant is talking. Returns how many leading words
  // are the assistant's own echo if this should interrupt, or null to ignore.
  function admitOverTts(text: string): number | null {
    const a = analyzeHeard(text, ttsFullTextRef.current);
    if (a.isEcho) return null;
    if (isBackchannel(a.userWords.join(" "))) return null;
    const lastVoicedAt = vadRef.current?.lastVoicedAt ?? 0;
    const voiceConfirmed = Date.now() - lastVoicedAt < VAD_CONFIRM_WINDOW_MS || a.maxRun >= 3;
    const enoughWords = a.maxRun >= 2 || a.hasInterrupt;
    if (!voiceConfirmed || !enoughWords) return null;
    // Skip echo words before the user's own run
    const said = normWords(ttsFullTextRef.current);
    const saidSet = new Set(said);
    const raw = text.trim().split(/\s+/);
    const tokUser = raw.map((tok) => normWords(tok).some((w) => !soundsLikeSaid(w, said, saidSet)));
    let k = 0;
    while (k < raw.length) {
      if (tokUser[k] && (tokUser[k + 1] || normWords(raw[k]).some((w) => INTERRUPT_WORDS.has(w)))) break;
      k++;
    }
    return k < raw.length ? k : 0;
  }

  function applySkip(raw: string): string {
    return raw.trim().split(/\s+/).filter(Boolean).slice(segmentSkipRef.current).join(" ");
  }

  // In-progress text of the segment being spoken (each partial replaces the last)
  function handlePartial(raw: string) {
    let text = applySkip(raw);
    if (!text) return;
    if (ttsActiveRef.current) {
      const k = admitOverTts(text);
      if (k === null) return;
      segmentSkipRef.current += k;
      bargeIn(`words: "${text}"`);
      text = applySkip(raw);
      if (!text) return;
    } else if (Date.now() - lastTtsEndRef.current < ECHO_TAIL_MS && analyzeHeard(text, ttsFullTextRef.current).isEcho) {
      return;
    }
    markActivity();
    stopAmbient();
    // Still talking — hold the send
    if (finalDebounceRef.current) { clearTimeout(finalDebounceRef.current); finalDebounceRef.current = null; }
    setInterimTranscript(`${finalBufferRef.current} ${text}`.trim());
  }

  // Final text of a segment (Scribe commits after a short silence)
  function handleCommitted(raw: string) {
    let text = applySkip(raw);
    segmentSkipRef.current = 0;
    if (text && ttsActiveRef.current) {
      const k = admitOverTts(text);
      if (k === null) text = "";
      else { bargeIn(`words: "${text}"`); text = text.split(/\s+/).slice(k).join(" "); }
    } else if (text && Date.now() - lastTtsEndRef.current < ECHO_TAIL_MS && analyzeHeard(text, ttsFullTextRef.current).isEcho) {
      text = "";
    }
    if (text) {
      markActivity();
      stopAmbient();
      finalBufferRef.current = finalBufferRef.current ? `${finalBufferRef.current} ${text}` : text;
    }
    setInterimTranscript(finalBufferRef.current);
    if (finalBufferRef.current) scheduleFlush();
  }

  function stopListening() {
    sessionIdRef.current++;
    sttRef.current?.stop();
    sttRef.current = null;
    vadRef.current?.reset();
    vadRef.current = null;
    segmentSkipRef.current = 0;
  }

  const startSession = useCallback(async (opts: StartSessionOptions): Promise<boolean> => {
    const perm = await requestRecordingPermissionsAsync().catch(() => null);
    if (!perm?.granted) return false;

    onTranscriptRef.current = opts.onTranscript;
    onEndRef.current = opts.onEnd ?? null;
    callKitIdRef.current = opts.callKitCallId ?? null;

    stopListening();
    const session = sessionIdRef.current;
    haltTts();

    // CallKit hands us an already-active session; otherwise we own it
    const ok = await VoiceEngine.start(!opts.callKitCallId).catch(() => false);
    if (!ok || session !== sessionIdRef.current) {
      if (!ok) { VoiceEngine.stop(); callKitIdRef.current = null; }
      return false;
    }
    engineRunningRef.current = true;
    VoiceEngine.setMicEnabled(true);

    mutedRef.current = false;
    micActiveRef.current = true;
    interruptedBySystemRef.current = false;
    markActivity();
    setMicActive(true);
    setMuted(false);

    vadRef.current = new Vad({ onSpeechStart: onUserSpeechStart, onSpeechEnd: onUserSpeechEnd });
    const stt = new ScribeStt(fetchSttToken, {
      onPartial: handlePartial,
      onCommitted: handleCommitted,
      onError: (m) => console.warn("[voice] stt:", m),
    });
    sttRef.current = stt;
    stt.start().catch((err) => {
      console.warn("[voice] speech-to-text unavailable:", err);
      // Without transcription a call is pointless — end it so the UI doesn't lie
      if (session === sessionIdRef.current) doEnd();
    });
    if (opts.callKitCallId) VoiceEngine.reportCallConnected(opts.callKitCallId);
    return true;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const endSession = useCallback(() => { doEnd(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleMute = useCallback(() => {
    if (mutedRef.current) doUnmute(); else doMute();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setMutedState = useCallback((m: boolean) => {
    if (m) doMute(); else doUnmute();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const nextTrack = useCallback(() => {
    if (!musicOnRef.current) return;
    playAmbient(pickAmbientIdx());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stopMusic = useCallback(() => {
    musicDisabledRef.current = true;
    setPref(PREFS.musicDisabled, "1");
    stopAmbient();
  }, []);

  const playMusic = useCallback(() => {
    musicDisabledRef.current = false;
    setPref(PREFS.musicDisabled, null);
    markActivity();
    playAmbient(pickAmbientIdx());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const notifyActivity = useCallback(() => {
    markActivity();
    stopAmbient();
  }, []);

  const setVoiceId = useCallback((id: string) => {
    setSelectedVoiceId(id);
    selectedVoiceIdRef.current = id;
    setPref(PREFS.voiceId, id);
  }, []);

  const setMusicMix = useCallback((cats: MusicCategory[], offTracks: string[]) => {
    setMusicMixCatsState(cats);
    setMusicOffTracksState(offTracks);
    setMusicLoopSrcState(null);
    mixCatsRef.current = cats;
    offTracksRef.current = offTracks;
    loopSrcRef.current = null;
    setPref(PREFS.musicMix, JSON.stringify({ cats, offTracks }));
    setPref(PREFS.musicLoop, null);
  }, []);

  const setMusicLoop = useCallback((src: string | null) => {
    setMusicLoopSrcState(src);
    loopSrcRef.current = src;
    setPref(PREFS.musicLoop, src);
  }, []);

  return (
    <VoiceContext.Provider
      value={{
        micActive, muted, ttsActive, ttsLoading, userSpeaking, interimTranscript, sessionSeconds,
        musicPlaying, musicTrackName, isPremium, selectedVoiceId, musicMixCats, musicOffTracks, musicLoopSrc,
        setMusicMix, setMusicLoop, startSession, endSession, toggleMute, setMutedState, speak, stopSpeaking,
        nextTrack, stopMusic, playMusic, notifyActivity, setVoiceId, playThinkingCue, previewVoice,
      }}
    >
      {children}
    </VoiceContext.Provider>
  );
}
