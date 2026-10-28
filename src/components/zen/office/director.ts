import * as THREE from "three";
import { BUDDY_HOVER_Y, buildBuddyRig } from "../buddy";
import { disposeObject } from "../dispose";
import { drawCalendar, drawMonitor, drawNotepad, drawSticky, drawTablet, drawWhiteboard, type DayBlock, type DayView, type TaskLine } from "./canvas";
import type { Holdable, Room, Station } from "./room";
import { arcPoint, DEFAULT_FACE } from "../cardDeck";

export type BuddyAction =
  | "taskCreated"
  | "tasksListed"
  | "taskCompleted"
  | "notes"
  | "pomodoro"
  | "pause"
  | "resume"
  | "cancel"
  | "reminderSet"
  | "reminderFire"
  | "calendar"
  | "progress"
  | "music"
  | "blockStart"
  | "workdayDone";

export interface ActionData {
  tasks?: TaskLine[];
  text?: string;
  events?: string[];
  done?: number;
  pending?: number;
  block?: DayBlock | null;
}

export type FocusPhase = "work" | "break" | null;

/** Two ways Buddy gets a focus card: flies over and takes it, or beckons and it flies over. */
export type CardFetch = "fetch" | "summon";
export type CardsState = "off" | "getting" | "holding" | "returning";

/** Mascot is drawn a bit larger than in Explore so it reads well in the room diorama. */
const SCALE = 1.15;
const HOVER = BUDDY_HOVER_Y * SCALE;

interface Pose {
  raiseL: number;
  raiseR: number;
  reachL: number;
  reachR: number;
  lean: number;
  tilt: number;
  look: number;
  lookUp: number;
  lift: number;
  mouth: number;
  eyes: "happy" | "calm" | "closed" | "wide";
}

const REST: Pose = { raiseL: 0.1, raiseR: 0.1, reachL: 0, reachR: 0, lean: 0, tilt: 0, look: 0, lookUp: 0, lift: 0, mouth: 1, eyes: "happy" };

type Script = Generator<void, void, number>;

const ease = (k: number) => k * k * (3 - 2 * k);
const angleTo = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

