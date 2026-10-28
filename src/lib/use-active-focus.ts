import { useEffect, useState, useCallback } from "react";
import { pomodoro } from "./api";
import { useWs } from "./ws-context";
import { onChange } from "./events";

export type FocusPhase = "WORK" | "SHORT_BREAK" | "LONG_BREAK";

export interface ActiveFocusSession {
  id: string;
  currentPhase: FocusPhase;
  currentCycle: number;
  totalCycles: number;
  phaseEndsAt: string;
  /** Set while PAUSED */
  remainingMs?: number | null;
  config?: { pomodoroMinutes: number; shortBreakMinutes: number; longBreakMinutes: number };
}

const POLL_MS = 30_000;
const PHASE_END_GRACE_MS = 3_000;

function secsRemaining(phaseEndsAt: string): number {
  return Math.max(0, Math.round((new Date(phaseEndsAt).getTime() - Date.now()) / 1000));
}

/** Mirrors useCurrentBlock but for the active pomodoro session, so pages outside
 *  /focus can show a live "time left" indicator without duplicating the timer. */
export function useActiveFocus() {
  const { addListener } = useWs();
  const [session, setSession] = useState<ActiveFocusSession | null>(null);
  const [paused, setPaused] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pausedSecs, setPausedSecs] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await pomodoro.getActive();
      const s = (res.data as { data?: (ActiveFocusSession & { status: string }) | null } | null)?.data ?? null;
      if (s && s.status === "ACTIVE") {
        setSession(s);
        setSeconds(secsRemaining(s.phaseEndsAt));
        setPaused(false);
      } else if (s && s.status === "PAUSED") {
        // Unlike the web hook, keep paused sessions visible (Dynamic Island, status pills)
        setPausedSecs(Math.round((s.remainingMs ?? 0) / 1000));
        setSession(s);
        setPaused(true);
      } else {
        setSession(null);
      }
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    const off = onChange("focus", load);
    return () => { clearInterval(id); off(); };
  }, [load]);

  useEffect(() => {
    return addListener((msg) => {
      if (msg.type === "pomodoro_transition" || msg.type === "pomodoro_sync") load();
      if (msg.type === "pomodoro_complete") setSession(null);
      if (msg.type === "action_result") {
        const action = msg.action as string | undefined;
        if (action === "pomodoro_started" || action === "pomodoro_cancelled") load();
        if (action === "pomodoro_paused") {
          const remainingMs = (msg.remainingMs ?? (msg.data as { remainingMs?: number } | undefined)?.remainingMs) as number | undefined;
          if (remainingMs != null) setPausedSecs(Math.round(remainingMs / 1000));
          setPaused(true);
        }
        if (action === "pomodoro_resumed") {
          const phaseEndsAt = (msg.phaseEndsAt ?? (msg.data as { phaseEndsAt?: string } | undefined)?.phaseEndsAt) as string | undefined;
          if (phaseEndsAt) {
            setSession((prev) => (prev ? { ...prev, phaseEndsAt } : prev));
            setSeconds(secsRemaining(phaseEndsAt));
          }
          setPaused(false);
        }
      }
    });
  }, [addListener, load]);

  useEffect(() => {
    if (!session || paused) return;
    const id = setInterval(() => setSeconds(secsRemaining(session.phaseEndsAt)), 1000);
    return () => clearInterval(id);
  }, [session, paused]);

  // Reload just after the phase ends, in case the websocket transition is missed
  useEffect(() => {
    if (!session || paused) return;
    const ms = new Date(session.phaseEndsAt).getTime() - Date.now() + PHASE_END_GRACE_MS;
    const id = setTimeout(load, Math.max(PHASE_END_GRACE_MS, ms));
    return () => clearTimeout(id);
  }, [session, paused, load]);

  return {
    activeFocus: session,
    seconds: paused ? pausedSecs : seconds,
    paused,
    loading,
  };
}
