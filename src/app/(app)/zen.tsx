import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View, type LayoutChangeEvent } from "react-native";
import { router } from "expo-router";
import { GLView, type ExpoWebGLRenderingContext } from "expo-gl";
import { useKeepAwake } from "expo-keep-awake";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Defs, LinearGradient, Stop } from "react-native-svg";
import * as THREE from "three";
import { useWs } from "@/lib/ws-context";
import { useVoice } from "@/lib/voice/voice-context";
import { useConversation } from "@/lib/conversation-context";
import { useActiveFocus } from "@/lib/use-active-focus";
import { tasks as tasksApi, notes as notesApi, calendar as calendarApi } from "@/lib/api";
import { htmlToText } from "@/lib/notes";
import { getPref, setPref } from "@/lib/storage";
import { PREFS } from "@/lib/prefs";
import { useReducedMotion } from "@/lib/motion";
import { Icon, type IconName } from "@/components/ui/Icon";
import { createRenderer } from "@/components/zen/gl";
import { SpeechBubble } from "@/components/zen/SpeechBubble";
import { useZenWorkday } from "@/components/zen/useZenWorkday";
import { buildRoom, ROOM_THEMES, TIMES_OF_DAY, timeFromClock, type Room, type RoomTheme, type TimeOfDay } from "@/components/zen/office/room";
import { createDirector, type ActionData, type BuddyAction, type Director } from "@/components/zen/office/director";
import { clockTime as formatClock, drawLabel, type TaskLine } from "@/components/zen/office/canvas";

// Zen: Buddy's room in 3D — Buddy at the desk acts out what you ask, the PC
// shows today's workday, the tomato timer counts down your focus session.
// Opening it starts (or joins) the voice call; the call keeps going after you
// leave. Ported from the web app's Zen workspace (components/zen).

const THINK_TIMEOUT_MS = 20_000;
const UI_IDLE_MS = 3500;
const FADE_MS = 450;
const BUBBLE_MS = 6500;

type TimeMode = "auto" | TimeOfDay;

const TIME_ICONS: Record<TimeOfDay, IconName> = { morning: "sunrise", day: "sun", evening: "sunset", night: "moon" };

function savedRoom(): RoomTheme {
  const v = getPref(PREFS.zenRoom);
  return ROOM_THEMES.some((r) => r.id === v) ? (v as RoomTheme) : "home";
}

function savedTime(): TimeMode {
  const v = getPref(PREFS.zenTime);
  return v === "auto" || TIMES_OF_DAY.some((t) => t.id === v) ? (v as TimeMode) : "auto";
}

/**
 * Maps an assistant reply to something for the mascot to act out. Action names
 * come first; for actions the client doesn't know by name, fall back to what
 * the user asked for and what the assistant said.
 */
function classify(action: string | undefined, speech: string, utterance: string): BuddyAction | null {
  const said = `${utterance} ${speech}`.toLowerCase();
  if (action) {
    if (/remind/.test(utterance.toLowerCase()) && (action.startsWith("task_created") || action.includes("reminder"))) return "reminderSet";
    if (action === "task_created" || action === "multiple_tasks_created" || action === "subtask_added") return "taskCreated";
    if (action === "task_completed" || action === "all_tasks_completed" || action === "subtask_toggled") return "taskCompleted";
    if (action === "task_summary" || /progress|summary|stats/.test(action)) return "progress";
    if (action.startsWith("task") || action === "all_tasks_deleted") return "tasksListed";
    if (action.startsWith("note")) return "notes";
    if (action === "pomodoro_started") return "pomodoro";
    if (action === "pomodoro_paused") return "pause";
    if (action === "pomodoro_resumed") return "resume";
    if (action === "pomodoro_cancelled") return "cancel";
    if (action.includes("reminder")) return "reminderSet";
    if (action.startsWith("calendar") && action !== "calendar_connect_initiated") return "calendar";
    if (action === "music_play") return "music";
    if (action.startsWith("pomodoro") || action.startsWith("music") || action === "quota_exceeded" || action === "plan_upgrade_required") return null;
  }
  if (/remind/.test(said)) return "reminderSet";
  if (/calendar|schedule|meeting|event/.test(said)) return "calendar";
  if (/progress|how many|completed|summary/.test(said)) return "progress";
  if (/brain ?dump|\bnote\b|jot/.test(said)) return "notes";
  if (/\btask|to-?do/.test(said)) return "tasksListed";
  return null;
}

