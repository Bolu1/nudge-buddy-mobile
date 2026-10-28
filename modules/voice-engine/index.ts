import { NativeModule, requireNativeModule } from "expo";

export type MicEvent = {
  /** 100 ms of 16 kHz mono PCM16 (little-endian), base64 */
  pcm: string;
  /** Linear RMS of the chunk, 0..1 */
  level: number;
};

export type CallPayload = {
  callId?: string;
  title?: string;
  body?: string;
  /** What the buddy should open the call with */
  speech?: string;
  reminderId?: string;
  [key: string]: unknown;
};

export type PendingCall = { callId: string; payload: CallPayload; answered: boolean };

export type VoiceEngineEvents = {
  onMic: (e: MicEvent) => void;
  /** Every chunk queued for this id has finished playing (after markEnd) */
  onPlaybackEnded: (e: { id: number }) => void;
  /** Another app / a phone call took the audio session ("began"), or gave it back ("ended") */
  onInterruption: (e: { type: "began" | "ended" }) => void;
  /** Non-looping music track finished */
  onMusicEnded: (e: Record<string, never>) => void;
  /** iOS: PushKit VoIP token (hex) */
  onVoipToken: (e: { token: string }) => void;
  /** iOS: user answered a CallKit call */
  onCallAnswered: (e: { callId: string; payload: CallPayload }) => void;
  /** iOS: call ended from the system call UI */
  onCallEnded: (e: { callId: string }) => void;
  /** iOS: mute toggled from the system call UI */
  onCallMuted: (e: { callId: string; muted: boolean }) => void;
  /** iOS: CallKit activated the audio session — safe to start(false) now */
  onCallAudioActivated: (e: Record<string, never>) => void;
  /** Android: user tapped Decline on the incoming-call notification */
  onCallDeclined: (e: { callId: string }) => void;
};

declare class VoiceEngineModule extends NativeModule<VoiceEngineEvents> {
  /** Start capture + playback. On iOS pass manageSession=false when CallKit owns the audio session. */
  start(manageSession: boolean): Promise<boolean>;
  stop(): void;
  setMicEnabled(enabled: boolean): void;
  /** Queue 16 kHz mono PCM16 for playback, tagged with an utterance id */
  enqueue(id: number, pcm: Uint8Array): void;
  /** No more audio is coming for this id — fires onPlaybackEnded once it has all played */
  markEnd(id: number): void;
  /** Drop everything queued or playing, immediately */
  stopPlayback(): void;
  setPlaybackVolume(volume: number): void;
  /** Play a local audio file (file:// uri) mixed into the call output, under the AEC */
  playMusic(uri: string, volume: number, loop: boolean): Promise<boolean>;
  stopMusic(): void;
  setMusicVolume(volume: number): void;

  // Calls
  getVoipToken(): string | null;
  getPendingCall(): PendingCall | null;
  isCallAudioActive(): boolean;
  endCall(callId: string): void;
  reportCallConnected(callId: string): void;
  /** Android: ringing full-screen call notification */
  showIncomingCall(callId: string, title: string, body: string): void;
  dismissIncomingCall(): void;
  /** Android: ongoing notification with a live timer (Live Update chip on Android 16+) */
  showLiveUpdate(
    kind: string,
    title: string,
    text: string,
    startEpoch: number | null,
    endEpoch: number | null,
    paused: boolean,
    colorHex: string,
  ): void;
  clearLiveUpdate(kind: string): void;
}

export default requireNativeModule<VoiceEngineModule>("VoiceEngine");
