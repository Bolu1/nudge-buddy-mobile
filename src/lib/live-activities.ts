import { useEffect, useMemo, useRef } from "react";
import { Platform } from "react-native";
import LiveActivity, { type LiveKind, type LiveState } from "@modules/live-activity";
import VoiceEngine from "@modules/voice-engine";
import { push as pushApi, reminders as remindersApi } from "./api";
import { onChange } from "./events";
import { getPref } from "./storage";
import { PREFS } from "./prefs";
import { useActiveFocus, type ActiveFocusSession } from "./use-active-focus";
import { useCurrentBlock, type CurrentBlock } from "./use-current-block";
import { useVoice } from "./voice/voice-context";
import { useWs } from "./ws-context";

// Mirrors app state into iOS Live Activities (Dynamic Island + lock screen) —
// on Android, ongoing notifications with a live timer (Live Update chips on 16+):
// the focus timer, the next reminder, the current workday block and live
// buddy calls. Timers are rendered by the system from the end/start dates,
// so they keep ticking with the app closed; phase changes while the app is
// suspended come from the backend via the activities' push tokens.

const REMINDER_LOOKAHEAD_MS = 60 * 60 * 1000;  // show a reminder from an hour before it's due
const FIRED_REMINDER_LINGER_S = 10 * 60;       // keep a fired reminder on the lock screen this long
const REMINDER_POLL_MS = 5 * 60 * 1000;

const PREF_FOR: Record<LiveKind, string> = {
  focus: PREFS.liveFocus,
  reminder: PREFS.liveReminder,
  block: PREFS.liveBlock,
  call: PREFS.liveCall,
};

export function liveKindEnabled(kind: LiveKind): boolean {
  return getPref(PREF_FOR[kind]) !== "0";
}

const epoch = (iso: string | Date) => new Date(iso).getTime() / 1000;

// ── one activity per kind ───────────────────────────────────────────────────

type Slot = { id: string | null; json: string; busy: Promise<void>; desired: LiveState | null };
const slots = new Map<LiveKind, Slot>();

function slot(kind: LiveKind): Slot {
  let s = slots.get(kind);
  if (!s) { s = { id: null, json: "", busy: Promise.resolve(), desired: null }; slots.set(kind, s); }
  return s;
}

/** Android: the call already has its foreground-service notification */
function syncAndroid(kind: LiveKind, state: LiveState | null) {
  if (kind === "call") return;
  if (state && liveKindEnabled(kind)) {
    const text = state.status ? `${state.status} · ${state.subtitle}` : state.subtitle;
    VoiceEngine.showLiveUpdate(kind, state.title, text, state.startEpoch ?? null, state.endEpoch ?? null, !!state.paused, state.colorHex);
  } else {
    VoiceEngine.clearLiveUpdate(kind);
  }
}

/** Start, update or end the activity for `kind`. Calls are serialised per kind. */
function sync(kind: LiveKind, state: LiveState | null, opts: { alert?: { title: string; body: string }; dismissAfter?: number } = {}) {
  const s = slot(kind);
  s.desired = state;
  if (Platform.OS === "android") {
    syncAndroid(kind, state);
    if (opts.dismissAfter != null) setTimeout(() => { if (slot(kind).desired === state) syncAndroid(kind, null); }, opts.dismissAfter * 1000);
    return;
  }
  if (!LiveActivity) return;
  s.busy = s.busy.then(async () => {
    try {
      const wanted = state && liveKindEnabled(kind) ? state : null;
      if (!wanted) {
        if (s.id) await LiveActivity!.end(s.id, null, null);
        s.id = null;
        s.json = "";
        return;
      }
      const json = JSON.stringify(wanted);
      if (s.id && json === s.json && !opts.alert) return;
      if (s.id) {
        await LiveActivity!.update(s.id, wanted, opts.alert ?? null, null);
        if (opts.dismissAfter != null) {
          await LiveActivity!.end(s.id, wanted, opts.dismissAfter);
          s.id = null;
          s.json = "";
          return;
        }
      } else {
        s.id = await LiveActivity!.start(kind, wanted, null);
      }
      s.json = json;
    } catch (e) {
      console.warn(`[live] ${kind} sync failed`, e);
    }
  });
}