async function fetchTasks(): Promise<{ lines: TaskLine[]; done: number; pending: number }> {
  try {
    const res = await tasksApi.list();
    const list = ((res.data as { data?: { title: string; status: string }[] } | null)?.data ?? []);
    const lines = list.map((t) => ({ title: t.title, done: t.status === "COMPLETED" }));
    const done = lines.filter((l) => l.done).length;
    // Unfinished first, then a few recent wins
    return { lines: [...lines.filter((l) => !l.done), ...lines.filter((l) => l.done)], done, pending: lines.length - done };
  } catch {
    return { lines: [], done: 0, pending: 0 };
  }
}

async function fetchLatestNote(): Promise<string> {
  try {
    const res = await notesApi.list();
    const list = (res.data as { data?: { content: string }[] } | null)?.data ?? [];
    return list[0] ? htmlToText(list[0].content) : "";
  } catch {
    return "";
  }
}

async function fetchTodayEvents(): Promise<string[]> {
  try {
    const res = await calendarApi.getEvents();
    const raw = res.data as { data?: unknown[] } | { events?: unknown[] } | unknown[] | null;
    const list = (Array.isArray(raw) ? raw : raw && "data" in raw ? raw.data : raw && "events" in raw ? raw.events : []) as {
      summary?: string;
      start?: { dateTime?: string; date?: string };
    }[];
    const today = new Date().toDateString();
    return (list ?? [])
      .filter((e) => {
        const d = e.start?.dateTime ?? e.start?.date;
        return d && new Date(d.includes("T") ? d : `${d}T00:00:00`).toDateString() === today;
      })
      .map((e) => {
        const time = e.start?.dateTime ? new Date(e.start.dateTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "All day";
        return `${time} ${e.summary ?? "Event"}`;
      });
  } catch {
    return [];
  }
}

function reminderText(utterance: string, speech: string) {
  const cleaned = utterance.replace(/^(please\s+)?(can you\s+)?(remind me|set a reminder)(\s+to)?\s*/i, "").trim();
  return cleaned || speech.replace(/^(okay|ok|sure|got it)[,.!]?\s*/i, "");
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Room swatch — the web's CSS gradient, as a two-colour dot */
function Swatch({ css, id }: { css: string; id: string }) {
  const [a = "#888", b = a] = css.match(/#[0-9a-f]{6}/gi) ?? [];
  return (
    <Svg width={14} height={14}>
      <Defs>
        <LinearGradient id={`sw-${id}`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={a} />
          <Stop offset="1" stopColor={b} />
        </LinearGradient>
      </Defs>
      <Circle cx={7} cy={7} r={6.5} fill={`url(#sw-${id})`} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
    </Svg>
  );
}

const GLASS = { backgroundColor: "rgba(24,22,20,0.62)", borderColor: "rgba(255,255,255,0.08)", borderWidth: 1 } as const;

function Pill({ active, onPress, children, label }: { active?: boolean; onPress: () => void; children: React.ReactNode; label: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      className="flex-row items-center gap-1.5 px-3 h-8 rounded-full"
      style={active ? { backgroundColor: "#2c2927" } : undefined}
    >
      {children}
    </Pressable>
  );
}

export default function ZenScreen() {
  useKeepAwake();
  const insets = useSafeAreaInsets();
  const { status, addListener } = useWs();
  const { micActive, muted, toggleMute, endSession, musicPlaying, musicTrackName, playMusic, stopMusic, nextTrack, playSound } = useVoice();
  const { startCall, messages } = useConversation();
  const { activeFocus, seconds: focusSeconds, paused: focusPaused } = useActiveFocus();
  const day = useZenWorkday();

  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const roomRef = useRef<Room | null>(null);
  const directorRef = useRef<Director | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rafRef = useRef(0);
  const sizeRef = useRef({ w: 1, h: 1 });
  const viewRef = useRef({ yaw: 0, pitch: 0, targetYaw: 0, targetPitch: 0, zoom: 1, targetZoom: 1, pinchFrom: 1 });
  const lastUtteranceRef = useRef("");
  const dayRef = useRef(day);
  const lastBlockAnnounceRef = useRef(0);
  const thinkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [glReady, setGlReady] = useState(false);
  // The 3D room couldn't start (or broke) — show a note instead of taking the app down
  const [glFailed, setGlFailed] = useState(false);
  const [theme, setTheme] = useState<RoomTheme>(savedRoom);
  const [timeMode, setTimeMode] = useState<TimeMode>(savedTime);
  const [clockTime, setClockTime] = useState<TimeOfDay>(() => timeFromClock());
  const time = timeMode === "auto" ? clockTime : timeMode;
  const [loaded, setLoaded] = useState<string | null>(null);
  const [uiVisible, setUiVisible] = useState(true);
  const [bubble, setBubble] = useState<{ text: string; id: number } | null>(null);
  const [mood, setMood] = useState<"thinking" | "sleeping" | null>(null);

  // Bubble follows Buddy's head; written from the render loop
  const bubbleX = useSharedValue(-1000);
  const bubbleY = useSharedValue(-1000);
  const bubbleW = useSharedValue(0);
  const bubbleH = useSharedValue(0);
  const bubbleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: bubbleX.value - bubbleW.value / 2 }, { translateY: bubbleY.value - bubbleH.value }],
  }));

  const say = useCallback((text: string) => setBubble({ text, id: Date.now() }), []);

  useEffect(() => {
    if (!bubble) return;
    // Long replies stay up longer so they can be read (and typed out) in full
    const t = setTimeout(() => setBubble(null), Math.max(BUBBLE_MS, bubble.text.length * 75 + 3000));
    return () => clearTimeout(t);
  }, [bubble]);

  // ── Open: swell in, start (or join) the call ─────────────────────────────
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!micActive) await startCall();
      if (!cancelled) playSound("zenSwell");
    })();
    return () => { cancelled = true; };
    // Only on open — the call outlives this screen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Renderer + loop ──────────────────────────────────────────────────────
  const reduceMotion = useReducedMotion();
  const onContextCreate = useCallback((gl: ExpoWebGLRenderingContext) => {
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = createRenderer(gl);
    } catch (err) {
      console.warn("Zen: renderer failed", err);
      setGlFailed(true);
      return;
    }
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    // Each shader check is a blocking round trip to expo-gl's GL thread — dozens
    // of them stall the first frames
    renderer.debug.checkShaderErrors = false;
    rendererRef.current = renderer;

    const camera = new THREE.PerspectiveCamera(32, gl.drawingBufferWidth / gl.drawingBufferHeight, 0.1, 100);
    cameraRef.current = camera;

    const BASE_DIR = new THREE.Vector3(4.0, 2.5, 5.4).normalize();
    const UP = new THREE.Vector3(0, 1, 0);
    const look = new THREE.Vector3();
    const offset = new THREE.Vector3();
    const headPos = new THREE.Vector3();
    const start = performance.now();
    let last = start;
    let lastMood: string | null = null;
    let push = 0;
    const frame = () => {
      rafRef.current = requestAnimationFrame(frame);
      const room = roomRef.current;
      const director = directorRef.current;
      if (!room || !director) return;
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.1);
      const t = (now - start) / 1000;
      last = now;

      // Camera: diorama 3/4 view with limited orbit
      const v = viewRef.current;
      const e = 1 - Math.exp(-dt * 4);
      v.yaw += (v.targetYaw - v.yaw) * e;
      v.pitch += (v.targetPitch - v.pitch) * e;
      v.zoom += (v.targetZoom - v.zoom) * e;
      // Portrait screens need to pull back to fit the room
      const fit = Math.max(1, 1.45 / camera.aspect);
      // Lean in while Buddy acts out a request so the screens and notes are readable
      // (skipped with Reduce Motion: no automatic zooming)
      push += ((director.busy && !reduceMotion ? 1 : 0) - push) * (1 - Math.exp(-dt * 1.5));
      const dist = 7.6 * fit * v.zoom * (1 - 0.38 * push);
      offset.copy(BASE_DIR).applyAxisAngle(UP, v.yaw);
      offset.y += v.pitch;
      offset.normalize().multiplyScalar(dist);
      // Look mostly at the room, drifting a little toward wherever Buddy is
      look.copy(room.cameraTarget).lerp(director.position, 0.25 + 0.5 * push);
      camera.position.copy(look).add(offset);
      camera.lookAt(look);

      try {
        director.update(t, dt);
        room.update(t, dt);
        renderer.render(room.scene, camera);
        gl.endFrameEXP();
      } catch (err) {
        cancelAnimationFrame(rafRef.current);
        console.warn("Zen: frame failed", err);
        setGlFailed(true);
        return;
      }

      headPos.copy(director.position).y += 0.55;
      headPos.project(camera);
      bubbleX.value = (headPos.x * 0.5 + 0.5) * sizeRef.current.w;
      bubbleY.value = (-headPos.y * 0.5 + 0.5) * sizeRef.current.h;
      if (director.mood !== lastMood) {
        lastMood = director.mood;
        setMood(director.mood);
      }
    };
    frame();
    setGlReady(true);
  }, [bubbleX, bubbleY, reduceMotion]);

  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current);
    directorRef.current?.dispose();
    directorRef.current = null;
    roomRef.current?.dispose();
    roomRef.current = null;
    rendererRef.current?.dispose();
    rendererRef.current = null;
  }, []);

  // Auto time of day follows the clock
  useEffect(() => {
    const id = setInterval(() => setClockTime(timeFromClock()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => { setPref(PREFS.zenTime, timeMode); }, [timeMode]);

  // ── Room swap (room or time of day changed) ──────────────────────────────
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!glReady || !renderer) return;
    setPref(PREFS.zenRoom, theme);
    const timer = setTimeout(() => {
      directorRef.current?.dispose();
      directorRef.current = null;
      roomRef.current?.dispose();
      roomRef.current = null;
      let room: Room;
      try {
        room = buildRoom(theme, time);
      } catch (err) {
        console.warn("Zen: room failed", err);
        setGlFailed(true);
        return;
      }
      renderer.toneMappingExposure = room.exposure;
      roomRef.current = room;
      // Before the first frame the camera is still at the origin, so fall back to the default view direction
      const faceCamera = () => {
        const cam = cameraRef.current;
        const p = directorRef.current?.position ?? room.stations.home.pos;
        return cam && cam.position.lengthSq() > 1 ? Math.atan2(cam.position.x - p.x, cam.position.z - p.z) : Math.atan2(4.0, 5.4);
      };
      directorRef.current = createDirector(room, faceCamera);
      setLoaded(`${theme}:${time}`);
    }, roomRef.current ? FADE_MS : 0);
    return () => clearTimeout(timer);
  }, [glReady, theme, time]);

  // ── Assistant replies drive the mascot ───────────────────────────────────
  const act = useCallback(async (kind: BuddyAction, speech: string) => {
    const utterance = lastUtteranceRef.current;
    const data: ActionData = {};
    if (kind === "taskCreated" || kind === "tasksListed" || kind === "taskCompleted" || kind === "progress") {
      const t = await fetchTasks();
      data.tasks = t.lines;
      data.done = t.done;
      data.pending = t.pending;
    } else if (kind === "notes") {
      data.text = (await fetchLatestNote()) || utterance.replace(/^(note|brain ?dump)[:\s-]*/i, "");
    } else if (kind === "calendar") {
      data.events = await fetchTodayEvents();
    } else if (kind === "reminderSet" || kind === "reminderFire") {
      data.text = kind === "reminderFire" ? speech : reminderText(utterance, speech);
    }
    directorRef.current?.trigger(kind, data);
  }, []);

  useEffect(() => {
    return addListener((msg) => {
      const speech = (msg.speech as string | undefined) ?? "";
      const director = directorRef.current;
      if (msg.type === "action_result" || msg.type === "not_actionable" || msg.type === "action_error" || msg.type === "error") {
        director?.setThinking(false);
        if (thinkTimerRef.current) clearTimeout(thinkTimerRef.current);
        if (speech) say(speech);
        if (msg.type === "action_result") {
          const kind = classify(msg.action as string | undefined, speech, lastUtteranceRef.current);
          if (kind) void act(kind, speech);
        }
        lastUtteranceRef.current = "";
      } else if (msg.type === "workday_block_reminder") {
        // Block reminders can land a few minutes early — announce whichever block is about to start
        if (speech) say(speech);
        const d = dayRef.current;
        const soon = d?.next && d.next.start - Date.now() < 15 * 60_000 ? d.next : null;
        lastBlockAnnounceRef.current = Date.now();
        director?.trigger("blockStart", { block: soon ?? d?.current ?? null });
      } else if (msg.type === "workday_complete") {
        if (speech) say(speech);
        director?.trigger("workdayDone");
      } else if (msg.type === "reminder") {
        if (speech) say(speech);
        void act("reminderFire", speech);
      } else if (speech && (msg.type === "pomodoro_transition" || msg.type === "pomodoro_complete")) {
        say(speech);
      }
    });
  }, [addListener, act, say]);

  // What you just said (voice or typed) — Buddy looks thoughtful until the reply
  const lastMessage = messages[messages.length - 1];
  useEffect(() => {
    if (lastMessage?.role !== "user") return;
    lastUtteranceRef.current = lastMessage.text;
    directorRef.current?.setThinking(true);
    if (thinkTimerRef.current) clearTimeout(thinkTimerRef.current);
    thinkTimerRef.current = setTimeout(() => directorRef.current?.setThinking(false), THINK_TIMEOUT_MS);
  }, [lastMessage]);

  useEffect(() => () => { if (thinkTimerRef.current) clearTimeout(thinkTimerRef.current); }, []);

  // ── Workday ──────────────────────────────────────────────────────────────
  const seenBlockRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    dayRef.current = day;
    directorRef.current?.setDay(day);
  }, [day, loaded]);

  // A block starting while Zen is open: Buddy announces it (unless the server's reminder already did)
  const currentBlockId = day?.current?.id ?? null;
  useEffect(() => {
    const prev = seenBlockRef.current;
    seenBlockRef.current = currentBlockId;
    if (prev === undefined || prev === currentBlockId || !currentBlockId) return;
    if (Date.now() - lastBlockAnnounceRef.current < 90_000) return;
    const block = dayRef.current?.current;
    if (!block) return;
    lastBlockAnnounceRef.current = Date.now();
    directorRef.current?.trigger("blockStart", { block });
    say(`Time for ${block.name} — until ${formatClock(block.end)}.`);
  }, [currentBlockId, say]);

  // Live focus timer: the tomato's label counts down, and Buddy mirrors the phase
  const phase = activeFocus ? (activeFocus.currentPhase === "WORK" ? "work" : "break") : null;
  useEffect(() => {
    directorRef.current?.setFocus(phase, focusPaused);
  }, [phase, focusPaused, loaded]);

  useEffect(() => {
    const room = roomRef.current;
    if (!room) return;
    if (!activeFocus) drawLabel(room.timer.label, "", "", "#fff");
    else drawLabel(room.timer.label, formatTime(focusSeconds), focusPaused ? "Paused" : phase === "work" ? "Focus" : "Break", phase === "work" ? "#8fe3a6" : "#9fd3ff");
  }, [activeFocus, focusSeconds, focusPaused, phase, loaded]);

  // ── Controls: fade out when idle, any touch brings them back ─────────────
  const wake = useCallback(() => {
    setUiVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setUiVisible(false), UI_IDLE_MS);
  }, []);

  useEffect(() => {
    hideTimer.current = setTimeout(() => setUiVisible(false), UI_IDLE_MS + 2000);
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, []);

  const uiStyle = useAnimatedStyle(() => ({ opacity: withTiming(uiVisible ? 1 : 0, { duration: 600 }) }), [uiVisible]);
  const fading = loaded !== `${theme}:${time}`;
  const veilStyle = useAnimatedStyle(() => ({ opacity: withTiming(fading ? 1 : 0, { duration: FADE_MS }) }), [fading]);

  // Drag to look around (limited orbit), pinch to zoom
  const onTouchStart = useCallback(() => { directorRef.current?.poke(); wake(); }, [wake]);
  const onPan = useCallback((dx: number, dy: number) => {
    const v = viewRef.current;
    v.targetYaw = Math.max(-0.6, Math.min(0.5, v.targetYaw - dx * 0.006));
    v.targetPitch = Math.max(-0.25, Math.min(0.35, v.targetPitch + dy * 0.003));
  }, []);
  const onPinchStart = useCallback(() => {
    viewRef.current.pinchFrom = viewRef.current.targetZoom;
    wake();
  }, [wake]);
  const onPinch = useCallback((scale: number) => {
    const v = viewRef.current;
    v.targetZoom = Math.max(0.6, Math.min(1.25, v.pinchFrom / scale));
  }, []);
  // The compiler lint reads the builder's callbacks as running during render;
  // gesture-handler only calls them on touch.
  /* eslint-disable react-hooks/refs */
  const gestures = useMemo(() => Gesture.Simultaneous(
    Gesture.Pan().runOnJS(true).onBegin(onTouchStart).onChange((e) => onPan(e.changeX, e.changeY)),
    Gesture.Pinch().runOnJS(true).onBegin(onPinchStart).onUpdate((e) => onPinch(e.scale)),
    Gesture.Tap().runOnJS(true).onEnd(onTouchStart),
  ), [onTouchStart, onPan, onPinchStart, onPinch]);
  /* eslint-enable react-hooks/refs */

  function onLayout(e: LayoutChangeEvent) {
    sizeRef.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height };
  }

  function handleMic() {
    directorRef.current?.poke();
    wake();
    if (micActive) toggleMute();
    else void startCall();
  }

  const fg = "#c3c8bf";
  const dim = "#8d928a";

  return (
    <View className="flex-1 bg-black" onLayout={onLayout}>
      <GestureDetector gesture={gestures}>
        <View style={{ flex: 1 }}>
          <GLView style={{ flex: 1 }} onContextCreate={onContextCreate} />
        </View>
      </GestureDetector>

      {/* Speech / thought bubble pinned above Buddy's head */}
      <Animated.View
        pointerEvents="none"
        style={[{ position: "absolute", left: 0, top: 0 }, bubbleStyle]}
        onLayout={(e) => {
          bubbleW.value = e.nativeEvent.layout.width;
          bubbleH.value = e.nativeEvent.layout.height;
        }}
      >
        <SpeechBubble text={bubble?.text ?? null} mood={mood} id={bubble?.id ?? 0} />
      </Animated.View>

      {/* Cross-fade veil while the room is rebuilt */}
      <Animated.View pointerEvents="none" style={[{ position: "absolute", inset: 0, backgroundColor: "#000" }, veilStyle]} />

      {glFailed ? (
        <View pointerEvents="none" style={{ position: "absolute", inset: 0 }} className="items-center justify-center px-10">
          <Text style={{ color: fg, fontSize: 15, fontWeight: "500", textAlign: "center" }}>{"Buddy's room couldn't load on this phone."}</Text>
          <Text style={{ color: dim, fontSize: 13, textAlign: "center", marginTop: 6 }}>You can still talk to Buddy and play music here.</Text>
        </View>
      ) : null}

      {/* Top controls — fade away when idle */}
      <Animated.View
        pointerEvents={uiVisible ? "box-none" : "none"}
        style={[{ position: "absolute", left: 0, right: 0, top: 0, paddingTop: insets.top + 8 }, uiStyle]}
      >
        <View className="flex-row items-center justify-between px-4">
          <Pressable onPress={() => router.back()} hitSlop={8} className="flex-row items-center gap-1.5 px-3.5 h-9 rounded-full" style={GLASS} accessibilityLabel="Exit Zen">
            <Icon name="x" size={14} color={fg} />
            <Text style={{ color: fg, fontSize: 12, fontWeight: "500" }}>Exit</Text>
          </Pressable>
          <View className="flex-row items-center gap-2">
            {musicPlaying ? (
              <Pressable onPress={() => { nextTrack(); wake(); }} hitSlop={6} className="w-9 h-9 rounded-full items-center justify-center" style={GLASS} accessibilityLabel="Next track">
                <Icon name="skip-forward" size={14} color={fg} />
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => { if (musicPlaying) stopMusic(); else if (micActive) playMusic(); wake(); }}
              disabled={!micActive}
              className="flex-row items-center gap-1.5 px-3.5 h-9 rounded-full"
              style={[GLASS, !micActive && { opacity: 0.5 }]}
              accessibilityLabel={musicPlaying ? "Stop music" : "Play music"}
            >
              <Icon name="music" size={14} color={musicPlaying ? "#b6cdb2" : fg} />
              <Text numberOfLines={1} style={{ color: musicPlaying ? "#b6cdb2" : fg, fontSize: 12, fontWeight: "500", maxWidth: 120 }}>
                {musicPlaying ? musicTrackName ?? "Music" : "Music"}
              </Text>
            </Pressable>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingTop: 10 }}>
          <View className="flex-row items-center rounded-full p-1" style={GLASS}>
            {ROOM_THEMES.map((r) => (
              <Pill key={r.id} label={r.label} active={theme === r.id} onPress={() => { setTheme(r.id); wake(); }}>
                <Swatch css={r.swatch} id={r.id} />
                <Text style={{ color: theme === r.id ? "#e7e1de" : dim, fontSize: 12, fontWeight: "500" }}>{r.label}</Text>
              </Pill>
            ))}
          </View>
          <View className="flex-row items-center rounded-full p-1" style={GLASS}>
            <Pill label="Match my time" active={timeMode === "auto"} onPress={() => { setTimeMode("auto"); wake(); }}>
              <Text style={{ color: timeMode === "auto" ? "#e7e1de" : dim, fontSize: 12, fontWeight: "500" }}>Auto</Text>
            </Pill>
            {TIMES_OF_DAY.map((t) => (
              <Pill key={t.id} label={t.label} active={timeMode === t.id} onPress={() => { setTimeMode(t.id); wake(); }}>
                <Icon
                  name={TIME_ICONS[t.id]}
                  size={14}
                  color={timeMode === t.id ? "#e7e1de" : timeMode === "auto" && clockTime === t.id ? "#b6cdb2" : dim}
                />
              </Pill>
            ))}
          </View>
        </ScrollView>
      </Animated.View>

      {/* Call controls */}
      <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: insets.bottom + 20 }} className="items-center gap-2">
        {micActive ? (
          <Animated.View style={uiStyle} pointerEvents={uiVisible ? "auto" : "none"} className="flex-row items-center gap-4">
            <Pressable
              onPress={handleMic}
              className="w-14 h-14 rounded-full items-center justify-center"
              style={muted ? GLASS : { backgroundColor: "#8da38a" }}
              accessibilityLabel={muted ? "Unmute" : "Mute"}
            >
              <Icon name={muted ? "mic-off" : "mic"} size={22} color={muted ? fg : "#223522"} />
            </Pressable>
            <Pressable
              onPress={() => { endSession(); wake(); }}
              className="w-14 h-14 rounded-full items-center justify-center"
              style={{ backgroundColor: "#93000a" }}
              accessibilityLabel="End call"
            >
              <Icon name="phone-off" size={20} color="#ffdad6" />
            </Pressable>
          </Animated.View>
        ) : (
          <>
            <Pressable onPress={handleMic} className="w-14 h-14 rounded-full items-center justify-center" style={GLASS} accessibilityLabel="Talk to Buddy">
              <Icon name="mic" size={22} color={fg} />
            </Pressable>
            <View className="px-3 py-1 rounded-full" style={GLASS}>
              <Text style={{ color: fg, fontSize: 11 }}>{status !== "open" ? "Connecting…" : "Tap to talk"}</Text>
            </View>
          </>
        )}
      </View>
    </View>
  );
}
