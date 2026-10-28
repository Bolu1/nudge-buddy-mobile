import * as THREE from "three";
import { createTextureCanvas } from "../canvas2d";

// Canvas-backed textures for the room's "live" surfaces: the PC monitor, the
// tablet, the notepad, the wall calendar, the whiteboard and the timer label.

export interface Surface {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  tex: THREE.Texture;
  commit(): void;
}

// Phones have no <canvas>: the context is drawn with Skia (see ../canvas2d)
// and commit() copies the pixels into the texture.
export function makeSurface(w: number, h: number): Surface {
  const canvas = createTextureCanvas(w, h);
  const tex = canvas.toTexture();
  tex.anisotropy = 4;
  return { ctx: canvas.ctx, w, h, tex, commit: () => void canvas.toTexture() };
}

const UI = "system-ui, -apple-system, 'Segoe UI', sans-serif";
const HAND = "'Marker Felt', 'Comic Sans MS', 'Chalkboard SE', cursive";
const MINT = "#6fcf86";
const INK = "#24323a";

export interface TaskLine {
  title: string;
  done: boolean;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function clip(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > max) t = t.slice(0, -1);
  return t + "…";
}

// ── Monitor ─────────────────────────────────────────────────────────────────

export type MonitorMode = "idle" | "tasks" | "progress" | "sleep" | "announce";

export interface DayBlock {
  id: string;
  name: string;
  color: string;
  start: number;
  end: number;
}

/** Today's workday as the room displays it. Times are epoch ms. */
export interface DayView {
  dayStart: number;
  dayEnd: number;
  blocks: DayBlock[];
  current: DayBlock | null;
  next: DayBlock | null;
  now: number;
}

export const clockTime = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function timeLeft(ms: number) {
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 60) return `${mins}m left`;
  const h = Math.floor(mins / 60);
  return `${h}h${mins % 60 ? ` ${mins % 60}m` : ""} left`;
}

