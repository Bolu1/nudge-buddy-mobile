import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "@/components/ui/SafeArea";
import Svg, { Circle } from "react-native-svg";
import { pomodoro } from "@/lib/api";
import { emitChange, onChange } from "@/lib/events";
import { getPref, setPref } from "@/lib/storage";
import { PREFS } from "@/lib/prefs";
import { colors } from "@/lib/theme";
import { useWs } from "@/lib/ws-context";
import { Button, ErrorBanner, Icon, IconButton, ScreenHeader, SectionTitle } from "@/components/ui";

type Phase = "WORK" | "SHORT_BREAK" | "LONG_BREAK";
type TimerState = "idle" | "running" | "paused";

interface PomodoroSession {
  id: string;
  config: { cycles: number; pomodoroMinutes: number; shortBreakMinutes: number; longBreakMinutes: number };
  status: string;
  currentPhase: Phase;
  currentCycle: number;
  totalCycles: number;
  phaseEndsAt: string;
  /** Set while PAUSED */
  remainingMs?: number | null;
  startedAt: string;
  completedAt: string | null;
}

interface HistorySession {
  id: string;
  config: { pomodoroMinutes: number };
  status: string;
  currentPhase: Phase;
  currentCycle: number;
  totalCycles: number;
  startedAt: string;
  completedAt: string | null;
}

const phaseLabel: Record<Phase, string> = { WORK: "Work", SHORT_BREAK: "Short Break", LONG_BREAK: "Long Break" };

const suggestions = [
  "Close all notification tabs before starting.",
  "Put your phone in a drawer, face down.",
  "Have a glass of water nearby.",
  "Write down your single intention for this session.",
  "Take 3 slow breaths before you begin.",
];

const CFG = { work: PREFS.pomoWork, short: PREFS.pomoShort, long: PREFS.pomoLong, cycles: PREFS.pomoCycles } as const;
const cfgNum = (key: string, fallback: number) => Number(getPref(key) ?? fallback) || fallback;

