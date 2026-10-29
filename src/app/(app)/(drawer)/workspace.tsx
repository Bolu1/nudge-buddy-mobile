import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "@/components/ui/SafeArea";
import { router } from "expo-router";
import { tasks as tasksApi } from "@/lib/api";
import { ACTION_LABELS, DEFAULT_HEADING, GREETINGS, HELP_CATEGORIES, buildChips, chipsStillValid, type ChipTask } from "@/lib/assistant-data";
import { useConversation } from "@/lib/conversation-context";
import { onChange } from "@/lib/events";
import { getPref, setPref } from "@/lib/storage";
import { PREFS } from "@/lib/prefs";
import { colors } from "@/lib/theme";
import { useActiveFocus } from "@/lib/use-active-focus";
import { useCurrentBlock } from "@/lib/use-current-block";
import { useVoice } from "@/lib/voice/voice-context";
import { useWs } from "@/lib/ws-context";
import { useToast } from "@/lib/toast-context";
import { Icon, MenuButton, PhoneIcon, Sheet } from "@/components/ui";
import { Mascot } from "@/components/Mascot";
import { VoiceOrb, type VoiceOrbState } from "@/components/VoiceOrb";
import { fmtDuration } from "@/components/CallBar";

const GREETING_MS = 6000;

const focusPhaseLabel: Record<string, string> = {
  WORK: "Focus",
  SHORT_BREAK: "Short break",
  LONG_BREAK: "Long break",
};

