import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useWs, type WsMessage } from "./ws-context";
import { useVoice, type TranscriptMeta } from "./voice/voice-context";
import { TASK_REFRESH_ACTIONS } from "./assistant-data";
import { emitChange } from "./events";

// The conversation lives above the screens: on a phone a call keeps going while
// the user switches tabs, locks the screen or leaves the app, so sending turns,
// speaking replies and speaking server pushes can't belong to one screen.

export type Role = "user" | "assistant" | "error";

export interface Message {
  id: number;
  role: Role;
  text: string;
  action?: string;
  time: string;
}

// Reply types tied to a live turn; everything else with `speech` is a server push
const CONVERSATIONAL_TYPES = new Set(["action_result", "not_actionable", "action_error", "error", "pong", "confirm_required"]);

function fallbackSpeech(msg: WsMessage): string | undefined {
  switch (msg.type) {
    case "pomodoro_transition": {
      const phase = (msg.phase as string | undefined) ?? (msg.currentPhase as string | undefined) ?? "";
      const isBreak = phase === "SHORT_BREAK" || phase === "LONG_BREAK";
      return isBreak ? "Break time. Drink some water and stretch." : "Break's over. Your next pomodoro starts now.";
    }
    case "pomodoro_complete":
      return "All cycles done. Great work!";
    case "workday_block_reminder":
      return "Your next block is starting.";
    case "workday_complete":
      return "Nice work today.";
    default:
      return undefined;
  }
}

function nowTime() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export type StartCallOptions = {
  /** Spoken as soon as the call connects (greeting, or the reason the buddy called) */
  opening?: string;
  callKitCallId?: string;
};

interface ConversationCtx {
  messages: Message[];
  processing: boolean;
  /** Bumped after two "not actionable" replies in a row — the UI highlights help */
  helpHint: number;
  sendUtterance: (text: string, meta?: TranscriptMeta, fromVoice?: boolean) => boolean;
  startCall: (opts?: StartCallOptions) => Promise<boolean>;
  endCall: () => void;
  pushMessage: (role: Role, text: string, action?: string) => void;
}

const ConversationContext = createContext<ConversationCtx | null>(null);

export function useConversation(): ConversationCtx {
  const ctx = useContext(ConversationContext);
  if (!ctx) throw new Error("useConversation must be used inside ConversationProvider");
  return ctx;
}

let msgId = 0;