function formatTime(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function secsRemaining(phaseEndsAt: string) {
  return Math.max(0, Math.round((new Date(phaseEndsAt).getTime() - Date.now()) / 1000));
}

function Stepper({ label, value, min, max, onChange: set }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <View className="flex-row items-center justify-between py-2">
      <Text className="text-on-surface-variant text-sm">{label}</Text>
      <View className="flex-row items-center gap-3">
        <Pressable onPress={() => set(Math.max(min, value - 1))} className="w-8 h-8 rounded-full bg-surface-high items-center justify-center" hitSlop={4}>
          <Text className="text-on-surface text-base">−</Text>
        </Pressable>
        <Text className="text-on-surface text-sm font-semibold w-8 text-center">{value}</Text>
        <Pressable onPress={() => set(Math.min(max, value + 1))} className="w-8 h-8 rounded-full bg-surface-high items-center justify-center" hitSlop={4}>
          <Text className="text-on-surface text-base">+</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function FocusScreen() {
  const { addListener } = useWs();
  const [timerState, setTimerState] = useState<TimerState>("idle");
  const [session, setSession] = useState<PomodoroSession | null>(null);
  const [cfgWork, setCfgWork] = useState(() => cfgNum(CFG.work, 25));
  const [cfgShort, setCfgShort] = useState(() => cfgNum(CFG.short, 5));
  const [cfgLong, setCfgLong] = useState(() => cfgNum(CFG.long, 15));
  const [cfgCycles, setCfgCycles] = useState(() => cfgNum(CFG.cycles, 3));
  const [seconds, setSeconds] = useState(() => cfgNum(CFG.work, 25) * 60);
  const [history, setHistory] = useState<HistorySession[]>([]);
  const [checkIn, setCheckIn] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const cfgWorkRef = useRef(cfgWork);
  useEffect(() => { cfgWorkRef.current = cfgWork; }, [cfgWork]);

  const loadActive = useCallback(async () => {
    try {
      const res = await pomodoro.getActive();
      const s = (res.data as { data?: PomodoroSession | null } | null)?.data ?? null;
      if (s && s.status === "ACTIVE") {
        setSession(s);
        setSeconds(secsRemaining(s.phaseEndsAt));
        setTimerState("running");
      } else if (s && s.status === "PAUSED") {
        setSession(s);
        setSeconds(Math.round((s.remainingMs ?? 0) / 1000));
        setTimerState("paused");
      } else if (res.ok) {
        setSession(null);
        setTimerState("idle");
        setSeconds(cfgWorkRef.current * 60);
      }
    } catch { /* no active session */ }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const res = await pomodoro.getHistory();
      setHistory((res.data as { data?: HistorySession[] } | null)?.data ?? []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadActive();
    loadHistory();
    return onChange("focus", loadActive);
  }, [loadActive, loadHistory]);

  useEffect(() => {
    if (timerState === "idle") setSeconds(cfgWork * 60);
  }, [cfgWork, timerState]);

  // Real-time phase changes, and changes made by voice
  useEffect(() => addListener((msg) => {
    if (msg.type === "pomodoro_transition") { setCheckIn(true); loadActive(); }
    if (msg.type === "pomodoro_sync") loadActive();
    if (msg.type === "pomodoro_complete") {
      setTimerState("idle"); setSession(null); setSeconds(cfgWorkRef.current * 60); setCheckIn(false); loadHistory();
    }
    if (msg.type === "action_result") {
      const action = msg.action as string | undefined;
      const data = (msg.data ?? {}) as { remainingMs?: number; phaseEndsAt?: string };
      if (action === "pomodoro_started") loadActive();
      if (action === "pomodoro_paused") {
        if (data.remainingMs != null) setSeconds(Math.round(data.remainingMs / 1000));
        setTimerState("paused");
      }
      if (action === "pomodoro_resumed") {
        if (data.phaseEndsAt) {
          const ends = data.phaseEndsAt;
          setSession((prev) => (prev ? { ...prev, phaseEndsAt: ends } : prev));
          setSeconds(secsRemaining(ends));
        }
        setTimerState("running");
      }
      if (action === "pomodoro_cancelled") {
        setTimerState("idle"); setSession(null); setSeconds(cfgWorkRef.current * 60); setCheckIn(false); loadHistory();
      }
    }
  }), [addListener, loadActive, loadHistory]);

  // Tick; when a phase runs out, poll as a fallback for a missed transition message
  useEffect(() => {
    if (timerState !== "running" || !session) return;
    let lastCheck = 0;
    const id = setInterval(() => {
      const secs = secsRemaining(session.phaseEndsAt);
      setSeconds(secs);
      if (secs <= 0 && Date.now() - lastCheck >= 3000) {
        lastCheck = Date.now();
        setCheckIn(true);
        void loadActive();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [timerState, session, loadActive]);

  function saveCfg(key: string, setter: (v: number) => void) {
    return (v: number) => { setter(v); setPref(key, String(v)); };
  }

  async function start() {
    setError("");
    setStarting(true);
    try {
      const res = await pomodoro.start({ pomodoroMinutes: cfgWork, shortBreakMinutes: cfgShort, longBreakMinutes: cfgLong, cycles: cfgCycles });
      const s = (res.data as { data?: PomodoroSession } | null)?.data;
      if (res.ok && s) {
        setSession(s);
        setSeconds(secsRemaining(s.phaseEndsAt));
        setTimerState("running");
        setCheckIn(false);
        setShowConfig(false);
        emitChange("focus");
      } else {
        setError((res.data as { errors?: string[] } | null)?.errors?.[0] ?? "Failed to start session.");
      }
    } catch {
      setError("Network error.");
    } finally {
      setStarting(false);
    }
  }

  async function pause() {
    try {
      const res = await pomodoro.pause();
      const ms = (res.data as { data?: { remainingMs?: number } } | null)?.data?.remainingMs;
      if (ms != null) setSeconds(Math.round(ms / 1000));
    } catch { /* keep local count */ }
    setTimerState("paused");
    emitChange("focus");
  }

  async function resume() {
    try {
      const res = await pomodoro.resume();
      const ends = (res.data as { data?: { phaseEndsAt?: string } } | null)?.data?.phaseEndsAt;
      if (ends) {
        setSession((prev) => (prev ? { ...prev, phaseEndsAt: ends } : prev));
        setSeconds(secsRemaining(ends));
      }
    } catch { /* keep local count */ }
    setTimerState("running");
    emitChange("focus");
  }

  async function cancel() {
    await pomodoro.cancel().catch(() => {});
    setTimerState("idle");
    setSession(null);
    setSeconds(cfgWork * 60);
    setCheckIn(false);
    loadHistory();
    emitChange("focus");
  }

  const phase = session?.currentPhase ?? "WORK";
  const cycle = session?.currentCycle ?? 1;
  const totalCycles = session?.totalCycles ?? cfgCycles;
  const totalSecs =
    (phase === "WORK" ? session?.config.pomodoroMinutes ?? cfgWork
      : phase === "SHORT_BREAK" ? session?.config.shortBreakMinutes ?? cfgShort
      : session?.config.longBreakMinutes ?? cfgLong) * 60;
  const progress = Math.min(1, Math.max(0, 1 - seconds / Math.max(1, totalSecs)));
  const R = 90;
  const circumference = 2 * Math.PI * R;

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-bg">
      <ScreenHeader
        title="Focus Timer"
        subtitle={`${phaseLabel[phase]} · Cycle ${cycle}/${totalCycles}`}
      />
      <ScrollView contentContainerClassName="p-5 gap-6 pb-32 items-stretch">
        <ErrorBanner message={error} />

        <View className="items-center">
          <View className={`px-4 py-1.5 rounded-full mb-6 ${phase === "WORK" ? "bg-on-primary-container" : "bg-surface-high"}`}>
            <Text className={`text-xs font-medium tracking-wide uppercase ${phase === "WORK" ? "text-primary-container" : "text-on-surface-variant"}`}>{phaseLabel[phase]}</Text>
          </View>
          <View className="items-center justify-center">
            <Svg width={220} height={220} viewBox="0 0 220 220" style={{ transform: [{ rotate: "-90deg" }] }}>
              <Circle cx={110} cy={110} r={R} fill="none" stroke={colors.surfaceHigh} strokeWidth={8} />
              <Circle
                cx={110}
                cy={110}
                r={R}
                fill="none"
                stroke={phase === "WORK" ? colors.primaryContainer : colors.secondary}
                strokeWidth={8}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - progress)}
              />
            </Svg>
            <View className="absolute items-center">
              <Text className="text-on-surface text-5xl font-semibold" style={{ fontVariant: ["tabular-nums"] }}>{formatTime(seconds)}</Text>
              {timerState === "paused" ? <Text className="text-outline text-xs mt-1 uppercase tracking-widest">Paused</Text> : null}
            </View>
          </View>

          <View className="flex-row items-center gap-4 mt-8">
            {timerState === "idle" ? (
              <>
                <Button title={starting ? "Starting…" : "Start focus"} icon="play" onPress={start} loading={starting} className="px-8" />
                <IconButton name="settings" onPress={() => setShowConfig((s) => !s)} accessibilityLabel="Timer settings" />
              </>
            ) : (
              <>
                <Pressable
                  onPress={timerState === "running" ? pause : resume}
                  accessibilityLabel={timerState === "running" ? "Pause" : "Resume"}
                  className="w-16 h-16 rounded-full bg-primary-container items-center justify-center"
                >
                  <Icon name={timerState === "running" ? "pause" : "play"} size={24} color={colors.onPrimary} fill={colors.onPrimary} />
                </Pressable>
                <Pressable onPress={cancel} accessibilityLabel="Stop" className="w-12 h-12 rounded-full bg-surface-high items-center justify-center">
                  <Icon name="stop" size={18} color={colors.onSurfaceVariant} />
                </Pressable>
              </>
            )}
          </View>
        </View>

        {showConfig && timerState === "idle" ? (
          <View className="bg-surface-low border border-divider rounded-2xl px-4 py-2">
            <Stepper label="Work (min)" value={cfgWork} min={1} max={120} onChange={saveCfg(CFG.work, setCfgWork)} />
            <Stepper label="Short break" value={cfgShort} min={1} max={30} onChange={saveCfg(CFG.short, setCfgShort)} />
            <Stepper label="Long break" value={cfgLong} min={1} max={60} onChange={saveCfg(CFG.long, setCfgLong)} />
            <Stepper label="Cycles" value={cfgCycles} min={1} max={10} onChange={saveCfg(CFG.cycles, setCfgCycles)} />
          </View>
        ) : null}

        {checkIn ? (
          <View className="bg-[#1a2b1a] border border-on-primary-container rounded-2xl p-4 flex-row items-center gap-3">
            <Icon name="check" size={16} color={colors.primaryContainer} strokeWidth={2.5} />
            <View className="flex-1">
              <Text className="text-primary text-sm font-medium">Phase complete</Text>
              <Text className="text-outline text-xs mt-0.5">{phase === "WORK" ? "Back to it — you've got this." : "Take a breather. Stretch, sip some water."}</Text>
            </View>
            <IconButton name="x" onPress={() => setCheckIn(false)} accessibilityLabel="Dismiss" />
          </View>
        ) : null}

        <View className="bg-surface-low border border-divider rounded-2xl p-4">
          <SectionTitle>Smart suggestions</SectionTitle>
          <View className="gap-2">
            {suggestions.map((s) => (
              <View key={s} className="flex-row gap-2">
                <Text className="text-primary-container">•</Text>
                <Text className="text-on-surface-variant text-sm flex-1">{s}</Text>
              </View>
            ))}
          </View>
        </View>

        <View>
          <SectionTitle>Recent sessions</SectionTitle>
          {history.length === 0 ? (
            <Text className="text-outline text-sm">No sessions yet.</Text>
          ) : (
            <View className="gap-2">
              {history.map((h) => (
                <View key={h.id} className="flex-row items-center justify-between bg-surface-low border border-divider rounded-xl px-4 py-3">
                  <View>
                    <Text className="text-on-surface-variant text-sm">{h.config.pomodoroMinutes} min · {h.currentCycle}/{h.totalCycles} cycles</Text>
                    <Text className="text-outline text-xs mt-0.5">{new Date(h.startedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</Text>
                  </View>
                  <Text className={`text-xs ${h.status === "COMPLETED" ? "text-primary" : "text-outline"}`}>{h.status.toLowerCase()}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