/** Thin strip of the day's blocks with a "now" marker. */
function drawTimeline(ctx: CanvasRenderingContext2D, day: DayView, x: number, y: number, w: number, h: number) {
  const span = Math.max(1, day.dayEnd - day.dayStart);
  const at = (t: number) => x + ((t - day.dayStart) / span) * w;
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  for (const b of day.blocks) {
    const bx = at(Math.max(b.start, day.dayStart));
    const bw = Math.max(2, at(Math.min(b.end, day.dayEnd)) - bx - 2);
    ctx.globalAlpha = b.end < day.now ? 0.35 : 0.95;
    ctx.fillStyle = b.color;
    roundRect(ctx, bx + 1, y, bw, h, h / 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (day.now >= day.dayStart && day.now <= day.dayEnd) {
    const nx = at(day.now);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(nx - 1.5, y - h * 0.6, 3, h * 2.2);
    ctx.beginPath();
    ctx.arc(nx, y - h * 0.6, h * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawMonitor(s: Surface, mode: MonitorMode, opts: { tasks?: TaskLine[]; reveal?: number; done?: number; pending?: number; now?: Date; day?: DayView | null; block?: DayBlock | null }) {
  const { ctx, w, h } = s;
  if (mode === "sleep") {
    ctx.fillStyle = "#0b0f12";
    ctx.fillRect(0, 0, w, h);
    s.commit();
    return;
  }
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#16302a");
  g.addColorStop(1, "#0f1c24");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  const day = opts.day;
  if (mode === "announce" && opts.block) {
    // Big "Now: …" card when a new block starts.
    const b = opts.block;
    ctx.fillStyle = b.color;
    ctx.globalAlpha = 0.25;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
    ctx.textAlign = "center";
    ctx.fillStyle = "#e7f5ec";
    ctx.font = `700 ${h * 0.08}px ${UI}`;
    ctx.fillText("NOW", w / 2, h * 0.3);
    ctx.font = `700 ${h * 0.17}px ${UI}`;
    ctx.fillText(clip(ctx, b.name, w * 0.86), w / 2, h * 0.52);
    ctx.font = `${h * 0.075}px ${UI}`;
    ctx.fillStyle = "#cfe9d7";
    ctx.fillText(`${clockTime(b.start)} – ${clockTime(b.end)}`, w / 2, h * 0.68);
  } else if (mode === "idle" && day) {
    // Today view: what block we're in, how long is left, and the shape of the day.
    const now = new Date(day.now);
    ctx.textAlign = "left";
    ctx.fillStyle = "#8fd3a0";
    ctx.font = `600 ${h * 0.065}px ${UI}`;
    ctx.fillText(now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }), w * 0.07, h * 0.14);
    ctx.textAlign = "right";
    ctx.fillStyle = "#6f9a82";
    ctx.font = `${h * 0.055}px ${UI}`;
    ctx.fillText(now.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }), w * 0.93, h * 0.14);
    ctx.textAlign = "left";
    const cur = day.current;
    if (cur) {
      ctx.fillStyle = cur.color;
      ctx.beginPath();
      ctx.arc(w * 0.085, h * 0.3, h * 0.022, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#9fb8aa";
      ctx.font = `700 ${h * 0.05}px ${UI}`;
      ctx.fillText("NOW", w * 0.12, h * 0.315);
      ctx.fillStyle = "#e7f5ec";
      ctx.font = `700 ${h * 0.13}px ${UI}`;
      ctx.fillText(clip(ctx, cur.name, w * 0.86), w * 0.07, h * 0.46);
      ctx.fillStyle = "#b6d3c2";
      ctx.font = `${h * 0.062}px ${UI}`;
      ctx.fillText(`until ${clockTime(cur.end)} · ${timeLeft(cur.end - day.now)}`, w * 0.07, h * 0.56);
      const pct = Math.min(1, Math.max(0, (day.now - cur.start) / Math.max(1, cur.end - cur.start)));
      ctx.fillStyle = "rgba(255,255,255,0.1)";
      roundRect(ctx, w * 0.07, h * 0.61, w * 0.86, h * 0.035, h * 0.018);
      ctx.fill();
      ctx.fillStyle = cur.color;
      roundRect(ctx, w * 0.07, h * 0.61, Math.max(h * 0.035, w * 0.86 * pct), h * 0.035, h * 0.018);
      ctx.fill();
    } else {
      ctx.fillStyle = "#e7f5ec";
      ctx.font = `700 ${h * 0.12}px ${UI}`;
      ctx.fillText(day.now < day.dayStart ? "Workday soon" : day.now > day.dayEnd ? "Day's done" : "Free time", w * 0.07, h * 0.43);
      if (day.next) {
        ctx.fillStyle = "#b6d3c2";
        ctx.font = `${h * 0.062}px ${UI}`;
        ctx.fillText(clip(ctx, `Next: ${day.next.name} at ${clockTime(day.next.start)}`, w * 0.86), w * 0.07, h * 0.54);
      }
    }
    drawTimeline(ctx, day, w * 0.07, h * 0.76, w * 0.86, h * 0.04);
    ctx.fillStyle = "#6f9a82";
    ctx.font = `${h * 0.045}px ${UI}`;
    ctx.fillText(clockTime(day.dayStart), w * 0.07, h * 0.9);
    ctx.textAlign = "right";
    ctx.fillText(clockTime(day.dayEnd), w * 0.93, h * 0.9);
  } else if (mode === "idle") {
    const now = opts.now ?? new Date();
    ctx.fillStyle = "#e7f5ec";
    ctx.textAlign = "center";
    ctx.font = `600 ${h * 0.24}px ${UI}`;
    ctx.fillText(now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), w / 2, h * 0.52);
    ctx.font = `${h * 0.07}px ${UI}`;
    ctx.fillStyle = "#8fd3a0";
    ctx.fillText(now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }), w / 2, h * 0.66);
    ctx.font = `600 ${h * 0.06}px ${UI}`;
    ctx.fillStyle = "#4f7d66";
    ctx.fillText("nudge buddy", w / 2, h * 0.88);
  } else if (mode === "tasks") {
    // A to-do app being typed into, line by line.
    const tasks = opts.tasks ?? [];
    const reveal = opts.reveal ?? 1;
    ctx.textAlign = "left";
    ctx.fillStyle = MINT;
    ctx.font = `700 ${h * 0.085}px ${UI}`;
    ctx.fillText("Tasks", w * 0.07, h * 0.16);
    const rowH = h * 0.13;
    const shown = tasks.slice(0, 6);
    const chars = Math.floor(reveal * shown.reduce((n, t) => n + t.title.length + 4, 0));
    let used = 0;
    shown.forEach((t, i) => {
      const y = h * 0.28 + i * rowH;
      const budget = chars - used;
      used += t.title.length + 4;
      if (budget <= 0) return;
      ctx.strokeStyle = t.done ? MINT : "#7fa792";
      ctx.lineWidth = 3;
      roundRect(ctx, w * 0.07, y - rowH * 0.42, rowH * 0.55, rowH * 0.55, 6);
      ctx.stroke();
      if (t.done) {
        ctx.beginPath();
        ctx.moveTo(w * 0.07 + rowH * 0.12, y - rowH * 0.15);
        ctx.lineTo(w * 0.07 + rowH * 0.25, y - rowH * 0.02);
        ctx.lineTo(w * 0.07 + rowH * 0.45, y - rowH * 0.32);
        ctx.stroke();
      }
      ctx.fillStyle = t.done ? "#7fa792" : "#e7f5ec";
      ctx.font = `${h * 0.07}px ${UI}`;
      const text = clip(ctx, t.title, w * 0.78).slice(0, Math.max(0, budget));
      ctx.fillText(text, w * 0.07 + rowH * 0.8, y);
    });
    if (reveal < 1 && Math.floor(Date.now() / 400) % 2) {
      ctx.fillStyle = MINT;
      ctx.fillRect(w * 0.9, h * 0.88, w * 0.02, h * 0.06);
    }
  } else if (mode === "progress") {
    drawChart(ctx, w, h, opts.done ?? 0, opts.pending ?? 0, opts.reveal ?? 1, "#e7f5ec", "#8fd3a0");
  }
  s.commit();
}

