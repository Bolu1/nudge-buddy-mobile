import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import * as Haptics from "expo-haptics";
import { File, Paths } from "expo-file-system";
import { cuePcm, pcmToWavBase64, SAMPLE_RATE, type Cue } from "./voice/pcm";

// UI sounds outside a call go through expo-audio (during a call they're played
// by the voice engine instead — see VoiceProvider.playCue).

const cuePlayers = new Map<Cue, AudioPlayer>();

/**
 * Audio session for everything outside a call: speech and chimes play with the
 * silent switch on and keep playing in the background, mixed with the user's
 * own music. The voice engine replaces it during a call, so it's re-applied
 * when a call ends.
 */
export function configureAudioSession() {
  void setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    interruptionMode: "mixWithOthers",
    allowsRecording: false,
  }).catch(() => {});
}

function wavFile(name: string, pcm: () => Uint8Array): string {
  const file = new File(Paths.cache, `${name}.wav`);
  if (!file.exists) {
    const bin = atob(pcmToWavBase64(pcm()));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    file.create({ overwrite: true });
    file.write(bytes);
  }
  return file.uri;
}

/** Play a cue through expo-audio. Returns how long it lasts, in ms. */
export function playCueSound(cue: Cue): number {
  try {
    let player = cuePlayers.get(cue);
    if (!player) {
      player = createAudioPlayer({ uri: wavFile(`cue-${cue}`, () => cuePcm(cue)) });
      cuePlayers.set(cue, player);
    }
    const p = player;
    void p.seekTo(0).then(() => p.play()).catch(() => {});
  } catch {
    /* sound is decoration — never let it break the caller */
  }
  return (cuePcm(cue).length / (SAMPLE_RATE * 2)) * 1000;
}

/** Rising two-note chime played when a task is marked done */
export function playTaskCompleteSound() {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  playCueSound("taskComplete");
}