// ── state builders ──────────────────────────────────────────────────────────

const PHASE: Record<string, { title: string; symbol: string; color: string; minutes: (c: ActiveFocusSession["config"]) => number | undefined }> = {
  WORK: { title: "Focus", symbol: "timer", color: "#8da38a", minutes: (c) => c?.pomodoroMinutes },
  SHORT_BREAK: { title: "Short break", symbol: "cup.and.saucer.fill", color: "#f7b8a5", minutes: (c) => c?.shortBreakMinutes },
  LONG_BREAK: { title: "Long break", symbol: "cup.and.saucer.fill", color: "#f7b8a5", minutes: (c) => c?.longBreakMinutes },
};

function focusState(s: ActiveFocusSession, paused: boolean, pausedSecs: number): LiveState {
  const p = PHASE[s.currentPhase] ?? PHASE.WORK;
  const end = epoch(s.phaseEndsAt);
  const mins = p.minutes(s.config);
  return {
    title: p.title,
    subtitle: `Cycle ${s.currentCycle} of ${s.totalCycles}${paused ? " · paused" : ""}`,
    startEpoch: mins ? end - mins * 60 : null,
    endEpoch: end,
    paused,
    pausedRemaining: paused ? pausedSecs : null,
    colorHex: p.color,
    symbol: paused ? "pause.circle.fill" : p.symbol,
  };
}