function drawChart(ctx: CanvasRenderingContext2D, w: number, h: number, done: number, pending: number, reveal: number, ink: string, accent: string, hand = false) {
  const font = hand ? HAND : UI;
  ctx.textAlign = "left";
  ctx.fillStyle = ink;
  ctx.font = `700 ${h * 0.09}px ${font}`;
  ctx.fillText("Progress", w * 0.07, h * 0.15);
  const total = Math.max(1, done + pending);
  const pct = done / total;
  // Donut
  const cx = w * 0.3;
  const cy = h * 0.58;
  const r = Math.min(w, h) * 0.24;
  ctx.lineWidth = r * 0.32;
  ctx.lineCap = "round";
  ctx.strokeStyle = hand ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.12)";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = accent;
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct * reveal);
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.textAlign = "center";
  ctx.font = `700 ${r * 0.5}px ${font}`;
  ctx.fillText(`${Math.round(pct * 100 * reveal)}%`, cx, cy + r * 0.18);
  // Bars
  ctx.textAlign = "left";
  const bx = w * 0.58;
  const bw = w * 0.32;
  const rows: [string, number, string][] = [
    ["Done", done, accent],
    ["To do", pending, hand ? "#e0904f" : "#f2b84b"],
  ];
  rows.forEach(([label, n, color], i) => {
    const y = h * 0.42 + i * h * 0.22;
    ctx.fillStyle = ink;
    ctx.font = `${h * 0.065}px ${font}`;
    ctx.fillText(`${label}  ${n}`, bx, y);
    ctx.fillStyle = hand ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.1)";
    roundRect(ctx, bx, y + h * 0.03, bw, h * 0.06, h * 0.03);
    ctx.fill();
    ctx.fillStyle = color;
    roundRect(ctx, bx, y + h * 0.03, Math.max(h * 0.06, bw * (n / total) * reveal), h * 0.06, h * 0.03);
    ctx.fill();
  });
}

// ── Tablet (task checklist) ─────────────────────────────────────────────────

