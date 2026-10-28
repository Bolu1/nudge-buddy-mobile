import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { router } from "expo-router";
import VoiceEngine, { type CallPayload } from "@modules/voice-engine";
import { push as pushApi } from "./api";
import { useConversation } from "./conversation-context";
import { useVoice } from "./voice/voice-context";

const AUDIO_ACTIVATION_TIMEOUT_MS = 3000;

export function callOpening(payload: CallPayload | null | undefined): string {
  return (payload?.speech as string | undefined) ?? (payload?.body as string | undefined) ?? "Hey, it's Nudge Buddy. Got a minute?";
}

/** CallKit only lets us use the mic once it has activated the audio session */
function waitForCallAudio(): Promise<void> {
  if (VoiceEngine.isCallAudioActive()) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => { sub.remove(); resolve(); }, AUDIO_ACTIVATION_TIMEOUT_MS);
    const sub = VoiceEngine.addListener("onCallAudioActivated", () => {
      clearTimeout(timer);
      sub.remove();
      resolve();
    });
  });
}

/**
 * Wires the system call UI to the voice session: answering a CallKit call
 * (iOS) starts a conversation with the reason the buddy called; ending or
 * muting it in the system UI ends/mutes the session.
 */
export function useCallHandling() {
  const { startCall, endCall } = useConversation();
  const { micActive, setMutedState } = useVoice();
  const activeCallIdRef = useRef<string | null>(null);
  const micActiveRef = useRef(micActive);
  useEffect(() => { micActiveRef.current = micActive; }, [micActive]);

  // Session ended in the app → nothing left to track
  useEffect(() => {
    if (!micActive) activeCallIdRef.current = null;
  }, [micActive]);

  useEffect(() => {
    if (Platform.OS !== "ios") {
      const sub = VoiceEngine.addListener("onCallDeclined", ({ callId }) => {
        pushApi.callResult(callId, { result: "declined" }).catch(() => {});
      });
      return () => sub.remove();
    }

    let handled = new Set<string>();
    async function answer(callId: string, payload: CallPayload) {
      if (handled.has(callId)) return;
      handled.add(callId);
      await waitForCallAudio();
      const ok = await startCall({ callKitCallId: callId, opening: callOpening(payload) });
      if (!ok) {
        VoiceEngine.endCall(callId);
        return;
      }
      activeCallIdRef.current = callId;
      pushApi.callResult(callId, { result: "answered" }).catch(() => {});
      router.navigate("/workspace");
    }

    // Answered before JS was listening (cold start from a VoIP push)
    const pending = VoiceEngine.getPendingCall();
    if (pending?.answered) void answer(pending.callId, pending.payload);

    const subs = [
      VoiceEngine.addListener("onCallAnswered", ({ callId, payload }) => { void answer(callId, payload); }),
      VoiceEngine.addListener("onCallEnded", ({ callId }) => {
        if (activeCallIdRef.current === callId && micActiveRef.current) endCall();
        else if (!handled.has(callId)) pushApi.callResult(callId, { result: "declined" }).catch(() => {});
        activeCallIdRef.current = null;
      }),
      VoiceEngine.addListener("onCallMuted", ({ callId, muted }) => {
        if (activeCallIdRef.current === callId) setMutedState(muted);
      }),
    ];
    return () => {
      subs.forEach((s) => s.remove());
      handled = new Set();
    };
  }, [startCall, endCall, setMutedState]);
}
