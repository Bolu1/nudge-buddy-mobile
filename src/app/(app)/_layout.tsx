import { useEffect, type ReactNode } from "react";
import { View } from "react-native";
import { Stack, router } from "expo-router";
import * as Notifications from "expo-notifications";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { account, insights } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { WsProvider } from "@/lib/ws-context";
import { VoiceProvider } from "@/lib/voice/voice-context";
import { ConversationProvider } from "@/lib/conversation-context";
import { useCallHandling } from "@/lib/calls";
import { useLiveActivities } from "@/lib/live-activities";
import { registerForPush, unregisterPush, watchVoipToken } from "@/lib/push";
import { usePresence } from "@/lib/use-presence";
import { colors } from "@/lib/theme";
import { CallBar } from "@/components/CallBar";
import { AppLock } from "@/components/AppLock";

/** Signed-in side effects: push registration, call wiring, Dynamic Island, timezone sync */
function AppEffects({ children }: { children: ReactNode }) {
  const { registerBeforeSignOut } = useAuth();
  useCallHandling();
  usePresence();
  useLiveActivities();

  useEffect(() => {
    void registerForPush();
    const stopWatching = watchVoipToken();
    insights.ping().catch(() => {});
    account.updateProfile({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }).catch(() => {});
    const unhook = registerBeforeSignOut(unregisterPush);
    return () => { stopWatching(); unhook(); };
  }, [registerBeforeSignOut]);

  // Tapping a notification opens the screen it's about
  const lastResponse = Notifications.useLastNotificationResponse();
  useEffect(() => {
    const data = lastResponse?.notification.request.content.data as { type?: string } | undefined;
    if (!data?.type) return;
    if (data.type.startsWith("pomodoro")) router.navigate("/focus");
    else if (data.type.startsWith("workday")) router.navigate("/workday");
    else if (data.type === "board_invite") router.navigate("/boards/invites");
    else router.navigate("/workspace");
  }, [lastResponse]);

  return <>{children}</>;
}

export default function AppLayout() {
  const insets = useSafeAreaInsets();
  return (
    <WsProvider>
      <VoiceProvider>
        <ConversationProvider>
          <AppEffects>
            <View className="flex-1 bg-bg">
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
                <Stack.Screen name="(drawer)" />
                <Stack.Screen name="call" options={{ animation: "fade" }} />
                <Stack.Screen name="zen" options={{ animation: "fade", presentation: "fullScreenModal" }} />
                {/* Quitting a study session asks first, so no swipe-back */}
                <Stack.Screen name="flashcards/[collectionId]/study" options={{ gestureEnabled: false }} />
              </Stack>
              <CallBar bottomOffset={insets.bottom} />
              <AppLock />
            </View>
          </AppEffects>
        </ConversationProvider>
      </VoiceProvider>
    </WsProvider>
  );
}
