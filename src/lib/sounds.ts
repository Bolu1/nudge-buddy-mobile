import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import * as Haptics from "expo-haptics";
import { File, Paths } from "expo-file-system";
import { cuePcm, pcmToWavBase64, type Cue } from "./voice/pcm";

// UI sounds outside a call go through expo-audio (during a call they're played
// by the voice engine instead — see VoiceProvider.playCue).

let chime: AudioPlayer | null = null;

function cueFile(cue: Cue): string {
  const file = new File(Paths.cache, `cue-${cue}.wav`);
  if (!file.exists) {
    const bin = atob(pcmToWavBase64(cuePcm(cue)));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    file.create({ overwrite: true });
    file.write(bytes);
  }
  return file.uri;
}

/** Rising two-note chime played when a task is marked done */
export function playTaskCompleteSound() {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  try {
    if (!chime) chime = createAudioPlayer({ uri: cueFile("taskComplete") });
    void chime.seekTo(0).then(() => chime?.play()).catch(() => {});
  } catch {
    /* sound is decoration — never let it break the tap */
  }
}