export function createDirector(room: Room, faceCameraYaw: () => number, opts: { reducedMotion?: boolean } = {}) {
  const rig = buildBuddyRig();
  rig.group.scale.setScalar(SCALE);
  rig.group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  room.scene.add(rig.group);

  const pos = room.stations.home.pos.clone();
  let yaw = faceCameraYaw();
  const pose: Pose = { ...REST };
  let target: Pose = { ...REST };
  let spin = 0;
  let hop = 0;

  let script: Script | null = null;
  let scriptIsIdle = false;
  const queue: (() => Script)[] = [];
  let idleTimer = 4;
  let lastIdle = "";
  let thinking = false;
  let dozing = false;
  let sinceActivity = 0;
  let focus: FocusPhase = null;
  let focusPaused = false;
  let nextBlink = 2;
  let blinkUntil = 0;
  const held = new Set<Holdable>();
  const stickies: string[] = [];
  // Workday shown on the PC whenever it isn't busy with something else.
  let day: DayView | null = null;
  let monitorBusy = false;
  let monitorTick = 0;
  const drawIdleMonitor = () => {
    if (!monitorBusy) drawMonitor(room.monitor, "idle", { day });
  };
  let lastTasks: TaskLine[] = [];

  const yawQuat = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const tmpV = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const tmpQ2 = new THREE.Quaternion();

  // Focus cards: Buddy holds a card up for the camera while the flashcards UI is open.
  let cards: CardsState = "off";
  let cardsHow: CardFetch = "fetch";
  let cardsWanted: "in" | "out" | null = null;

  // ── Pose & movement helpers ──────────────────────────────────────────────

  function setPose(p: Partial<Pose>) {
    target = { ...target, ...p };
  }

  function resetPose(p: Partial<Pose> = {}) {
    target = { ...REST, ...(focus === "work" && !focusPaused ? { eyes: "calm" as const } : {}), ...p };
  }

  /** World transform for something held at `offset` in the mascot's local frame. */
  function heldTransform(offset: THREE.Vector3, rot: THREE.Euler, outPos: THREE.Vector3, outQuat: THREE.Quaternion) {
    yawQuat.setFromAxisAngle(up, yaw);
    outPos.copy(offset).multiplyScalar(SCALE).applyQuaternion(yawQuat).add(pos);
    outQuat.copy(yawQuat).multiply(tmpQ.setFromEuler(rot));
  }

  function* wait(sec: number, each?: (k: number, t: number) => void): Script {
    let t = 0;
    while (t < sec) {
      const dt: number = yield;
      t += dt;
      each?.(Math.min(1, t / sec), t);
    }
  }

  function* turnTo(to: number, sec = 0.4): Script {
    const from = yaw;
    const d = angleTo(from, to);
    yield* wait(sec, (k) => (yaw = from + d * ease(k)));
  }

  function* flyTo(st: Station, faceCamera = false): Script {
    const from = pos.clone();
    const to = st.pos;
    const dist = from.distanceTo(to);
    if (dist > 0.05) {
      const travelYaw = Math.atan2(to.x - from.x, to.z - from.z);
      yield* turnTo(travelYaw, 0.3);
      setPose({ lean: 0.3, reachL: -0.5, reachR: -0.5 });
      yield* wait(dist / 1.4 + 0.3, (k) => {
        const e = ease(k);
        pos.lerpVectors(from, to, e);
        pos.y += Math.sin(Math.PI * e) * Math.min(0.3, dist * 0.12);
      });
      setPose({ lean: 0, reachL: 0, reachR: 0 });
    }
    yield* turnTo(faceCamera ? faceCameraYaw() : st.yaw, 0.35);
  }

  function* goHome(): Script {
    yield* flyTo(room.stations.home, true);
    resetPose();
  }

  /** Lift a desk object from its rest spot into the mascot's hands. */
  /** Lift a desk object into the mascot's hands, growing it by `scale` so it reads from the camera. */
  function* pickUp(item: Holdable, offset: THREE.Vector3, rot: THREE.Euler, sec = 0.5, scale = 1): Script {
    setPose({ reachL: 1.0, reachR: 1.0, lean: 0.25 });
    yield* wait(0.25);
    const p0 = item.obj.position.clone();
    const q0 = item.obj.quaternion.clone();
    held.add(item);
    yield* wait(sec, (k) => {
      heldTransform(offset, rot, tmpV, tmpQ);
      item.obj.position.lerpVectors(p0, tmpV, ease(k));
      item.obj.quaternion.slerpQuaternions(q0, tmpQ, ease(k));
      item.obj.scale.setScalar(1 + (scale - 1) * ease(k));
    });
    holding.set(item, { offset, rot });
    setPose({ lean: 0 });
  }

  function* putDown(item: Holdable, sec = 0.5): Script {
    holding.delete(item);
    setPose({ reachL: 1.0, reachR: 1.0, lean: 0.25 });
    const p0 = item.obj.position.clone();
    const q0 = item.obj.quaternion.clone();
    const s0 = item.obj.scale.x;
    yield* wait(sec, (k) => {
      item.obj.position.lerpVectors(p0, item.restPos, ease(k));
      item.obj.quaternion.slerpQuaternions(q0, item.restQuat, ease(k));
      item.obj.scale.setScalar(s0 + (1 - s0) * ease(k));
    });
    held.delete(item);
    setPose({ reachL: 0, reachR: 0, lean: 0 });
    yield* wait(0.2);
  }

  const holding = new Map<Holdable, { offset: THREE.Vector3; rot: THREE.Euler }>();

  function snapAllBack() {
    for (const item of held) {
      item.obj.position.copy(item.restPos);
      item.obj.quaternion.copy(item.restQuat);
      item.obj.scale.setScalar(1);
    }
    held.clear();
    holding.clear();
    rig.pen.visible = false;
    room.calendar.page.visible = false;
  }

  function* scribble(sec: number, onProgress: (k: number) => void, arm: "R" | "both" = "R"): Script {
    rig.pen.visible = true;
    yield* wait(sec, (k, t) => {
      setPose({ reachR: 1.1 + Math.sin(t * 22) * 0.12, raiseR: 0.35 + Math.sin(t * 14) * 0.15, lean: 0.15, ...(arm === "both" ? { reachL: 0.9 } : {}) });
      onProgress(k);
    });
    rig.pen.visible = false;
  }

  function* celebrate(): Script {
    setPose({ raiseL: 2.4, raiseR: 2.4, mouth: 1.4 });
    yield* wait(1, (k) => {
      spin = ease(k) * Math.PI * 2;
      hop = Math.sin(k * Math.PI) * 0.25;
    });
    spin = 0;
    hop = 0;
    setPose({ raiseL: 0.1, raiseR: 0.1, mouth: 1 });
  }

  function* wave(sec = 1.8): Script {
    yield* turnTo(faceCameraYaw(), 0.3);
    yield* wait(sec, (k, t) => setPose({ raiseR: Math.min(1, k * 5) * (1.9 + Math.sin(t * 13) * 0.35), mouth: 1.3 }));
    setPose({ raiseR: 0.1, mouth: 1 });
  }

  // ── Action scripts ───────────────────────────────────────────────────────

  // Tablet is held up beside the body (face stays visible), tilted toward the viewer.
  const TABLET_AT = new THREE.Vector3(0.27, 0.02, 0.33);
  const TABLET_ROT = new THREE.Euler(Math.PI / 2 - 0.2, -0.35, 0, "YXZ");
  const TABLET_SCALE = 1.75;
  // Small desk gadgets (timer, alarm clock) are held out front.
  const GADGET_AT = new THREE.Vector3(0.0, -0.1, 0.36);
  const GADGET_SCALE = 1.8;

  function* typeOnPC(sec: number, onProgress: (k: number) => void): Script {
    yield* flyTo(room.stations.monitor);
    yield* wait(sec, (k, t) => {
      setPose({ reachL: 1.15 + Math.sin(t * 24) * 0.1, reachR: 1.15 + Math.sin(t * 24 + 1.6) * 0.1, lean: 0.2, raiseL: 0.3, raiseR: 0.3 });
      onProgress(k);
    });
  }

  function* taskCreated(d: ActionData): Script {
    const tasks = d.tasks?.length ? d.tasks : lastTasks;
    monitorBusy = true;
    yield* typeOnPC(Math.min(4.5, 1.5 + tasks.slice(0, 6).reduce((n, t) => n + t.title.length, 0) * 0.02), (k) => drawMonitor(room.monitor, "tasks", { tasks, reveal: k }));
    yield* wait(1.2);
    yield* turnTo(faceCameraYaw(), 0.4);
    yield* wave(1.2);
    yield* goHome();
    yield* wait(1.5);
    monitorBusy = false;
    drawIdleMonitor();
  }

  function* showTablet(d: ActionData, tick: boolean): Script {
    const tasks = d.tasks?.length ? d.tasks : lastTasks;
    drawTablet(room.tablet.surface, tasks, 0, 0);
    yield* flyTo(room.stations.tablet);
    yield* pickUp(room.tablet, TABLET_AT, TABLET_ROT, 0.55, TABLET_SCALE);
    yield* flyTo(room.stations.home, true);
    setPose({ reachL: 0.7, raiseL: 0.5, reachR: 1.0, raiseR: 0.6, lean: 0.05 });
    yield* wait(1.4, (k) => drawTablet(room.tablet.surface, tasks, k, 0));
    if (tick) {
      // Tap each finished task in turn.
      const doneCount = tasks.slice(0, 5).filter((t) => t.done).length;
      const pending = tasks.map((t) => ({ ...t, done: false }));
      for (let i = 0; i < doneCount; i++) {
        yield* wait(0.45, (k) => setPose({ reachR: 1.2 + Math.sin(k * Math.PI) * 0.3 }));
        const view = pending.map((t, j) => ({ ...t, done: tasks[j].done && j <= i }));
        drawTablet(room.tablet.surface, view, 1, 0);
      }
      drawTablet(room.tablet.surface, tasks, 1, 0);
    }
    yield* wait(2.2);
    if (tick) {
      // Put the tablet down before a celebratory spin.
      yield* flyTo(room.stations.tablet);
      yield* putDown(room.tablet);
      yield* flyTo(room.stations.home, true);
      yield* celebrate();
    } else {
      yield* flyTo(room.stations.tablet);
      yield* putDown(room.tablet);
      yield* goHome();
    }
    resetPose();
  }

  function* notes(d: ActionData): Script {
    const text = d.text ?? "";
    drawNotepad(room.notepad.surface, text, 0);
    yield* flyTo(room.stations.notepad);
    yield* pickUp(room.notepad, new THREE.Vector3(-0.07, -0.08, 0.32), new THREE.Euler(Math.PI / 2 - 0.45, 0, 0.12));
    yield* flyTo(room.stations.home, true);
    yield* scribble(Math.min(6, 1.5 + text.length * 0.04), (k) => drawNotepad(room.notepad.surface, text, k));
    setPose({ reachR: 0, raiseR: 0.1, lean: 0, mouth: 1.3 });
    yield* wait(1.8);
    yield* flyTo(room.stations.notepad);
    yield* putDown(room.notepad);
    yield* goHome();
  }

  function* windTimer(): Script {
    yield* flyTo(room.stations.timer);
    yield* pickUp(room.timer, GADGET_AT, new THREE.Euler(0, 0, 0), 0.5, GADGET_SCALE);
    yield* flyTo(room.stations.home, true);
    // Wind the dial right in front of the viewer.
    setPose({ reachL: 1.0, reachR: 1.25, lean: 0.1 });
    const start = room.timer.dial.rotation.z;
    yield* wait(1.6, (k, t) => {
      room.timer.dial.rotation.z = start - ease(k) * Math.PI * 3;
      setPose({ raiseR: 0.35 + Math.sin(t * 16) * 0.2 });
    });
    setPose({ raiseR: 0.1, mouth: 1.3 });
    yield* wait(0.4, (k) => (hop = Math.sin(k * Math.PI) * 0.12));
    yield* wait(0.6);
    yield* flyTo(room.stations.timer);
    yield* putDown(room.timer);
    resetPose();
  }

  function* headphones(on: boolean): Script {
    setPose({ raiseL: 2.7, raiseR: 2.7, reachL: 0, reachR: 0 });
    yield* wait(0.45);
    rig.headphones.visible = on;
    setPose({ eyes: on ? "calm" : "happy" });
    yield* wait(0.3);
    setPose({ raiseL: 0.1, raiseR: 0.1 });
  }

  function* pomodoro(): Script {
    yield* windTimer();
    hop = 0;
    yield* headphones(true);
    // Settle in at the PC to work.
    yield* flyTo(room.stations.monitor);
  }

  function* tapTimer(): Script {
    yield* flyTo(room.stations.timer);
    yield* wait(0.5, (k) => setPose({ reachR: 1.0 + Math.sin(k * Math.PI) * 0.5, lean: 0.25 }));
    resetPose();
  }

  function* pause(): Script {
    yield* tapTimer();
    yield* headphones(false);
    yield* goHome();
  }

  function* resume(): Script {
    yield* tapTimer();
    yield* headphones(true);
    yield* flyTo(room.stations.monitor);
  }

  function* cancel(): Script {
    yield* tapTimer();
    if (rig.headphones.visible) yield* headphones(false);
    yield* flyTo(room.stations.home, true);
    setPose({ raiseL: 0.9, raiseR: 0.9, tilt: 0.2 }); // shrug
    yield* wait(1);
    resetPose();
  }

  function* reminderSet(d: ActionData): Script {
    const text = d.text ?? "Reminder";
    const { sticky } = room;
    sticky.obj.visible = true;
    drawSticky(sticky.surface, text, 0);
    yield* flyTo(room.stations.monitor);
    // Hold the note up, write it, then stick it on the monitor bezel.
    const stickyItem: Holdable = { obj: sticky.obj, restPos: sticky.restPos, restQuat: sticky.restQuat };
    held.add(stickyItem);
    holding.set(stickyItem, { offset: new THREE.Vector3(-0.08, 0.02, 0.3), rot: new THREE.Euler(-0.3, Math.PI, 0) });
    yield* scribble(Math.min(3.5, 1 + text.length * 0.04), (k) => drawSticky(sticky.surface, text, k));
    yield* putDown(stickyItem, 0.6);
    stickies.push(text);
    yield* wait(0.3, (k) => (hop = Math.sin(k * Math.PI) * 0.1));
    yield* goHome();
  }

  function* reminderFire(): Script {
    const alarm = room.alarm;
    const base = alarm.obj.rotation.z;
    let ringT = 0;
    let ringing = true;
    const heldRot = new THREE.Euler(0, 0, 0);
    let inHand = false;
    const ring = (dt: number) => {
      ringT += dt;
      const shake = ringing ? Math.sin(ringT * 60) * 0.15 : 0;
      if (inHand) heldRot.z = shake;
      else alarm.obj.rotation.z = base + shake;
    };
    // Run a step while the clock keeps rattling.
    function* ringing_(gen: Script): Script {
      gen.next(0);
      while (true) {
        const dt: number = yield;
        ring(dt);
        if (gen.next(dt).done) return;
      }
    }
    setPose({ eyes: "wide", raiseL: 1.4, raiseR: 1.4 });
    yield* ringing_(wait(0.6));
    resetPose({ eyes: "wide" });
    yield* ringing_(flyTo(room.stations.alarm));
    alarm.obj.rotation.z = base;
    inHand = true;
    yield* ringing_(pickUp(alarm, GADGET_AT, heldRot, 0.45, GADGET_SCALE));
    holding.set(alarm, { offset: GADGET_AT, rot: heldRot });
    yield* ringing_(flyTo(room.stations.home, true));
    setPose({ reachR: 1.2, reachL: 0.3, eyes: "wide" });
    yield* ringing_(wait(0.7));
    // Tap it quiet.
    yield* ringing_(wait(0.35, (k) => setPose({ reachL: 0.6 + Math.sin(k * Math.PI) * 0.7, raiseL: 0.5 })));
    ringing = false;
    heldRot.z = 0;
    setPose({ eyes: "happy", reachL: 0, raiseL: 0.1, mouth: 1.3 });
    yield* wait(1.2);
    yield* flyTo(room.stations.alarm);
    yield* putDown(alarm, 0.45);
    yield* goHome();
    yield* wave(1.2);
  }

  function* calendar(d: ActionData): Script {
    const events = d.events ?? [];
    yield* flyTo(room.stations.calendar);
    setPose({ raiseR: 2.0, reachR: 0.6, lookUp: 0.6 });
    // Flip the page over the top, revealing the current month.
    const page = room.calendar.page;
    page.visible = true;
    page.rotation.x = 0;
    yield* wait(0.8, (k) => (page.rotation.x = -ease(k) * Math.PI * 0.95));
    page.visible = false;
    yield* wait(1.2, (k) => drawCalendar(room.calendar.surface, new Date(), k, events));
    setPose({ raiseR: 0.1, reachR: 0, lookUp: 0.3 });
    yield* wait(1.6, (k, t) => setPose({ tilt: Math.sin(t * 3) * 0.08 }));
    yield* goHome();
  }

  function* progress(d: ActionData): Script {
    const done = d.done ?? 0;
    const pending = d.pending ?? 0;
    yield* flyTo(room.stations.whiteboard);
    yield* scribble(2.8, (k) => drawWhiteboard(room.whiteboard, done, pending, k, stickies), "R");
    yield* wait(0.8);
    yield* flyTo(room.stations.home, true);
    if (done >= pending) yield* celebrate();
    else {
      setPose({ raiseL: 1.8, raiseR: 1.8, mouth: 1.3 });
      yield* wait(0.9, (k) => (hop = Math.sin(k * Math.PI) * 0.12));
    }
    resetPose();
  }

  function* dance(sec: number): Script {
    yield* flyTo(room.stations.home, true);
    yield* wait(sec, (k, t) => {
      setPose({ raiseL: 1.2 + Math.sin(t * 7) * 1.0, raiseR: 1.2 + Math.sin(t * 7 + Math.PI) * 1.0, tilt: Math.sin(t * 3.5) * 0.2, mouth: 1.3 });
      hop = Math.abs(Math.sin(t * 7)) * 0.08;
    });
    hop = 0;
    resetPose();
  }

  function* blockStart(d: ActionData): Script {
    const block = d.block ?? day?.current ?? null;
    if (!block) return;
    monitorBusy = true;
    drawMonitor(room.monitor, "announce", { block });
    room.setAccent(block.color);
    yield* flyTo(room.stations.monitor);
    // Point at the screen, then turn round to share the news.
    setPose({ raiseR: 1.6, reachR: 0.9, lookUp: 0.3, mouth: 1.3 });
    yield* wait(1.8, (k, t) => setPose({ raiseR: 1.6 + Math.sin(t * 6) * 0.12 }));
    resetPose();
    yield* turnTo(faceCameraYaw(), 0.4);
    yield* wave(1.2);
    monitorBusy = false;
    drawIdleMonitor();
    yield* goHome();
  }

  function* workdayDone(): Script {
    room.setAccent(null);
    yield* flyTo(room.stations.home, true);
    yield* celebrate();
    yield* wait(0.3);
    yield* celebrate();
    yield* idleStretch();
  }

  // ── Focus cards ──────────────────────────────────────────────────────────

  // Held up in both hands in front of the body, face toward the viewer.
  const CARD_AT = new THREE.Vector3(0, 0.02, 0.36);
  const CARD_ROT = new THREE.Euler(0, 0, 0);
  const CARD_SCALE = 1.6;
  const HOLD_CARD: Partial<Pose> = { reachL: 0.95, reachR: 0.95, raiseL: 0.35, raiseR: 0.35, lean: 0.05, mouth: 1.2 };

  function deckYaw() {
    const p = room.focusCard.restPos;
    return Math.atan2(p.x - pos.x, p.z - pos.z);
  }

  /** Card hops along an arc (spinning once) between its current spot and `to`, which may move each frame. */
  function* flyCard(sec: number, to: (outPos: THREE.Vector3, outQuat: THREE.Quaternion, e: number) => void, scaleTo: number, height: number): Script {
    const card = room.focusCard.obj;
    const p0 = card.position.clone();
    const q0 = card.quaternion.clone();
    const s0 = card.scale.x;
    const end = new THREE.Vector3();
    const endQ = new THREE.Quaternion();
    yield* wait(sec, (k) => {
      const e = ease(k);
      to(end, endQ, e);
      arcPoint(p0, end, e, height, card.position);
      card.quaternion.slerpQuaternions(q0, endQ, e).multiply(tmpQ2.setFromAxisAngle(up, (1 - e) * Math.PI * 2));
      card.scale.setScalar(s0 + (scaleTo - s0) * e);
    });
  }

  function* fetchCard(): Script {
    yield* flyTo(room.stations.cards);
    yield* pickUp(room.focusCard, CARD_AT, CARD_ROT, 0.55, CARD_SCALE);
    yield* flyTo(room.stations.home, true);
  }

  function* summonCard(): Script {
    yield* flyTo(room.stations.home, true);
    yield* turnTo(deckYaw(), 0.4);
    // Beckon; the card lifts off the deck and sails across the room into Buddy's hands.
    yield* wait(0.5, (k, t) => setPose({ raiseR: 1.6 + Math.sin(t * 14) * 0.25, reachR: 0.5, mouth: 1.3 }));
    held.add(room.focusCard);
    const face = faceCameraYaw();
    const from = yaw;
    // Buddy turns back toward the viewer as the card arrives, catching it in front.
    yield* flyCard(1.5, (p, q, e) => {
      yaw = from + angleTo(from, face) * e;
      setPose({ raiseR: 1.6 * (1 - e) + 0.35 * e, reachR: 0.5 + 0.45 * e, reachL: 0.95 * e, raiseL: 0.1 + 0.25 * e });
      heldTransform(CARD_AT, CARD_ROT, p, q);
    }, CARD_SCALE, 0.6);
  }

  function* getCard(): Script {
    cards = "getting";
    room.focusDeck.setFace(DEFAULT_FACE);
    yield* cardsHow === "fetch" ? fetchCard() : summonCard();
    holding.set(room.focusCard, { offset: CARD_AT, rot: CARD_ROT });
    setPose(HOLD_CARD);
    cards = "holding";
  }

  function* returnCard(): Script {
    cards = "returning";
    setPose({ ...HOLD_CARD, mouth: 1 });
    if (cardsHow === "fetch") {
      yield* flyTo(room.stations.cards);
      yield* putDown(room.focusCard, 0.55);
    } else {
      // Toss it back: the card arcs home to the deck while Buddy waves it off.
      holding.delete(room.focusCard);
      yield* turnTo(deckYaw(), 0.35);
      setPose({ raiseR: 1.4, reachR: 0.8, reachL: 0, raiseL: 0.1 });
      yield* flyCard(1.2, (p, q) => {
        p.copy(room.focusCard.restPos);
        q.copy(room.focusCard.restQuat);
      }, 1, 0.5);
      held.delete(room.focusCard);
    }
    room.focusDeck.setFace(DEFAULT_FACE);
    yield* goHome();
    cards = "off";
  }

  // ── Idle scripts ─────────────────────────────────────────────────────────

  function* idleLookWindow(): Script {
    yield* flyTo(room.stations.window);
    yield* wait(3, (k, t) => setPose({ tilt: Math.sin(t * 1.2) * 0.12, lookUp: 0.3 }));
    yield* goHome();
  }

  function* idleSip(): Script {
    yield* flyTo(room.stations.mug);
    yield* pickUp(room.mug, new THREE.Vector3(0.18, -0.02, 0.24), new THREE.Euler(0, 0, 0), 0.45);
    yield* turnTo(faceCameraYaw(), 0.4);
    // Lift to the face and tip.
    const sip = { offset: new THREE.Vector3(0.12, 0.05, 0.28), rot: new THREE.Euler(0.7, 0, 0) };
    holding.set(room.mug, sip);
    setPose({ reachR: 1.3, raiseR: 0.6, eyes: "closed", lookUp: 0.3 });
    yield* wait(1.4);
    holding.set(room.mug, { offset: new THREE.Vector3(0.18, -0.02, 0.24), rot: new THREE.Euler(0, 0, 0) });
    setPose({ eyes: "happy", lookUp: 0, mouth: 1.3 });
    yield* wait(0.6);
    yield* turnTo(room.stations.mug.yaw, 0.4);
    yield* putDown(room.mug, 0.45);
    yield* goHome();
  }

  function* idleWater(): Script {
    yield* flyTo({ pos: new THREE.Vector3(1.7, 0.95, -1.4), yaw: Math.PI });
    yield* pickUp(room.can, new THREE.Vector3(0.22, -0.18, 0.2), new THREE.Euler(0, 0, 0), 0.5);
    yield* flyTo(room.stations.plant);
    const tilt = { offset: new THREE.Vector3(0.22, -0.1, 0.22), rot: new THREE.Euler(0, Math.PI / 2, -0.8) };
    holding.set(room.can, tilt);
    yield* wait(2.2, (k, t) => setPose({ reachR: 1.0, tilt: Math.sin(t * 2) * 0.05 }));
    holding.set(room.can, { offset: new THREE.Vector3(0.22, -0.18, 0.2), rot: new THREE.Euler(0, 0, 0) });
    yield* flyTo({ pos: new THREE.Vector3(1.7, 0.95, -1.4), yaw: Math.PI });
    yield* putDown(room.can);
    yield* goHome();
  }

  function* idleStretch(): Script {
    yield* turnTo(faceCameraYaw(), 0.3);
    setPose({ raiseL: 2.9, raiseR: 2.9, lean: -0.25, eyes: "closed", lift: 0.08 });
    yield* wait(1.4);
    resetPose();
    yield* wait(0.4);
  }

  function* idleSpin(): Script {
    yield* celebrate();
  }

  function* idlePeek(): Script {
    yield* typeOnPC(2.2, () => {});
    yield* goHome();
  }

  function* doze(): Script {
    dozing = true;
    yield* flyTo(room.stations.home, true);
    setPose({ eyes: "closed", lift: -0.12, lean: 0.12, tilt: 0.1 });
    while (dozing) yield* wait(0.5);
    setPose({ eyes: "wide" });
    yield* wait(0.3, (k) => (hop = Math.sin(k * Math.PI) * 0.12));
    resetPose();
  }

  const IDLES: [string, () => Script, number][] = [
    ["wave", () => wave(), 3],
    ["spin", idleSpin, 2],
    ["window", idleLookWindow, 2],
    ["sip", idleSip, 2],
    ["water", idleWater, 1.5],
    ["stretch", idleStretch, 2],
    ["peek", idlePeek, 1.5],
  ];

  function pickIdle(): () => Script {
    if (focus === "work" && !focusPaused) {
      // Heads-down: keep working at the PC, with the occasional sip.
      return Math.random() < 0.25 ? idleSip : () => typeOnPC(6, () => {});
    }
    const pool = IDLES.filter(([name]) => name !== lastIdle);
    let r = Math.random() * pool.reduce((n, [, , w]) => n + w, 0);
    for (const [name, fn, w] of pool) {
      r -= w;
      if (r <= 0) {
        lastIdle = name;
        return fn;
      }
    }
    return pool[0][1];
  }

  // ── Public API ───────────────────────────────────────────────────────────

  function start(fn: () => Script, idle: boolean) {
    script = fn();
    scriptIsIdle = idle;
    script.next(0);
  }

  function trigger(action: BuddyAction, data: ActionData = {}) {
    sinceActivity = 0;
    dozing = false;
    // Holding a focus card up for the camera — requests still get a spoken reply, just no acting.
    if (cards !== "off" || cardsWanted) return;
    if (data.tasks) lastTasks = data.tasks;
    const make: Record<BuddyAction, () => Script> = {
      taskCreated: () => taskCreated(data),
      tasksListed: () => showTablet(data, false),
      taskCompleted: () => showTablet(data, true),
      notes: () => notes(data),
      pomodoro,
      pause,
      resume,
      cancel,
      reminderSet: () => reminderSet(data),
      reminderFire,
      calendar: () => calendar(data),
      progress: () => progress(data),
      music: () => dance(5),
      blockStart: () => blockStart(data),
      workdayDone,
    };
    // Real requests cut idle antics short; otherwise they queue up.
    if (script && scriptIsIdle) {
      snapAllBack();
      script = null;
      resetPose();
      spin = hop = 0;
    }
    queue.push(make[action]);
    if (queue.length > 3) queue.shift();
  }

  function update(t: number, dt: number) {
    sinceActivity += dt;

    // Focus cards wait for any real request to finish, but cut idle antics short.
    if (cardsWanted && script && scriptIsIdle) {
      snapAllBack();
      script = null;
      resetPose();
      spin = hop = 0;
    }
    if (!script && cardsWanted === "in") {
      cardsWanted = null;
      start(getCard, false);
    } else if (!script && cardsWanted === "out") {
      cardsWanted = null;
      start(returnCard, false);
    }
    if (!script && queue.length && cards === "off") start(queue.shift()!, false);
    if (script) {
      // Reduced motion: the card hand-off jumps to its end state instead of flying.
      const rate = opts.reducedMotion && (cards === "getting" || cards === "returning") ? 60 : 1;
      if (script.next(dt * rate).done) {
        script = null;
        idleTimer = 3 + Math.random() * 5;
      }
    } else if (!thinking && cards === "off") {
      idleTimer -= dt;
      if (sinceActivity > 75 && !focus) start(doze, true);
      else if (idleTimer <= 0) start(pickIdle(), true);
    }

    monitorTick += dt;
    if (monitorTick > 20) {
      monitorTick = 0;
      drawIdleMonitor();
    }

    // Held objects follow the hands.
    for (const [item, h] of holding) heldTransform(h.offset, h.rot, item.obj.position, item.obj.quaternion);
    // The countdown label rides above the tomato, even when it's in Buddy's hands.
    const ts = room.timer.obj.scale.x;
    room.timer.labelSprite.position.copy(room.timer.obj.position).add(tmpV.set(0, 0.15 + 0.18 * ts, 0.03));
    room.timer.labelSprite.scale.set(0.42 * (0.7 + 0.3 * ts), 0.164 * (0.7 + 0.3 * ts), 1);

    // Thinking pose overrides the idle stance while waiting on a reply.
    const goal: Pose = thinking && (!script || scriptIsIdle)
      ? { ...target, raiseR: 1.0, reachR: 1.1, tilt: 0.18, lookUp: 0.7, eyes: "calm" }
      : target;
    const k = 1 - Math.exp(-dt * 9);
    (Object.keys(REST) as (keyof Pose)[]).forEach((key) => {
      if (key === "eyes") pose.eyes = goal.eyes;
      else (pose[key] as number) += ((goal[key] as number) - (pose[key] as number)) * k;
    });

    // Apply to the rig.
    // Slow, gentle float.
    const bob = Math.sin(t * 1.1) * 0.045 * SCALE;
    rig.group.position.set(pos.x, pos.y - HOVER + bob + hop + pose.lift, pos.z);
    rig.group.rotation.y = yaw;
    rig.body.rotation.set(pose.lean, pose.look + spin + Math.sin(t * 0.5) * 0.12 * (script ? 0 : 1), pose.tilt);
    rig.face.position.y = pose.lookUp * 0.012;
    rig.arms[0].rotation.set(-pose.reachL, 0, -pose.raiseL);
    rig.arms[1].rotation.set(-pose.reachR, 0, pose.raiseR);
    rig.ring.rotation.z += dt * (0.8 + (script ? 2 : 0));
    rig.ring.rotation.x = Math.PI / 2 + Math.sin(t * 1.3) * 0.08;
    rig.sprout.rotation.z = Math.sin(t * 1.7) * 0.12;
    rig.sideLeaf.rotation.z = 0.95 + Math.sin(t * 2.3 + 1) * 0.1;
    rig.mouth.scale.setScalar(pose.mouth);

    if (t > nextBlink) {
      blinkUntil = t + 0.13;
      nextBlink = t + 2 + Math.random() * 4;
    }
    const wide = pose.eyes === "wide";
    rig.eyes.forEach((e) => {
      e.visible = !wide;
      e.scale.y = t < blinkUntil ? 0.12 : pose.eyes === "closed" ? 0.12 : pose.eyes === "calm" ? 0.55 : 1;
    });
    rig.wideEyes.forEach((e) => (e.visible = wide));
  }

  return {
    rig,
    get position() {
      return pos;
    },
    /** Acting out a real request (not idling) — the camera leans in. */
    get busy() {
      return (!!script && !scriptIsIdle) || queue.length > 0;
    },
    /** What the UI should float above the mascot's head. */
    get mood(): "thinking" | "sleeping" | null {
      return thinking ? "thinking" : dozing ? "sleeping" : null;
    },
    trigger,
    update,
    /** Fetch or summon a focus card and hold it up for the camera. */
    startCards(how: CardFetch) {
      if (cards !== "off" || cardsWanted === "in") return;
      cardsHow = how;
      cardsWanted = "in";
      sinceActivity = 0;
      dozing = false;
    },
    /** Put the card back the same way it came. */
    endCards() {
      if (cardsWanted === "in") cardsWanted = null;
      else if (cards === "getting" || cards === "holding") cardsWanted = "out";
    },
    get cardsState(): CardsState {
      return cards;
    },
    /** Latest workday state — redraws the PC and room accent. */
    setDay(view: DayView | null) {
      const changedBlock = view?.current?.id !== day?.current?.id;
      day = view;
      drawIdleMonitor();
      if (changedBlock && !monitorBusy) room.setAccent(view?.current?.color ?? null);
    },
    setThinking(v: boolean) {
      thinking = v;
      if (v) {
        sinceActivity = 0;
        dozing = false;
      }
    },
    /** Any user interaction: resets the doze timer and wakes a sleeping mascot. */
    poke() {
      sinceActivity = 0;
      dozing = false;
    },
    setFocus(phase: FocusPhase, paused: boolean) {
      const was = focus;
      const wasPaused = focusPaused;
      focus = phase;
      focusPaused = paused;
      // Mirror timer changes made elsewhere (e.g. on the Focus page) without a voice command.
      if (was !== "work" && phase === "work" && !rig.headphones.visible && !queue.length && (!script || scriptIsIdle)) trigger("pomodoro");
      else if (was === "work" && phase === "break") {
        queue.push(function* () {
          if (rig.headphones.visible) yield* headphones(false);
          yield* goHome();
          yield* idleStretch();
        });
      } else if (was && !phase && rig.headphones.visible) {
        queue.push(function* () {
          yield* headphones(false);
          yield* goHome();
          yield* celebrate();
        });
      } else if (phase === "work" && wasPaused !== paused && !queue.length && (!script || scriptIsIdle)) {
        trigger(paused ? "pause" : "resume");
      }
    },
    dispose() {
      room.scene.remove(rig.group);
      disposeObject(rig.group);
    },
  };
}

export type Director = ReturnType<typeof createDirector>;
