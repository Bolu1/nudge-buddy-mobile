import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { auth as authApi, getToken } from "./api";
import { wsUrl } from "./config";
import { useToast } from "./toast-context";

export type WsStatus = "connecting" | "open" | "closed" | "error";
export type WsMessage = { type: string } & Record<string, unknown>;

type Listener = (msg: WsMessage) => void;

interface WsCtx {
  status: WsStatus;
  send: (msg: object) => boolean;
  addListener: (fn: Listener) => () => void;
  reconnect: () => void;
}

const WsContext = createContext<WsCtx>({
  status: "closed",
  send: () => false,
  addListener: () => () => {},
  reconnect: () => {},
});

export const useWs = () => useContext(WsContext);

export function WsProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [status, setStatus] = useState<WsStatus>("closed");
  const wsRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef<Set<Listener>>(new Set());
  const retryDelay = useRef(1000);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dead = useRef(false);
  const failedOpens = useRef(0);
  // Latest connect(), for reconnect timers scheduled from inside connect itself
  const connectRef = useRef<() => void>(() => {});

  // Server pushes that aren't part of a conversation turn get an in-app toast.
  // (Speaking them is ReminderSpeaker's job; when the app is closed the backend
  // sends a push notification instead.)
  const dispatch = useCallback((msg: WsMessage) => {
    const speech = msg.speech as string | undefined;
    switch (msg.type) {
      case "reminder": {
        const r = msg.reminder as { message?: string; task?: { title?: string } | null } | undefined;
        toast.event("Reminder", r?.message ?? speech ?? "Reminder");
        break;
      }
      case "quota_exceeded":
        toast.event(msg.reason === "monthly_limit" ? "Monthly limit reached" : "Daily limit reached", speech ?? "");
        break;
      case "pomodoro_transition": {
        const phase = (msg.phase as string | undefined) ?? (msg.currentPhase as string | undefined) ?? "";
        const isBreak = phase === "SHORT_BREAK" || phase === "LONG_BREAK";
        toast.event(
          isBreak ? "Break time!" : "Back to work!",
          speech ?? (isBreak ? "Drink some water and stretch." : "Your next pomodoro starts now."),
        );
        break;
      }
      case "pomodoro_complete":
        toast.event("Session complete!", speech ?? "All cycles done. Great work!");
        break;
      case "workday_block_reminder":
        toast.event("Workday", speech ?? "Your next block is starting.");
        break;
      case "workday_complete":
        toast.event("Workday complete", speech ?? "Nice work today.");
        break;
      case "board_invite":
        toast.event("Board invite", (msg.message as string | undefined) ?? "You've been invited to a board.");
        break;
    }
    for (const fn of listenersRef.current) {
      try { fn(msg); } catch { /* ignore */ }
    }
  }, [toast]);

  const scheduleReconnect = useCallback((connectFn: () => void) => {
    if (dead.current || retryTimer.current) return;
    const d = Math.min(retryDelay.current, 30_000);
    retryDelay.current = d * 2;
    retryTimer.current = setTimeout(() => {
      retryTimer.current = null;
      connectFn();
    }, d);
  }, []);

  const connect = useCallback(async () => {
    if (dead.current) return;
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) return;
    // A socket that keeps failing usually means an expired access token — a REST
    // call refreshes it (apiFetch retries 401s via the refresh token).
    if (failedOpens.current > 0) await authApi.me().catch(() => {});
    const token = getToken();
    if (!token || dead.current) return;

    setStatus("connecting");
    const ws = new WebSocket(wsUrl(token));
    wsRef.current = ws;
    let opened = false;

    ws.onopen = () => {
      if (dead.current) { ws.close(); return; }
      opened = true;
      failedOpens.current = 0;
      setStatus("open");
      retryDelay.current = 1000;
      if (pingRef.current) clearInterval(pingRef.current);
      pingRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
      }, 30_000);
    };

    ws.onmessage = (e) => {
      try { dispatch(JSON.parse(String(e.data)) as WsMessage); } catch { /* ignore */ }
    };

    ws.onclose = (e) => {
      if (wsRef.current === ws) wsRef.current = null;
      if (pingRef.current) { clearInterval(pingRef.current); pingRef.current = null; }
      if (!opened) failedOpens.current++;
      if (dead.current) return;
      setStatus("closed");
      if (e.code !== 1000) scheduleReconnect(() => connectRef.current());
    };

    ws.onerror = () => {
      setStatus("error");
    };
  }, [dispatch, scheduleReconnect]);

  useEffect(() => {
    connectRef.current = () => { void connect(); };
  }, [connect]);

  useEffect(() => {
    dead.current = false;
    void connect();
    // Back in the foreground: the OS may have killed the socket — reconnect now
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active") return;
      if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
        retryDelay.current = 1000;
        if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
        void connect();
      }
    });
    return () => {
      sub.remove();
      dead.current = true;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      if (pingRef.current) clearInterval(pingRef.current);
      wsRef.current?.close(1000);
      wsRef.current = null;
    };
  }, [connect]);

  const send = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }, []);

  const reconnect = useCallback(() => {
    dead.current = false;
    retryDelay.current = 1000;
    if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
    void connect();
  }, [connect]);

  const addListener = useCallback((fn: Listener) => {
    listenersRef.current.add(fn);
    return () => { listenersRef.current.delete(fn); };
  }, []);

  return (
    <WsContext.Provider value={{ status, send, addListener, reconnect }}>
      {children}
    </WsContext.Provider>
  );
}