export function ConversationProvider({ children }: { children: ReactNode }) {
  const { status, send, addListener, reconnect } = useWs();
  const voice = useVoice();
  const { speak, playMusic, stopMusic, startSession, endSession, notifyActivity, playThinkingCue } = voice;
  const [messages, setMessages] = useState<Message[]>([]);
  const [processing, setProcessing] = useState(false);
  const [helpHint, setHelpHint] = useState(0);

  const micActiveRef = useRef(voice.micActive);
  useEffect(() => { micActiveRef.current = voice.micActive; }, [voice.micActive]);
  const statusRef = useRef(status);
  useEffect(() => { statusRef.current = status; }, [status]);

  const notActionableStreak = useRef(0);
  // Replies still owed by the backend. If the user speaks again before a reply
  // lands, the older reply is stale: logged but not spoken.
  const pendingRepliesRef = useRef(0);
  const processingRef = useRef(false);
  const thinkingCueRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pushMessage = useCallback((role: Role, text: string, action?: string) => {
    setMessages((prev) => [...prev.slice(-199), { id: ++msgId, role, text, action, time: nowTime() }]);
  }, []);

  const settleReply = useCallback(() => {
    pendingRepliesRef.current = Math.max(0, pendingRepliesRef.current - 1);
    const stale = pendingRepliesRef.current > 0;
    if (!stale) {
      processingRef.current = false;
      setProcessing(false);
      if (thinkingCueRef.current) { clearTimeout(thinkingCueRef.current); thinkingCueRef.current = null; }
    }
    return stale;
  }, []);

  useEffect(() => {
    return addListener((msg) => {
      const speech = msg.speech as string | undefined;
      if (msg.type === "action_result") {
        const action = msg.action as string | undefined;
        notActionableStreak.current = 0;
        if (action && TASK_REFRESH_ACTIONS.has(action)) { emitChange("tasks"); emitChange("workday"); }
        if (action?.startsWith("note")) emitChange("notes");
        if (action?.startsWith("pomodoro")) emitChange("focus");
        if (action?.startsWith("calendar")) emitChange("calendar");
        if (speech) {
          const stale = settleReply();
          pushMessage("assistant", speech, action);
          if (micActiveRef.current && !stale) speak(speech);
          if (action === "music_play") playMusic();
          if (action === "music_stop") stopMusic();
        }
        return;
      }
      if (msg.type === "not_actionable") {
        notActionableStreak.current += 1;
        if (speech) {
          const stale = settleReply();
          pushMessage("assistant", speech);
          if (micActiveRef.current && !stale) speak(speech);
        }
        if (notActionableStreak.current >= 2) {
          notActionableStreak.current = 0;
          setHelpHint((n) => n + 1);
          setTimeout(() => {
            pushMessage(
              "assistant",
              `Tip: I work best with requests like "Add a task", "Start a focus timer", "What's on my calendar?", or "Take a note".`,
            );
          }, 600);
        }
        return;
      }
      if (msg.type === "action_error" || msg.type === "error") {
        const stale = settleReply();
        pushMessage("error", speech ?? (msg.type === "error" ? "Something went wrong. Please try again." : "That didn't work. Please try again."));
        if (speech && micActiveRef.current && !stale) speak(speech);
        return;
      }
      if (CONVERSATIONAL_TYPES.has(msg.type)) return;

      // Server pushes: reminders, pomodoro, workday, quota… Log them and speak
      // them whatever screen the user is on (or with the screen off, mid-call).
      if (msg.type.startsWith("pomodoro")) emitChange("focus");
      if (msg.type.startsWith("workday")) emitChange("workday");
      if (msg.type === "board_invite") { emitChange("invites"); return; }
      if (msg.type === "pomodoro_sync") return; // silent resync on reconnect
      const say = speech ?? fallbackSpeech(msg);
      if (!say) return;
      pushMessage("assistant", say, msg.type === "pomodoro_transition" || msg.type === "pomodoro_complete" ? "pomodoro_started" : msg.type);
      speak(say);
    });
  }, [addListener, pushMessage, speak, playMusic, stopMusic, settleReply]);

  const sendUtterance = useCallback((text: string, meta?: TranscriptMeta, fromVoice = false): boolean => {
    const trimmed = text.trim();
    // Typed input waits for the reply; voice can always take a new turn
    if (!trimmed || (processingRef.current && !fromVoice)) return false;
    notifyActivity();
    pushMessage("user", trimmed);
    const sent = send({
      type: "utterance",
      text: trimmed,
      // Lets the assistant know it was cut off and what the user actually heard
      ...(meta?.interrupted ? { interrupted: true, assistantSpokenSoFar: meta.interrupted.spokenSoFar } : {}),
      lang: "en",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      clientTime: new Date().toISOString(),
    });
    if (!sent) {
      reconnect();
      pushMessage("error", "Reconnecting… say that again in a moment.");
      return false;
    }
    pendingRepliesRef.current = processingRef.current ? pendingRepliesRef.current + 1 : 1;
    processingRef.current = true;
    setProcessing(true);
    // Only make a sound if the reply is slow — fast answers need no filler
    if (thinkingCueRef.current) clearTimeout(thinkingCueRef.current);
    if (fromVoice) {
      thinkingCueRef.current = setTimeout(() => {
        thinkingCueRef.current = null;
        if (processingRef.current) playThinkingCue();
      }, 700);
    }
    return true;
  }, [send, reconnect, notifyActivity, pushMessage, playThinkingCue]);

  const sendRef = useRef(sendUtterance);
  useEffect(() => { sendRef.current = sendUtterance; });

  const startCall = useCallback(async (opts: StartCallOptions = {}) => {
    if (statusRef.current !== "open") reconnect();
    const ok = await startSession({
      // Via ref so the session always calls the latest sendUtterance
      onTranscript: (text, meta) => sendRef.current(text, meta, true),
      callKitCallId: opts.callKitCallId,
    });
    if (!ok) return false;
    if (opts.opening) {
      pushMessage("assistant", opts.opening);
      speak(opts.opening);
    }
    return true;
  }, [startSession, reconnect, pushMessage, speak]);

  const endCall = useCallback(() => endSession(), [endSession]);

  return (
    <ConversationContext.Provider value={{ messages, processing, helpHint, sendUtterance, startCall, endCall, pushMessage }}>
      {children}
    </ConversationContext.Provider>
  );
}
