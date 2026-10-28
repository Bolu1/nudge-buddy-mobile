import { Pressable, Text, View } from "react-native";
import { router, usePathname } from "expo-router";
import { useVoice } from "@/lib/voice/voice-context";
import { colors } from "@/lib/theme";
import { Icon, PhoneIcon } from "./ui";
import { VoiceOrb } from "./VoiceOrb";

export function fmtDuration(s: number) {
  const m = Math.floor(s / 60).toString().padStart(2, "0");
  const sec = (s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}

/**
 * Live-call pill shown above the tab bar on every screen except the Buddy
 * screen (which has the full call UI). Tapping it goes back to the call.
 */
export function CallBar({ bottomOffset }: { bottomOffset: number }) {
  const pathname = usePathname();
  const { micActive, muted, ttsActive, ttsLoading, userSpeaking, sessionSeconds, toggleMute, endSession, musicPlaying, musicTrackName, nextTrack, stopMusic } = useVoice();
  if (!micActive || pathname === "/workspace") return null;

  const status = ttsLoading ? "Loading voice…" : ttsActive ? "Speaking…" : muted ? "Muted" : userSpeaking ? "Hearing you…" : "Listening…";

  return (
    <View pointerEvents="box-none" className="absolute left-0 right-0 items-center px-4" style={{ bottom: bottomOffset + 8 }}>
      {musicPlaying ? (
        <View className="flex-row items-center gap-2 px-3 py-1.5 mb-2 rounded-full bg-surface-lowest border border-divider">
          <Icon name="music" size={12} color={colors.gold} />
          <Text className="text-outline text-[11px] max-w-[150px]" numberOfLines={1}>{musicTrackName}</Text>
          <Pressable onPress={nextTrack} hitSlop={6} className="w-6 h-6 rounded-full items-center justify-center">
            <Icon name="skip-forward" size={11} color={colors.outline} />
          </Pressable>
          <Pressable onPress={stopMusic} hitSlop={6} className="w-6 h-6 rounded-full items-center justify-center">
            <Icon name="stop" size={11} color={colors.outline} />
          </Pressable>
        </View>
      ) : null}
      <Pressable
        onPress={() => router.navigate("/workspace")}
        className="flex-row items-center gap-3 pl-2 pr-2 py-2 rounded-full bg-surface-lowest border border-divider w-full max-w-md"
        style={{ shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8 }}
      >
        <VoiceOrb state={ttsActive ? "speaking" : muted ? "muted" : userSpeaking ? "hearing" : "listening"} size={34} glow={false} />
        <View className="flex-1">
          <Text className="text-outline text-xs">{status}</Text>
          <Text className="text-on-surface text-sm font-semibold tracking-widest">{fmtDuration(sessionSeconds)}</Text>
        </View>
        <Pressable
          onPress={toggleMute}
          accessibilityLabel={muted ? "Unmute" : "Mute"}
          className={`w-10 h-10 rounded-full items-center justify-center ${muted ? "bg-on-primary-container" : "bg-surface-high"}`}
        >
          <Icon name={muted ? "mic-off" : "mic"} size={16} color={muted ? colors.primaryContainer : colors.onSurfaceVariant} />
        </Pressable>
        <Pressable
          onPress={endSession}
          accessibilityLabel="End call"
          className="h-10 px-4 rounded-full bg-error-container/80 active:bg-error-container flex-row items-center gap-1.5"
        >
          <PhoneIcon size={14} color={colors.error} />
          <Text className="text-error text-xs font-medium">End</Text>
        </Pressable>
      </Pressable>
    </View>
  );
}