export function drawTablet(s: Surface, tasks: TaskLine[], reveal: number, ticks: number) {
  const { ctx, w, h } = s;
  ctx.fillStyle = "#f7faf8";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = MINT;
  ctx.fillRect(0, 0, w, h * 0.2);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.font = `700 ${h * 0.12}px ${UI}`;
  ctx.fillText("My tasks", w * 0.06, h * 0.145);
  const list = tasks.length ? tasks.slice(0, 4) : [{ title: "Nothing yet — add a task!", done: false }];
  const rowH = h * 0.195;
  list.forEach((t, i) => {
    const appear = Math.min(1, Math.max(0, reveal * list.length - i));
    if (appear <= 0) return;
    ctx.globalAlpha = appear;
    const y = h * 0.36 + i * rowH;
    const ticked = t.done || i < ticks;
    ctx.strokeStyle = ticked ? MINT : "#b7c6bd";
    ctx.lineWidth = 4;
    roundRect(ctx, w * 0.06, y - rowH * 0.32, rowH * 0.5, rowH * 0.5, 8);
    ctx.stroke();
    if (ticked) {
      ctx.fillStyle = MINT;
      roundRect(ctx, w * 0.06, y - rowH * 0.32, rowH * 0.5, rowH * 0.5, 8);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.beginPath();
      ctx.moveTo(w * 0.06 + rowH * 0.12, y - rowH * 0.08);
      ctx.lineTo(w * 0.06 + rowH * 0.22, y + rowH * 0.04);
      ctx.lineTo(w * 0.06 + rowH * 0.4, y - rowH * 0.2);
      ctx.stroke();
    }
    ctx.fillStyle = ticked ? "#9aaba1" : INK;
    ctx.font = `600 ${h * 0.1}px ${UI}`;
    ctx.fillText(clip(ctx, t.title, w * 0.76), w * 0.06 + rowH * 0.7, y + rowH * 0.06);
    ctx.globalAlpha = 1;
  });
  s.commit();
}

// ── Notepad (brain dump, handwritten) ───────────────────────────────────────

export function wrapLines(ctx: CanvasRenderingContext2D, text: string, max: number, font: string) {
  ctx.font = font;
  const out: string[] = [];
  for (const para of text.split(/\n+/)) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > max && line) {
        out.push(line);
        line = word;
      } else line = next;
    }
    if (line) out.push(line);
  }
  return out;
}

export function drawNotepad(s: Surface, text: string, reveal: number) {
  const { ctx, w, h } = s;
  ctx.fillStyle = "#fffbe8";
  ctx.fillRect(0, 0, w, h);
  // Ruled lines + margin
  ctx.strokeStyle = "#cfe0f2";
  ctx.lineWidth = 2;
  const gap = h * 0.075;
  for (let y = h * 0.16; y < h; y += gap) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.strokeStyle = "#f1a9a9";
  ctx.beginPath();
  ctx.moveTo(w * 0.12, 0);
  ctx.lineTo(w * 0.12, h);
  ctx.stroke();
  // Binding holes
  ctx.fillStyle = "#e9e1c8";
  for (let x = w * 0.15; x < w; x += w * 0.12) {
    ctx.beginPath();
    ctx.arc(x, h * 0.04, w * 0.018, 0, Math.PI * 2);
    ctx.fill();
  }
  const font = `${h * 0.052}px ${HAND}`;
  const lines = wrapLines(ctx, text || "Brain dump…", w * 0.8, font);
  ctx.fillStyle = "#2c4a7a";
  ctx.textAlign = "left";
  ctx.font = font;
  let budget = Math.floor(reveal * lines.reduce((n, l) => n + l.length, 0));
  lines.slice(0, 11).forEach((line, i) => {
    if (budget <= 0) return;
    ctx.fillText(line.slice(0, budget), w * 0.15, h * 0.16 + gap * i - gap * 0.18);
    budget -= line.length;
  });
  s.commit();
}

// ── Wall calendar ───────────────────────────────────────────────────────────

export function drawCalendar(s: Surface, date: Date, highlight: number, events: string[]) {
  const { ctx, w, h } = s;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#e0685a";
  ctx.fillRect(0, 0, w, h * 0.2);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.font = `700 ${h * 0.09}px ${UI}`;
  ctx.fillText(date.toLocaleDateString([], { month: "long", year: "numeric" }), w / 2, h * 0.135);

  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const days = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const cw = w / 7;
  const top = h * 0.3;
  const ch = (h * (events.length ? 0.5 : 0.66)) / 6;
  ctx.font = `600 ${h * 0.04}px ${UI}`;
  ctx.fillStyle = "#9aa5ab";
  "SMTWTFS".split("").forEach((d, i) => ctx.fillText(d, cw * (i + 0.5), h * 0.26));
  ctx.font = `${Math.min(ch * 0.55, h * 0.05)}px ${UI}`;
  for (let d = 1; d <= days; d++) {
    const idx = first.getDay() + d - 1;
    const x = cw * ((idx % 7) + 0.5);
    const y = top + ch * Math.floor(idx / 7) + ch * 0.6;
    if (d === date.getDate()) {
      ctx.strokeStyle = "#e0685a";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(x, y - ch * 0.18, ch * 0.48 * (0.6 + 0.4 * highlight), 0, Math.PI * 2 * highlight);
      ctx.stroke();
    }
    ctx.fillStyle = d === date.getDate() ? "#e0685a" : INK;
    ctx.fillText(String(d), x, y);
  }
  if (events.length) {
    ctx.textAlign = "left";
    ctx.fillStyle = INK;
    ctx.font = `600 ${h * 0.042}px ${UI}`;
    ctx.fillText("Today", w * 0.07, h * 0.86);
    ctx.font = `${h * 0.038}px ${UI}`;
    events.slice(0, 2).forEach((e, i) => ctx.fillText(clip(ctx, `• ${e}`, w * 0.86), w * 0.07, h * 0.92 + i * h * 0.05));
  }
  s.commit();
}

