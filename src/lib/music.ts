import { Directory, File, Paths } from "expo-file-system";
import { WEB_URL } from "./config";

// Same catalogue as the web app. Tracks are served from the web app's
// public/music folder and cached on first play.

export type MusicCategory = "vibe" | "jazz" | "nature" | "whitenoise";

export const MUSIC_CATEGORIES: { id: MusicCategory; label: string; premium: boolean; description: string; exclusive: boolean }[] = [
  { id: "vibe",       label: "Vibe",        premium: false, description: "Lofi & chill focus beats",         exclusive: false },
  { id: "jazz",       label: "Jazz",        premium: true,  description: "Smooth jazz & bossa nova",          exclusive: false },
  { id: "nature",     label: "Nature",      premium: true,  description: "Rain, forest & ambient sounds",     exclusive: true  },
  { id: "whitenoise", label: "White Noise", premium: true,  description: "Focus-blocking background noise",   exclusive: true  },
];

export const AMBIENT_TRACKS_INFO: { src: string; label: string; premium: boolean; category: MusicCategory }[] = [
  { src: "/music/vibe/desifreemusic-chill-study-desk-focus-amp-concentration-lofi-451181.mp3", label: "Chill Study Lofi I",   premium: false, category: "vibe" },
  { src: "/music/vibe/desifreemusic-chill-study-desk-focus-amp-concentration-lofi-451180.mp3", label: "Chill Study Lofi II",  premium: false, category: "vibe" },
  { src: "/music/vibe/pixelwhimsy-productivity-music-loop-calm-ambient-sound-for-focus-367143.mp3", label: "Calm Ambient Focus", premium: false, category: "vibe" },
  { src: "/music/vibe/adiiswanto-calm-productivity-lofi-music-512942.mp3", label: "Calm Productivity Lofi", premium: true, category: "vibe" },
  { src: "/music/vibe/adiiswanto-calm-night-owl-lofi-music-512940.mp3",    label: "Night Owl Lofi",          premium: true, category: "vibe" },
  { src: "/music/vibe/adiiswanto-cozy-cafe-study-lo-fi-music-512944.mp3",  label: "Cozy Café Study",         premium: true, category: "vibe" },
  { src: "/music/jazz/adiiswanto-gentle-jazz-chill-lo-fi-music-512945.mp3", label: "Gentle Jazz Chill",      premium: true, category: "jazz" },
  { src: "/music/jazz/adiiswanto-relaxing-jazzy-lo-fi-music-475938.mp3",    label: "Relaxing Jazzy Lofi",    premium: true, category: "jazz" },
  { src: "/music/jazz/adiiswanto-relaxing-smooth-jazz-music-465316.mp3",    label: "Relaxing Smooth Jazz",   premium: true, category: "jazz" },
  { src: "/music/jazz/adiiswanto-sunset-chill-jazzsmooth-jazz-465311.mp3",  label: "Sunset Chill Jazz",      premium: true, category: "jazz" },
  { src: "/music/nature/49656682-light-spring-rain-nature-sounds-331710.mp3", label: "Light Spring Rain",   premium: true, category: "nature" },
  { src: "/music/nature/soul_serenity_sounds-jungle-nature-229896.mp3",       label: "Jungle",              premium: true, category: "nature" },
  { src: "/music/nature/soundreality-birds-forest-nature-445379.mp3",         label: "Birds & Forest",      premium: true, category: "nature" },
  { src: "/music/nature/soundreality-nature-forest-sound-537925.mp3",         label: "Forest",              premium: true, category: "nature" },
  { src: "/music/whitenoise/cosmic-scapes-relaxing-smoothed-brown-noise-294838.mp3",        label: "Brown Noise",      premium: true, category: "whitenoise" },
  { src: "/music/whitenoise/freesound_community-underwater-white-noise-46423.mp3",          label: "Underwater",       premium: true, category: "whitenoise" },
  { src: "/music/whitenoise/recordedreality-heavy-rain-white-noise-159772.mp3",             label: "Heavy Rain",       premium: true, category: "whitenoise" },
  { src: "/music/whitenoise/themediaguy-soft-soothing-deep-white-noise-378857.mp3",         label: "Deep White Noise", premium: true, category: "whitenoise" },
];

export interface MusicMixConfig { cats: MusicCategory[]; offTracks?: string[] }

const musicDir = new Directory(Paths.cache, "music");

/** Local file uri for a track, downloading it on first use */
export async function cachedTrackUri(src: string): Promise<string> {
  const name = src.split("/").pop() ?? src;
  const file = new File(musicDir, name);
  if (file.exists) return file.uri;
  if (!musicDir.exists) musicDir.create({ idempotent: true });
  const url = `${WEB_URL}${src.split("/").map(encodeURIComponent).join("/")}`;
  const downloaded = await File.downloadFileAsync(url, file, { idempotent: true });
  return downloaded.uri;
}