export default function WorkspaceScreen() {
  const toast = useToast();
  const { status } = useWs();
  const voice = useVoice();
  const { micActive, muted, ttsActive, ttsLoading, userSpeaking, interimTranscript, sessionSeconds, toggleMute, stopSpeaking, musicPlaying, musicTrackName, nextTrack, stopMusic, playMusic } = voice;
  const { messages, processing, helpHint, sendUtterance, startCall, endCall } = useConversation();
  const { currentBlock } = useCurrentBlock();
  const { activeFocus, seconds: focusSeconds, paused: focusPaused } = useActiveFocus();

  const [input, setInput] = useState("");
  const [heading, setHeading] = useState(() => (getPref(PREFS.introSeen) ? DEFAULT_HEADING : GREETINGS[Math.floor(Math.random() * GREETINGS.length)]));
  const [chips, setChips] = useState<string[]>([]);
  const [showTranscript, setShowTranscript] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [helpGlow, setHelpGlow] = useState(false);
  const [starting, setStarting] = useState(false);

  const loadChips = useCallback(async () => {
    try {
      const res = await tasksApi.list();
      const list = (res.data as { data?: ChipTask[] } | null)?.data ?? [];
      // Keep pills stable; only rebuild when one points at a task that's gone
      setChips((prev) => (prev.length && chipsStillValid(prev, list) ? prev : buildChips(list)));
    } catch {
      setChips((prev) => (prev.length ? prev : buildChips([])));
    }
  }, []);

  useEffect(() => {
    loadChips();
    return onChange("tasks", loadChips);
  }, [loadChips]);

  useEffect(() => {
    if (heading === DEFAULT_HEADING) return;
    const id = setTimeout(() => setHeading(DEFAULT_HEADING), GREETING_MS);
    return () => clearTimeout(id);
  }, [heading]);

  useEffect(() => {
    if (helpHint > 0) setHelpGlow(true);
  }, [helpHint]);

  async function handleStartCall() {
    if (micActive || starting) return;
    setStarting(true);
    const firstTime = !getPref(PREFS.introSeen);
    const greeting = firstTime ? GREETINGS[Math.floor(Math.random() * GREETINGS.length)] : undefined;
    const ok = await startCall({ opening: greeting });
    setStarting(false);
    if (!ok) {
      toast.error("Nudge Buddy needs microphone access for calls. You can enable it in Settings.");
      return;
    }
    if (firstTime) {
      setPref(PREFS.introSeen, "1");
      if (greeting) setHeading(greeting);
    }
  }

  // Typed requests open the chat, so the reply shows up right there
  function submit(text = input) {
    if (!sendUtterance(text)) return;
    setInput("");
    setShowTranscript(true);
  }

  const composer = (
    <View className="flex-row items-center bg-surface-low border border-divider rounded-2xl pl-4 pr-1.5">
      <TextInput
        value={input}
        onChangeText={setInput}
        placeholder={processing ? "Processing…" : status !== "open" ? "Connecting…" : "Ask anything…"}
        placeholderTextColor={colors.placeholder}
        editable={!processing}
        returnKeyType="send"
        onSubmitEditing={() => submit()}
        className="flex-1 text-on-surface text-sm py-3.5"
      />
      <Pressable
        onPress={() => submit()}
        disabled={!input.trim() || processing}
        accessibilityLabel="Send"
        className={`w-9 h-9 rounded-full items-center justify-center ${input.trim() && !processing ? "bg-primary-container" : "bg-surface-high"}`}
      >
        <Icon name="send" size={15} color={input.trim() && !processing ? colors.onPrimary : colors.outlineVariant} strokeWidth={2} />
      </Pressable>
    </View>
  );

  const orbState: VoiceOrbState =
    micActive && !muted && userSpeaking ? "hearing"
    : processing ? "processing"
    : ttsActive ? "speaking"
    : micActive && muted ? "muted"
    : micActive ? "listening"
    : "idle";

  const statusLine =
    starting ? "Connecting…"
    : orbState === "listening" ? "Listening… speak naturally."
    : orbState === "hearing" ? (interimTranscript ? `“${interimTranscript}”` : "Listening…")
    : orbState === "processing" ? "Processing your request…"
    : orbState === "muted" ? "Muted"
    : ttsLoading ? "Loading voice…"
    : !micActive ? "Tap the orb to talk"
    : "";

  const wsDot = status === "open" ? colors.primaryContainer : status === "connecting" ? colors.gold : colors.outlineVariant;

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-bg">
      <KeyboardAvoidingView behavior="padding" className="flex-1" keyboardVerticalOffset={0}>
        {/* Header */}
        <View className="flex-row items-center justify-between px-2 py-2">
          <View className="flex-row items-center gap-2">
            <MenuButton />
            <Mascot size={28} />
            <Text className="text-on-surface text-base font-semibold tracking-tight">Nudge Buddy</Text>
            <View className="w-1.5 h-1.5 rounded-full ml-1" style={{ backgroundColor: wsDot }} />
          </View>
          <View className="flex-row items-center gap-1">
            {messages.length > 0 ? (
              <Pressable onPress={() => setShowTranscript(true)} className="flex-row items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-low border border-divider">
                <Icon name="message-square" size={13} color={colors.outline} />
                <Text className="text-outline text-xs">{messages.length}</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => router.push("/zen")}
              accessibilityLabel="Zen mode"
              className="flex-row items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-low border border-divider"
            >
              <Icon name="sparkles" size={13} color={colors.primaryContainer} />
              <Text className="text-primary text-xs">Zen</Text>
            </Pressable>
            <Pressable
              onPress={() => { setShowHelp(true); setHelpGlow(false); }}
              accessibilityLabel="What can I say?"
              className={`w-9 h-9 rounded-full items-center justify-center ${helpGlow ? "bg-on-primary-container" : "bg-surface-low border border-divider"}`}
            >
              <Icon name="help-circle" size={17} color={helpGlow ? colors.primaryContainer : colors.outline} />
            </Pressable>
          </View>
        </View>

        <ScrollView contentContainerClassName="grow items-center justify-center px-5 pb-6 gap-4" keyboardShouldPersistTaps="handled">
          {/* Orb */}
          <Pressable
            onPress={handleStartCall}
            disabled={micActive}
            accessibilityLabel={micActive ? "Voice assistant" : "Start talking to Nudge Buddy"}
            className="items-center justify-center"
          >
            <VoiceOrb state={orbState} size={220} />
          </Pressable>

          {/* Heading + status */}
          <View className="items-center gap-1 px-2">
            <Text className="text-on-surface text-xl font-semibold tracking-tight text-center">{heading}</Text>
            {orbState === "speaking" ? (
              <Pressable onPress={stopSpeaking} className="mt-2 flex-row items-center gap-2 px-4 py-1.5 rounded-full bg-surface-high border border-outline-variant">
                <Icon name="stop" size={11} color={colors.onSurfaceVariant} />
                <Text className="text-on-surface-variant text-xs">Stop speaking</Text>
              </Pressable>
            ) : statusLine ? (
              <Text className="text-outline text-sm text-center" numberOfLines={3}>{statusLine}</Text>
            ) : null}
          </View>

          {/* Call controls */}
          {micActive ? (
            <View className="items-center gap-3">
              <Text className="text-on-surface text-lg font-semibold tracking-widest">{fmtDuration(sessionSeconds)}</Text>
              <View className="flex-row items-center gap-4">
                <Pressable
                  onPress={toggleMute}
                  accessibilityLabel={muted ? "Unmute" : "Mute"}
                  className={`w-14 h-14 rounded-full items-center justify-center ${muted ? "bg-on-primary-container" : "bg-surface-high"}`}
                >
                  <Icon name={muted ? "mic-off" : "mic"} size={22} color={muted ? colors.primaryContainer : colors.onSurfaceVariant} />
                </Pressable>
                <Pressable
                  onPress={musicPlaying ? stopMusic : playMusic}
                  accessibilityLabel={musicPlaying ? "Stop music" : "Play focus music"}
                  className={`w-14 h-14 rounded-full items-center justify-center ${musicPlaying ? "bg-[#3d2e15]" : "bg-surface-high"}`}
                >
                  <Icon name="music" size={20} color={musicPlaying ? colors.gold : colors.outline} />
                </Pressable>
                <Pressable onPress={endCall} accessibilityLabel="End call" className="w-14 h-14 rounded-full items-center justify-center bg-error-container">
                  <PhoneIcon size={22} color={colors.error} />
                </Pressable>
              </View>
              {musicPlaying ? (
                <View className="flex-row items-center gap-2">
                  <Text className="text-outline text-xs max-w-[200px]" numberOfLines={1}>{musicTrackName}</Text>
                  <Pressable onPress={nextTrack} hitSlop={8}>
                    <Icon name="skip-forward" size={13} color={colors.outline} />
                  </Pressable>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Current block + focus */}
          {currentBlock || activeFocus ? (
            <View className="flex-row flex-wrap items-center justify-center gap-2">
              {currentBlock ? (
                <View className="flex-row items-center gap-1.5 px-3 py-1 rounded-full bg-surface-low border border-divider">
                  <View className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: currentBlock.color }} />
                  <Text className="text-xs font-medium" style={{ color: currentBlock.color }}>Currently in: {currentBlock.name}</Text>
                </View>
              ) : null}
              {activeFocus ? (
                <Pressable onPress={() => router.push("/focus")} className="flex-row items-center gap-1.5 px-3 py-1 rounded-full bg-surface-low border border-divider">
                  <View className="w-1.5 h-1.5 rounded-full bg-primary-container" />
                  <Text className="text-primary-container text-xs font-medium">
                    {focusPhaseLabel[activeFocus.currentPhase]}: {fmtDuration(focusSeconds)} left{focusPaused ? " · Paused" : ""}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {/* Quick commands */}
          {!processing && !micActive && chips.length > 0 ? (
            <View className="w-full gap-2">
              {chips.map((cmd) => (
                <Pressable
                  key={cmd}
                  onPress={() => submit(cmd)}
                  className="px-4 py-2.5 rounded-full bg-surface-low border border-divider active:border-outline"
                >
                  <Text className="text-on-surface-variant text-sm text-center" numberOfLines={1}>{cmd}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </ScrollView>

        {/* Input */}
        <View className="px-4 pb-3 pt-2 border-t border-divider bg-bg">{composer}</View>
      </KeyboardAvoidingView>

      {/* Chat: the conversation so far, the reply as it arrives, and a box to keep going */}
      <Sheet visible={showTranscript} onClose={() => setShowTranscript(false)} title="Chat" tall stickToBottom footer={composer}>
        {messages.length === 0 && !processing ? (
          <Text className="text-outline text-sm text-center py-8">Ask anything, or tap the orb to talk.</Text>
        ) : null}
        <View className="gap-3">
          {messages.map((m) => (
            <View key={m.id} className={`max-w-[85%] ${m.role === "user" ? "self-end items-end" : "self-start"}`}>
              {m.action && ACTION_LABELS[m.action] ? (
                <Text className="text-primary-container text-[11px] font-medium tracking-widest uppercase mb-1">{ACTION_LABELS[m.action]}</Text>
              ) : null}
              <View
                className={`rounded-2xl px-3.5 py-2.5 ${
                  m.role === "user" ? "bg-on-primary-container" : m.role === "error" ? "bg-error-container/30 border border-error/30" : "bg-surface-high"
                }`}
              >
                <Text className={`text-sm leading-5 ${m.role === "user" ? "text-primary" : m.role === "error" ? "text-error" : "text-on-surface"}`}>{m.text}</Text>
              </View>
              <Text className="text-outline text-[11px] mt-1">{m.time}</Text>
            </View>
          ))}
          {processing ? (
            <View className="self-start flex-row items-center gap-2 rounded-2xl px-3.5 py-2.5 bg-surface-high">
              <ActivityIndicator size="small" color={colors.outline} />
              <Text className="text-outline text-sm">Thinking…</Text>
            </View>
          ) : null}
        </View>
      </Sheet>

      {/* Help */}
      <Sheet visible={showHelp} onClose={() => setShowHelp(false)} title="What can I say?">
        <Text className="text-outline text-xs -mt-2">Try any of these voice or text commands</Text>
        {HELP_CATEGORIES.map((cat) => (
          <View key={cat.label} className="gap-1.5">
            <Text className="text-primary-container text-[11px] font-semibold tracking-widest uppercase">{cat.label}</Text>
            {cat.commands.map((cmd) => (
              <Pressable
                key={cmd}
                onPress={() => {
                  setShowHelp(false);
                  if (micActive || !sendUtterance(cmd)) return;
                  // iOS shows one sheet at a time: open the chat once this one has slid away
                  setTimeout(() => setShowTranscript(true), 350);
                }}
                className="px-3 py-2 rounded-xl bg-surface active:bg-surface-high"
              >
                <Text className="text-on-surface-variant text-sm">“{cmd}”</Text>
              </Pressable>
            ))}
          </View>
        ))}
      </Sheet>
    </SafeAreaView>
  );
}