function blockState(b: CurrentBlock): LiveState {
  const open = b.tasks?.filter((t) => t.status !== "COMPLETED").length ?? 0;
  const until = new Date(b.endTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return {
    title: b.name,
    subtitle: `Until ${until}${open ? ` · ${open} task${open === 1 ? "" : "s"} left` : ""}`,
    startEpoch: epoch(b.startTime),
    endEpoch: epoch(b.endTime),
    colorHex: b.color || "#8da38a",
    symbol: "square.stack.3d.up.fill",
  };
}

type ReminderRow = { id: string; message: string; fireAt: string; status: string; task?: { title?: string } | null };

function reminderState(r: ReminderRow, fired: boolean): LiveState {
  return {
    title: fired ? "Reminder" : "Coming up",
    subtitle: r.task?.title && r.task.title !== r.message ? `${r.message} · ${r.task.title}` : r.message,
    endEpoch: fired ? null : epoch(r.fireAt),
    status: fired ? "Now" : null,
    colorHex: "#c3a06e",
    symbol: fired ? "bell.badge.fill" : "bell.fill",
  };
}

// ── hook ────────────────────────────────────────────────────────────────────

export function useLiveActivities() {
  const enabled = Platform.OS === "android" || !!LiveActivity;
  const { activeFocus, paused, seconds } = useActiveFocus();
  const { currentBlock } = useCurrentBlock();
  const { micActive, muted, ttsActive, userSpeaking } = useVoice();
  const { addListener } = useWs();
  const callStartRef = useRef<number | null>(null);
  const firedReminderRef = useRef<string | null>(null);

  // Adopt activities left over from a previous launch, report push tokens
  useEffect(() => {
    if (Platform.OS !== "ios" || !LiveActivity) return;
    for (const a of LiveActivity.list()) {
      const s = slot(a.kind);
      if (!s.id) s.id = a.id;
      else void LiveActivity.end(a.id, null, null); // duplicate of a kind
    }
    const subs = [
      LiveActivity.addListener("onPushToken", ({ id, kind, token }) => {
        pushApi.registerLiveActivity({ activityId: id, kind, token }).catch(() => {});
      }),
      LiveActivity.addListener("onPushToStartToken", ({ token }) => {
        pushApi.registerLiveActivityStartToken({ token }).catch(() => {});
      }),
      LiveActivity.addListener("onActivityEnded", ({ id, kind }) => {
        const s = slot(kind);
        if (s.id === id) { s.id = null; s.json = ""; }
      }),
    ];
    return () => subs.forEach((s) => s.remove());
  }, []);

  // Focus timer. `seconds` ticks every second — only the paused value matters here.
  const pausedSecs = paused ? seconds : 0;
  const focus = useMemo(
    () => (activeFocus ? focusState(activeFocus, paused, pausedSecs) : null),
    [activeFocus, paused, pausedSecs],
  );
  useEffect(() => { if (enabled) sync("focus", focus); }, [enabled, focus]);

  // Current workday block
  const block = useMemo(() => (currentBlock ? blockState(currentBlock) : null), [currentBlock]);
  useEffect(() => { if (enabled) sync("block", block); }, [enabled, block]);

  // Live call
  const callStatus = muted ? "Muted" : ttsActive ? "Speaking" : userSpeaking ? "Hearing you" : "Listening";
  useEffect(() => {
    if (!enabled) return;
    // Remember when this call started so status updates keep the same timer
    if (!micActive) callStartRef.current = null;
    else if (callStartRef.current === null) callStartRef.current = Date.now() / 1000;
    sync("call", micActive ? {
      title: "Nudge Buddy",
      subtitle: "On a call",
      status: callStatus,
      startEpoch: callStartRef.current,
      colorHex: muted ? "#8d928a" : ttsActive ? "#f7b8a5" : "#b6cdb2",
      symbol: muted ? "mic.slash.fill" : "waveform",
    } : null);
  }, [enabled, micActive, callStatus, muted, ttsActive]);

  // Next reminder within the hour; a firing reminder takes over with an alert
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    async function refresh() {
      if (firedReminderRef.current) return; // a fired reminder is showing — leave it
      const res = await remindersApi.list().catch(() => null);
      if (cancelled || !res?.ok) return;
      const list = ((res.data as { data?: ReminderRow[] } | null)?.data ?? []) as ReminderRow[];
      const now = Date.now();
      const next = list
        .filter((r) => r.status === "SCHEDULED" && new Date(r.fireAt).getTime() > now)
        .sort((a, b) => new Date(a.fireAt).getTime() - new Date(b.fireAt).getTime())[0];
      sync("reminder", next && new Date(next.fireAt).getTime() - now <= REMINDER_LOOKAHEAD_MS ? reminderState(next, false) : null);
    }
    void refresh();
    const id = setInterval(refresh, REMINDER_POLL_MS);
    const offTasks = onChange("tasks", refresh);
    const offWs = addListener((msg) => {
      if (msg.type === "action_result" && typeof msg.action === "string" && msg.action.startsWith("reminder")) void refresh();
      if (msg.type !== "reminder") return;
      const r = msg.reminder as { id: string; message: string; fireAt?: string; task?: { title?: string } | null } | undefined;
      if (!r) return;
      firedReminderRef.current = r.id;
      const row: ReminderRow = { id: r.id, message: r.message, fireAt: r.fireAt ?? new Date().toISOString(), status: "FIRED", task: r.task };
      sync("reminder", reminderState(row, true), { alert: { title: "Reminder", body: r.message }, dismissAfter: FIRED_REMINDER_LINGER_S });
      setTimeout(() => { firedReminderRef.current = null; void refresh(); }, FIRED_REMINDER_LINGER_S * 1000);
    });
    return () => { cancelled = true; clearInterval(id); offTasks(); offWs(); };
  }, [enabled, addListener]);
}

/** Re-apply the per-kind toggles (Settings) right away */
export function refreshLiveActivityPrefs() {
  for (const [kind, s] of slots) sync(kind, s.desired);
}