// ── Whiteboard (progress, marker-drawn) ─────────────────────────────────────

export function drawWhiteboard(s: Surface, done: number, pending: number, reveal: number, stickies: string[]) {
  const { ctx, w, h } = s;
  ctx.fillStyle = "#fbfcfc";
  ctx.fillRect(0, 0, w, h);
  if (reveal > 0) {
    drawChart(ctx, w * 0.72, h, done, pending, reveal, "#2b3a55", "#3fae6a", true);
  } else {
    ctx.fillStyle = "#2b3a55";
    ctx.textAlign = "left";
    ctx.font = `700 ${h * 0.09}px ${HAND}`;
    ctx.fillText("Today's focus ✦", w * 0.06, h * 0.16);
    ctx.font = `${h * 0.065}px ${HAND}`;
    ["one thing at a time", "drink water", "small steps count"].forEach((t, i) => ctx.fillText(`· ${t}`, w * 0.08, h * 0.32 + i * h * 0.12));
  }
  // Sticky notes column on the right.
  const colors = ["#ffe58a", "#ffc6d9", "#bfe8ff", "#c9f2c4"];
  stickies.slice(-3).forEach((t, i) => {
    const x = w * 0.76;
    const y = h * 0.08 + i * h * 0.3;
    ctx.save();
    ctx.translate(x + w * 0.1, y + h * 0.12);
    ctx.rotate((i % 2 ? 1 : -1) * 0.05);
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(-w * 0.1, -h * 0.12, w * 0.2, h * 0.25);
    ctx.fillStyle = "#3a3a3a";
    ctx.font = `${h * 0.045}px ${HAND}`;
    ctx.textAlign = "left";
    wrapLines(ctx, t, w * 0.17, ctx.font).slice(0, 3).forEach((l, j) => ctx.fillText(l, -w * 0.085, -h * 0.05 + j * h * 0.06));
    ctx.restore();
  });
  s.commit();
}

// ── Sticky note & timer label ───────────────────────────────────────────────

export function drawSticky(s: Surface, text: string, reveal: number) {
  const { ctx, w, h } = s;
  ctx.fillStyle = "#ffe58a";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "rgba(0,0,0,0.06)";
  ctx.fillRect(0, 0, w, h * 0.14);
  ctx.fillStyle = "#3a3a3a";
  ctx.textAlign = "left";
  const font = `${h * 0.13}px ${HAND}`;
  let budget = Math.floor(reveal * text.length);
  wrapLines(ctx, text, w * 0.84, font).slice(0, 5).forEach((l, i) => {
    if (budget <= 0) return;
    ctx.fillText(l.slice(0, budget), w * 0.08, h * 0.32 + i * h * 0.15);
    budget -= l.length;
  });
  s.commit();
}

export function drawLabel(s: Surface, text: string, sub: string, color: string) {
  const { ctx, w, h } = s;
  ctx.clearRect(0, 0, w, h);
  if (!text) {
    s.commit();
    return;
  }
  ctx.fillStyle = "rgba(20,26,24,0.82)";
  roundRect(ctx, 4, 4, w - 8, h - 8, h * 0.3);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.font = `700 ${h * 0.42}px ${UI}`;
  ctx.fillText(text, w / 2, h * (sub ? 0.52 : 0.64));
  if (sub) {
    ctx.fillStyle = "#c3d6cb";
    ctx.font = `${h * 0.2}px ${UI}`;
    ctx.fillText(sub, w / 2, h * 0.8);
  }
  s.commit();
}
