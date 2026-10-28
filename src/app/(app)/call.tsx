import { useEffect, useRef } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import VoiceEngine from "@modules/voice-engine";
import { push as pushApi } from "@/lib/api";
import { callOpening } from "@/lib/calls";
import { useConversation } from "@/lib/conversation-context";
import { takeCallPayload } from "@/lib/push";
import { colors } from "@/lib/theme";

/**
 * Android: "Answer" on the incoming-call notification deep-links here
 * (nudgebuddy://call?callId=…). Start the conversation, then show the Buddy screen.
 */
export default function AnswerCallScreen() {
  const { callId } = useLocalSearchParams<{ callId?: string }>();
  const { startCall } = useConversation();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    VoiceEngine.dismissIncomingCall();
    void (async () => {
      const payload = callId ? await takeCallPayload(callId) : null;
      const ok = await startCall({ opening: callOpening(payload) });
      if (ok && callId) pushApi.callResult(callId, { result: "answered" }).catch(() => {});
      router.replace("/workspace");
    })();
  }, [callId, startCall]);

  return (
    <View className="flex-1 bg-bg items-center justify-center gap-4">
      <ActivityIndicator color={colors.primaryContainer} />
      <Text className="text-outline text-sm">Connecting to Nudge Buddy…</Text>
    </View>
  );
}
