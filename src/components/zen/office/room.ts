import * as THREE from "three";
import { disposeObject } from "../dispose";
import { createTextureCanvas } from "../canvas2d";
import { drawCalendar, drawLabel, drawMonitor, drawNotepad, drawSticky, drawTablet, drawWhiteboard, makeSurface, type Surface } from "./canvas";
import { createFocusDeck, type FocusDeck } from "../cardDeck";

export type RoomTheme = "home" | "loft" | "cabin";
export type TimeOfDay = "morning" | "day" | "evening" | "night";

export const ROOM_THEMES: { id: RoomTheme; label: string; swatch: string }[] = [
  { id: "home", label: "Home Office", swatch: "linear-gradient(135deg, #f3e9dc, #9fd8ad)" },
  { id: "loft", label: "Ocean Loft", swatch: "linear-gradient(135deg, #7fd6df, #f1dcae)" },
  { id: "cabin", label: "Cozy Cabin", swatch: "linear-gradient(135deg, #ff9a4a, #6e4a31)" },
];

/** Where the mascot hovers to use something: body-centre position + facing (yaw 0 = +Z). */
export interface Station {
  pos: THREE.Vector3;
  yaw: number;
}

/** A desk object the mascot can pick up and put back. */
export interface Holdable {
  obj: THREE.Object3D;
  restPos: THREE.Vector3;
  restQuat: THREE.Quaternion;
}

export interface Room {
  scene: THREE.Scene;
  exposure: number;
  background: string;
  cameraTarget: THREE.Vector3;
  stations: Record<"home" | "monitor" | "notepad" | "tablet" | "mug" | "timer" | "alarm" | "calendar" | "whiteboard" | "window" | "plant" | "cards", Station>;
  monitor: Surface;
  tablet: Holdable & { surface: Surface };
  notepad: Holdable & { surface: Surface };
  mug: Holdable;
  can: Holdable;
  sticky: { obj: THREE.Object3D; surface: Surface; restPos: THREE.Vector3; restQuat: THREE.Quaternion };
  calendar: { surface: Surface; page: THREE.Object3D };
  whiteboard: Surface;
  timer: Holdable & { dial: THREE.Object3D; label: Surface; labelSprite: THREE.Sprite };
  alarm: Holdable;
  plant: THREE.Object3D;
  /** Focus cards deck: on the bookshelf, or the mantel in the cabin. Its top card is holdable. */
  focusDeck: FocusDeck;
  focusCard: Holdable;
  /** Tints the wall LED strip to the current workday block (null = off). */
  setAccent(color: string | null): void;
  update(t: number, dt: number): void;
  dispose(): void;
}

export const TIMES_OF_DAY: { id: TimeOfDay; label: string }[] = [
  { id: "morning", label: "Morning" },
  { id: "day", label: "Day" },
  { id: "evening", label: "Evening" },
  { id: "night", label: "Night" },
];

/** The user's local time of day. */
export function timeFromClock(d = new Date()): TimeOfDay {
  const h = d.getHours();
  if (h < 5) return "night";
  if (h < 11) return "morning";
  if (h < 17) return "day";
  if (h < 20) return "evening";
  return "night";
}

interface Theme {
  wallBack: string;
  wallLeft: string;
  floor: string;
  rug: string;
  mug: string;
}

const THEMES: Record<RoomTheme, Theme> = {
  home: { wallBack: "#f3e9dc", wallLeft: "#eadccb", floor: "#c89d6e", rug: "#9fd8ad", mug: "#6fcf86" },
  loft: { wallBack: "#eaeef0", wallLeft: "#e0e6e9", floor: "#d8bb92", rug: "#7fc7c4", mug: "#f2b84b" },
  cabin: { wallBack: "#8e5f3d", wallLeft: "#835735", floor: "#6e4a31", rug: "#b65a4f", mug: "#e9e2d0" },
};

/** Lighting per time of day — the sun moves, the sky changes, lamps come on after dark. */
interface Light {
  background: string;
  exposure: number;
  hemi: [string, string, number];
  sun: [string, number];
  sunPos: [number, number, number];
  lamp: number;
  fairy: number;
  /** Window view sky gradient (top, horizon) and how dark the scenery gets. */
  sky: [string, string];
  dim: number;
}

const LIGHTS: Record<TimeOfDay, Light> = {
  morning: { background: "#ece4da", exposure: 1, hemi: ["#ffeedd", "#cbb59a", 1.0], sun: ["#ffd2a1", 1.9], sunPos: [3.4, 2.4, -3.2], lamp: 0.4, fairy: 0.3, sky: ["#9fc9ef", "#ffd9b8"], dim: 0.05 },
  day: { background: "#e6ede7", exposure: 1, hemi: ["#fff6e8", "#cdb89c", 1.1], sun: ["#fff1d6", 2.2], sunPos: [2.8, 4.5, -3.2], lamp: 0.3, fairy: 0.2, sky: ["#8cc7ef", "#dff1fb"], dim: 0 },
  evening: { background: "#2f2624", exposure: 1.1, hemi: ["#ffc79a", "#5a3d33", 0.8], sun: ["#ff9a5a", 1.6], sunPos: [3.6, 1.5, -3], lamp: 2.4, fairy: 1, sky: ["#3d4f8a", "#ff9d6b"], dim: 0.35 },
  night: { background: "#10131b", exposure: 1.15, hemi: ["#8593c4", "#2a2e3d", 0.95], sun: ["#9fb4ff", 0.7], sunPos: [2.5, 4, -3], lamp: 3.5, fairy: 1.2, sky: ["#0b1030", "#3a2d5c"], dim: 0.6 },
};

// Room is a diorama: floor 5×4 m, back wall at z = -2, left wall at x = -2.5.
const W = 5;
const D = 4;
const H = 2.6;
const DESK_Y = 0.75;

function std(color: string, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...opts });
}

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, cast = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

function cyl(rt: number, rb: number, h: number, mat: THREE.Material, x: number, y: number, z: number, seg = 24) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function texCanvas(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, repeat?: [number, number]) {
  const c = createTextureCanvas(w, h);
  draw(c.ctx);
  const tex = c.toTexture();
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(...repeat);
  }
  return tex;
}

function planks(base: string) {
  return texCanvas(512, 512, (ctx) => {
    const c = new THREE.Color(base);
    for (let i = 0; i < 8; i++) {
      const k = c.clone().offsetHSL(0, 0, (Math.sin(i * 12.9) * 0.5) * 0.06);
      ctx.fillStyle = `#${k.getHexString()}`;
      ctx.fillRect(0, i * 64, 512, 64);
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(0, i * 64, 512, 2);
      ctx.fillRect(((i * 197) % 400) + 50, i * 64, 2, 64);
    }
  }, [3, 3]);
}

function logs(base: string) {
  return texCanvas(256, 256, (ctx) => {
    const c = new THREE.Color(base);
    for (let i = 0; i < 4; i++) {
      const g = ctx.createLinearGradient(0, i * 64, 0, i * 64 + 64);
      g.addColorStop(0, `#${c.clone().offsetHSL(0, 0, -0.08).getHexString()}`);
      g.addColorStop(0.5, `#${c.clone().offsetHSL(0, 0, 0.05).getHexString()}`);
      g.addColorStop(1, `#${c.clone().offsetHSL(0, 0, -0.1).getHexString()}`);
      ctx.fillStyle = g;
      ctx.fillRect(0, i * 64, 256, 64);
    }
  }, [2, 5]);
}

/** The view through the window, drawn per theme and time of day. */
/**
 * Ocean Loft's glass wall: a panorama looking down from a high-rise at the sea
 * and the shore, with the tops of neighbouring towers below to sell the height.
 */
function beachView(time: TimeOfDay) {
  const W = 1024;
  const H = 532;
  const k = H / 448; // sizes were tuned on a 448px-tall view
  const s = makeSurface(W, H);
  const L = LIGHTS[time];
  const night = time === "night";
  const evening = time === "evening";
  const horizon = H * 0.4;
  const shoreY = H * 0.74;
  const SEA: Record<TimeOfDay, [string, string]> = {
    morning: ["#8fbfd4", "#cfeaea"],
    day: ["#2a93bd", "#83dae0"],
    evening: ["#56598a", "#e8a27f"],
    night: ["#0a1730", "#1a3358"],
  };
  const sand = night ? "#5f584a" : evening ? "#ddb48c" : "#f1dcae";
  const sun = night
    ? { x: W * 0.78, y: H * 0.1, r: 14 * k, c: "#fdf3c4" }
    : evening
      ? { x: W * 0.32, y: horizon - 16 * k, r: 22 * k, c: "#ffb36b" }
      : time === "morning"
        ? { x: W * 0.7, y: horizon - 36 * k, r: 16 * k, c: "#fff1c9" }
        : { x: W * 0.82, y: H * 0.1, r: 15 * k, c: "#fffbe6" };
  const stars = Array.from({ length: 140 }, () => ({ x: Math.random() * W, y: Math.random() * horizon * 0.9 }));
  const clouds = Array.from({ length: 7 }, (_, i) => ({ x: (i / 7) * W + Math.random() * 80, y: H * (0.08 + Math.random() * 0.18), r: (10 + Math.random() * 10) * k }));
  const palms = Array.from({ length: 11 }, (_, i) => (i + 0.5) * (W / 11) + Math.sin(i * 7) * 14);
  // Shore curves gently across the bay.
  const shore = (x: number) => shoreY - Math.sin((x / W) * Math.PI * 1.3 + 0.4) * 16 * k + (x / W) * 18 * k;
  const towers: [number, number, number][] = [
    [-10, H * 0.9, W * 0.11],
    [W * 0.14, H * 0.95, W * 0.07],
    [W * 0.62, H * 0.93, W * 0.08],
    [W * 0.84, H * 0.88, W * 0.17],
  ];

  const draw = (t: number) => {
    const { ctx } = s;
    // Sky
    let g = ctx.createLinearGradient(0, 0, 0, horizon);
    g.addColorStop(0, L.sky[0]);
    g.addColorStop(1, L.sky[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, horizon);
    if (night) {
      ctx.fillStyle = "#fff";
      for (const st of stars) ctx.fillRect(st.x, st.y, 1.5, 1.5);
    }
    ctx.fillStyle = sun.c;
    ctx.beginPath();
    ctx.arc(sun.x, sun.y, sun.r, 0, Math.PI * 2);
    ctx.fill();
    if (!night && !evening) {
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      for (const c of clouds) {
        const x = ((c.x + t * 4) % (W + 120)) - 60;
        for (const [dx, dy, m] of [[0, 0, 1], [c.r * 1.1, -c.r * 0.3, 1.25], [c.r * 2.2, 0, 0.9]]) {
          ctx.beginPath();
          ctx.arc(x + dx, c.y + dy, c.r * m, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Sea
    g = ctx.createLinearGradient(0, horizon, 0, shoreY + 20);
    g.addColorStop(0, SEA[time][0]);
    g.addColorStop(1, SEA[time][1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, horizon, W, H - horizon);
    // Swell lines, closer together near the horizon, drifting toward shore.
    ctx.strokeStyle = night ? "rgba(160,190,255,0.18)" : "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 18; i++) {
      const d = ((i + ((t * 0.08) % 1)) / 18) ** 1.7;
      const y = horizon + d * (shoreY - horizon);
      ctx.setLineDash([8 + d * 30, 14 + d * 40]);
      ctx.lineDashOffset = -t * (5 + d * 14);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // A couple of sailboats
    for (const [speed, off, by] of [[2.5, 120, horizon + 24 * k], [1.6, 600, horizon + 48 * k]]) {
      const bx = ((t * speed + off) % (W + 60)) - 30;
      const sz = by > horizon + 30 * k ? 1.3 : 1;
      ctx.fillStyle = night ? "#c9d4ea" : "#ffffff";
      ctx.beginPath();
      ctx.moveTo(bx, by - 15 * k * sz);
      ctx.lineTo(bx, by);
      ctx.lineTo(bx + 10 * k * sz, by);
      ctx.fill();
      ctx.fillStyle = night ? "#2a3550" : "#5a4a3a";
      ctx.fillRect(bx - 4 * sz, by, 16 * k * sz, 2.5 * sz);
    }

    // Beach, foam, promenade
    ctx.fillStyle = sand;
    ctx.beginPath();
    ctx.moveTo(0, shore(0));
    for (let x = 0; x <= W; x += 8) ctx.lineTo(x, shore(x));
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.fill();
    for (const [off, a] of [[0, 0.85], [-7, 0.4]] as const) {
      ctx.strokeStyle = `rgba(255,255,255,${night ? a * 0.4 : a})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 6) {
        const y = shore(x) + off + Math.sin(t * 1.4 + x * 0.04 + off) * 3;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    const promY = H * 0.88;
    ctx.fillStyle = night ? "#3a3d45" : "#b9bfc2";
    ctx.fillRect(0, promY, W, 11 * k);
    ctx.fillStyle = night ? "#23332a" : "#5f9a63";
    ctx.fillRect(0, promY + 11 * k, W, 7 * k);
    for (const px of palms) {
      ctx.strokeStyle = night ? "#2b241c" : "#7a5a3a";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(px, promY + 2);
      ctx.quadraticCurveTo(px + 5, promY - 16 * k, px + 2, promY - 30 * k);
      ctx.stroke();
      ctx.strokeStyle = night ? "#1c2f24" : "#2f7a4a";
      for (let f = 0; f < 6; f++) {
        const a = (f / 6) * Math.PI * 2 + Math.sin(t * 0.8 + px) * 0.08;
        const top = promY - 30 * k;
        ctx.beginPath();
        ctx.moveTo(px + 2, top);
        ctx.quadraticCurveTo(px + 2 + Math.cos(a) * 9 * k, top - 7 * k, px + 2 + Math.cos(a) * 15 * k, top + 2 * k + Math.abs(Math.sin(a)) * 5 * k);
        ctx.stroke();
      }
    }
    for (const [x, y, w] of towers) {
      ctx.fillStyle = night ? "#1b2232" : "#d6dde2";
      ctx.fillRect(x, y, w, H - y);
      ctx.fillStyle = night ? "#141a27" : "#bcc6cc";
      ctx.fillRect(x, y, w, 5);
    }

    // Dusk/dark over the scenery (lights and the sun path are drawn after so they glow).
    if (L.dim > 0) {
      ctx.fillStyle = `rgba(12,16,40,${L.dim * 0.75})`;
      ctx.fillRect(0, horizon, W, H - horizon);
    }
    if (night || evening || time === "morning") {
      for (let y = horizon + 2; y < shoreY - 8; y += 3) {
        const d = (y - horizon) / (shoreY - horizon);
        const flick = 0.35 + 0.65 * Math.max(0, Math.sin(t * 3 + y * 1.7));
        ctx.fillStyle = night ? `rgba(253,243,196,${0.5 * flick})` : `rgba(255,214,150,${0.7 * flick})`;
        const half = (4 + d * 26) * k;
        ctx.fillRect(sun.x - half + Math.sin(y * 3.1) * half * 0.5, y, half * (0.6 + 0.4 * Math.sin(y)), 1.6);
      }
    }
    if (night || evening) {
      ctx.fillStyle = "#ffd98a";
      for (let x = 12; x < W; x += 28) {
        ctx.beginPath();
        ctx.arc(x, promY + 1, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const [x, y, w] of towers) {
        for (let wy = y + 12; wy < H; wy += 10) {
          for (let wx = x + 5; wx < x + w - 5; wx += 8) {
            if (Math.sin(wx * 5.3 + wy * 2.7) > 0.1) ctx.fillRect(wx, wy, 3.5, 4.5);
          }
        }
      }
    }
    s.commit();
  };
  draw(0);
  return { surface: s, draw };
}

function windowView(theme: RoomTheme, time: TimeOfDay) {
  if (theme === "loft") return beachView(time);
  const s = makeSurface(256, 256);
  const L = LIGHTS[time];
  const flakes = Array.from({ length: 60 }, () => ({ x: Math.random() * 256, y: Math.random() * 256, v: 10 + Math.random() * 25 }));
  const stars = Array.from({ length: 40 }, () => ({ x: Math.random() * 256, y: Math.random() * 110 }));
  const disc = (x: number, y: number, r: number, color: string) => {
    s.ctx.fillStyle = color;
    s.ctx.beginPath();
    s.ctx.arc(x, y, r, 0, Math.PI * 2);
    s.ctx.fill();
  };
  const draw = (t: number) => {
    const { ctx } = s;
    // Sky
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, L.sky[0]);
    g.addColorStop(1, L.sky[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    if (time === "night") {
      ctx.fillStyle = "#fff";
      for (const st of stars) ctx.fillRect(st.x, st.y, 1.5, 1.5);
      disc(200, 50, 18, "#fdf3c4");
    } else if (time === "evening") {
      disc(70, 175, 30, "#ffb36b");
    } else if (time === "morning") {
      disc(55, 150, 20, "#fff1c9");
    }
    if (time === "day" || time === "morning") {
      for (const [x, y, r] of [[60, 50, 18], [80, 46, 22], [100, 52, 16], [190, 80, 14], [206, 76, 18]]) disc(((x + t * 4) % 300) - 20, y, r, "rgba(255,255,255,0.9)");
    }

    // Scenery
    if (theme === "home") {
      ctx.fillStyle = "#93cf8a";
      ctx.beginPath();
      ctx.ellipse(70, 260, 150, 80, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#7cc176";
      ctx.beginPath();
      ctx.ellipse(220, 270, 140, 90, 0, 0, Math.PI * 2);
      ctx.fill();
      for (const x of [40, 120, 200]) disc(x, 190, 22, "#4f9a5a");
    } else {
      ctx.fillStyle = "#eef3f8";
      ctx.fillRect(0, 200, 256, 56);
      ctx.fillStyle = "#2f4a3c";
      for (const [x, h] of [[30, 120], [90, 150], [160, 110], [220, 140]]) {
        ctx.beginPath();
        ctx.moveTo(x, 210 - h);
        ctx.lineTo(x - 30, 215);
        ctx.lineTo(x + 30, 215);
        ctx.fill();
      }
    }
    // Dusk / dark falls over the scenery, but not over the lights drawn next.
    if (L.dim > 0) {
      ctx.fillStyle = `rgba(12,16,40,${L.dim})`;
      ctx.fillRect(0, 120, 256, 136);
    }
    if (theme === "cabin") {
      ctx.fillStyle = "#fff";
      for (const f of flakes) {
        f.y = (f.y + f.v * 0.016) % 256;
        ctx.beginPath();
        ctx.arc((f.x + Math.sin(t + f.v) * 6 + 256) % 256, f.y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    s.commit();
  };
  draw(0);
  return { surface: s, draw };
}

export function buildRoom(themeId: RoomTheme, time: TimeOfDay): Room {
  const th = THEMES[themeId];
  const lt = LIGHTS[time];
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(lt.background);
  const surfaces: Surface[] = [];

  // ── Shell ────────────────────────────────────────────────────────────────
  const floorMat = std("#ffffff", { map: planks(th.floor), roughness: 0.75 });
  scene.add(box(W + 0.2, 0.2, D + 0.2, floorMat, 0, -0.1, 0, false));
  const backMat = themeId === "cabin" ? std("#ffffff", { map: logs(th.wallBack) }) : std(th.wallBack, { roughness: 0.95 });
  const leftMat = themeId === "cabin" ? std("#ffffff", { map: logs(th.wallLeft) }) : std(th.wallLeft, { roughness: 0.95 });
  const glassWall = themeId === "loft"; // Ocean Loft's back wall is all glass
  if (!glassWall) scene.add(box(W + 0.2, H, 0.15, backMat, 0, H / 2, -D / 2 - 0.075, false));
  scene.add(box(0.15, H, D + 0.2, leftMat, -W / 2 - 0.075, H / 2, 0, false));
  // Skirting boards
  const trim = std("#ffffff");
  if (!glassWall) scene.add(box(W, 0.08, 0.03, trim, 0, 0.04, -D / 2 + 0.015, false));
  scene.add(box(0.03, 0.08, D, trim, -W / 2 + 0.015, 0.04, 0, false));

  // Cove LED strip along the top of the walls — glows in the active block's colour.
  const stripMat = new THREE.MeshBasicMaterial({ color: "#3a3f45" });
  scene.add(box(W, 0.025, 0.025, stripMat, 0, H - 0.06, -D / 2 + 0.02, false));
  scene.add(box(0.025, 0.025, D, stripMat, -W / 2 + 0.02, H - 0.06, 0, false));
  const accentLight = new THREE.PointLight("#ffffff", 0, 6, 1.2);
  accentLight.position.set(-0.6, H - 0.3, -1.2);
  scene.add(accentLight);
  let accentTarget = 0;

  const rug = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.015, 48), std(th.rug, { roughness: 1 }));
  rug.position.set(0.1, 0.008, 0.25);
  rug.receiveShadow = true;
  scene.add(rug);

  // ── Lights ───────────────────────────────────────────────────────────────
  scene.add(new THREE.HemisphereLight(lt.hemi[0], lt.hemi[1], lt.hemi[2]));
  const sun = new THREE.DirectionalLight(lt.sun[0], lt.sun[1]);
  sun.position.set(...lt.sunPos);
  sun.target.position.set(0, 0, 0.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); // phones: half the web resolution, plenty at this size
  sun.shadow.camera.left = -4;
  sun.shadow.camera.right = 4;
  sun.shadow.camera.top = 4;
  sun.shadow.camera.bottom = -4;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  // ── Desk ─────────────────────────────────────────────────────────────────
  const wood = std(themeId === "loft" ? "#f2f0ea" : themeId === "cabin" ? "#5a3b25" : "#e9d3b4", { roughness: 0.6 });
  const deskX = 0.2;
  const deskZ = -1.6;
  scene.add(box(1.7, 0.05, 0.7, wood, deskX, DESK_Y - 0.025, deskZ));
  for (const [x, z] of [[-0.8, -0.3], [0.8, -0.3], [-0.8, 0.3], [0.8, 0.3]]) scene.add(box(0.05, DESK_Y - 0.05, 0.05, wood, deskX + x, (DESK_Y - 0.05) / 2, deskZ + z));
  scene.add(box(0.42, 0.3, 0.6, wood, deskX + 0.55, DESK_Y - 0.2, deskZ));

  // Monitor (PC)
  const dark = std("#22272b", { roughness: 0.4 });
  scene.add(cyl(0.12, 0.13, 0.02, dark, deskX, DESK_Y + 0.01, -1.82));
  scene.add(box(0.05, 0.25, 0.03, dark, deskX, DESK_Y + 0.14, -1.86));
  scene.add(box(0.8, 0.49, 0.035, dark, deskX, 1.13, -1.85));
  const monitor = makeSurface(640, 384);
  surfaces.push(monitor);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.44), new THREE.MeshBasicMaterial({ map: monitor.tex, toneMapped: false }));
  screen.position.set(deskX, 1.13, -1.85 + 0.019);
  scene.add(screen);
  drawMonitor(monitor, "idle", {});

  // Keyboard + mouse
  scene.add(box(0.46, 0.018, 0.15, std("#e9ecef", { roughness: 0.5 }), deskX, DESK_Y + 0.009, -1.47));
  scene.add(box(0.06, 0.02, 0.09, std("#e9ecef", { roughness: 0.5 }), deskX + 0.33, DESK_Y + 0.01, -1.45));

  // Notepad — a clipboard so holding it reads clearly.
  const notepadSurface = makeSurface(360, 480);
  surfaces.push(notepadSurface);
  drawNotepad(notepadSurface, "", 0);
  const notepad = new THREE.Group();
  const board = box(0.25, 0.012, 0.34, std("#a77b52"), 0, 0, 0);
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.29), std("#ffffff", { map: notepadSurface.tex, roughness: 0.9 }));
  paper.rotation.x = -Math.PI / 2;
  paper.position.set(0, 0.007, 0.015);
  const clip = box(0.09, 0.02, 0.03, std("#c0c6cc", { metalness: 0.6, roughness: 0.3 }), 0, 0.012, -0.155);
  notepad.add(board, paper, clip);
  notepad.position.set(deskX - 0.62, DESK_Y + 0.006, -1.48);
  notepad.rotation.y = 0.12;
  scene.add(notepad);

  // Tablet
  const tabletSurface = makeSurface(480, 340);
  surfaces.push(tabletSurface);
  drawTablet(tabletSurface, [], 1, 0);
  const tablet = new THREE.Group();
  tablet.add(box(0.27, 0.012, 0.2, dark, 0, 0, 0));
  const tabScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.245, 0.174), new THREE.MeshBasicMaterial({ map: tabletSurface.tex, toneMapped: false }));
  tabScreen.rotation.x = -Math.PI / 2;
  tabScreen.position.y = 0.0065;
  tablet.add(tabScreen);
  tablet.position.set(deskX + 0.58, DESK_Y + 0.006, -1.45);
  tablet.rotation.y = -0.15;
  scene.add(tablet);

  // Mug
  const mug = new THREE.Group();
  const mugMat = std(th.mug, { roughness: 0.4 });
  mug.add(cyl(0.045, 0.04, 0.1, mugMat, 0, 0.05, 0));
  const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.04, 20), std("#5a3a22"));
  coffee.rotation.x = -Math.PI / 2;
  coffee.position.y = 0.092;
  mug.add(coffee);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.008, 8, 16), mugMat);
  handle.position.set(0.05, 0.05, 0);
  mug.add(handle);
  mug.position.set(deskX - 0.8, DESK_Y, -1.75);
  scene.add(mug);

  // Tomato timer with a turnable dial and a countdown label above it.
  const timer = new THREE.Group();
  const tomato = new THREE.Mesh(new THREE.SphereGeometry(0.075, 24, 18), std("#e8513f", { roughness: 0.45 }));
  tomato.scale.y = 0.82;
  tomato.position.y = 0.062;
  tomato.castShadow = true;
  timer.add(tomato);
  for (let i = 0; i < 5; i++) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.05, 6), std("#3f9a4f"));
    leaf.position.set(Math.cos((i / 5) * Math.PI * 2) * 0.02, 0.125, Math.sin((i / 5) * Math.PI * 2) * 0.02);
    leaf.rotation.set(Math.sin((i / 5) * Math.PI * 2) * 1.2, 0, -Math.cos((i / 5) * Math.PI * 2) * 1.2);
    timer.add(leaf);
  }
  const dial = new THREE.Group();
  dial.position.set(0, 0.062, 0.07);
  const dialFace = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.012, 24), std("#fff7ee", { roughness: 0.5 }));
  dialFace.rotation.x = Math.PI / 2;
  const notch = box(0.006, 0.026, 0.006, std("#e8513f"), 0, 0.016, 0.008, false);
  dial.add(dialFace, notch);
  timer.add(dial);
  timer.position.set(deskX + 0.42, DESK_Y, -1.75);
  scene.add(timer);
  const label = makeSurface(512, 200);
  surfaces.push(label);
  drawLabel(label, "", "", "#fff");
  const labelSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: label.tex, transparent: true, depthWrite: false, toneMapped: false }));
  labelSprite.scale.set(0.42, 0.164, 1);
  labelSprite.position.set(deskX + 0.42, 1.08, -1.72);
  scene.add(labelSprite);

  // Alarm clock
  const alarm = new THREE.Group();
  const alarmMat = std("#6fb6e0", { roughness: 0.4 });
  const alarmBody = cyl(0.06, 0.06, 0.04, alarmMat, 0, 0.07, 0);
  alarmBody.rotation.x = Math.PI / 2;
  const alarmFace = new THREE.Mesh(new THREE.CircleGeometry(0.05, 24), std("#ffffff"));
  alarmFace.position.set(0, 0.07, 0.021);
  alarm.add(alarmBody, alarmFace);
  for (const s of [-1, 1]) {
    const bell = new THREE.Mesh(new THREE.SphereGeometry(0.025, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), alarmMat);
    bell.position.set(s * 0.04, 0.12, 0);
    bell.rotation.z = -s * 0.5;
    alarm.add(bell);
    alarm.add(box(0.008, 0.03, 0.008, dark, s * 0.04, 0.02, 0, false));
  }
  alarm.position.set(deskX + 0.75, DESK_Y, -1.82);
  alarm.rotation.y = -0.3;
  scene.add(alarm);

  // Desk lamp
  const lampMat = std(themeId === "home" ? "#6fcf86" : themeId === "loft" ? "#2f6f73" : "#3b3f4a", { roughness: 0.5 });
  scene.add(cyl(0.07, 0.08, 0.02, lampMat, deskX - 0.55, DESK_Y + 0.01, -1.88));
  const arm1 = cyl(0.012, 0.012, 0.42, lampMat, deskX - 0.55, DESK_Y + 0.21, -1.88, 8);
  arm1.rotation.z = 0.15;
  scene.add(arm1);
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.12, 20, 1, true), lampMat);
  shade.position.set(deskX - 0.6, DESK_Y + 0.43, -1.83);
  shade.rotation.set(0.5, 0, -0.4);
  scene.add(shade);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), new THREE.MeshBasicMaterial({ color: "#fff3cf" }));
  bulb.position.set(deskX - 0.59, DESK_Y + 0.39, -1.8);
  scene.add(bulb);
  const lampLight = new THREE.PointLight("#ffd9a0", lt.lamp, 3.5, 1.6);
  lampLight.position.copy(bulb.position);
  scene.add(lampLight);

  // Office chair, pushed aside so the mascot has the floor.
  const chairMat = std(themeId === "loft" ? "#2f6f73" : "#3d4a52", { roughness: 0.7 });
  const chair = new THREE.Group();
  chair.add(cyl(0.25, 0.25, 0.08, chairMat, 0, 0.48, 0));
  chair.add(box(0.44, 0.48, 0.07, chairMat, 0, 0.78, -0.22));
  chair.add(cyl(0.03, 0.03, 0.4, dark, 0, 0.24, 0, 8));
  chair.add(cyl(0.25, 0.25, 0.03, dark, 0, 0.04, 0, 5));
  chair.position.set(1.45, 0, -0.85);
  chair.rotation.y = -0.9;
  scene.add(chair);

  // ── Window ───────────────────────────────────────────────────────────────
  const view = windowView(themeId, time);
  surfaces.push(view.surface);
  const toneMapped = time === "day" || time === "morning";
  let winX = 1.85;
  if (glassWall) {
    // Floor-to-ceiling glass across the whole back wall, onto the ocean.
    winX = 1.8;
    const viewMesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: view.surface.tex, toneMapped }));
    viewMesh.position.set(0, H / 2, -D / 2 - 0.03);
    scene.add(viewMesh);
    // A faint sheen so it reads as glass rather than a picture.
    const sheen = new THREE.Mesh(
      new THREE.PlaneGeometry(W, H),
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: time === "night" ? 0.03 : 0.07, depthWrite: false }),
    );
    sheen.position.set(0, H / 2, -D / 2 - 0.01);
    scene.add(sheen);
    const mullion = std("#2b2f33", { roughness: 0.5, metalness: 0.3 });
    scene.add(box(W + 0.1, 0.06, 0.08, mullion, 0, H - 0.03, -D / 2 - 0.01, false));
    scene.add(box(W + 0.1, 0.05, 0.08, mullion, 0, 0.025, -D / 2 - 0.01, false));
    scene.add(box(0.06, H, 0.08, mullion, -W / 2 + 0.03, H / 2, -D / 2 - 0.01, false));
    for (const x of [-1.25, 0, 1.25]) scene.add(box(0.03, H, 0.05, mullion, x, H / 2, -D / 2 - 0.01, false));
    // Sheer curtains gathered at each end, with soft folds.
    const curtainMat = new THREE.MeshStandardMaterial({ color: "#f7f4ec", transparent: true, opacity: 0.9, side: THREE.DoubleSide, roughness: 1 });
    for (const x of [-W / 2 + 0.2, W / 2 - 0.15]) {
      const geo = new THREE.PlaneGeometry(0.24, H - 0.12, 18, 1);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 65) * 0.02);
      geo.computeVertexNormals();
      const curtain = new THREE.Mesh(geo, curtainMat);
      curtain.position.set(x, (H - 0.12) / 2 + 0.02, -D / 2 + 0.06);
      curtain.castShadow = true;
      scene.add(curtain);
    }
    scene.add(box(W, 0.025, 0.025, std("#c9c4b8", { metalness: 0.4, roughness: 0.4 }), 0, H - 0.1, -D / 2 + 0.06, false));
  } else {
    const winY = 1.5;
    const viewMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.95), new THREE.MeshBasicMaterial({ map: view.surface.tex, toneMapped }));
    viewMesh.position.set(winX, winY, -D / 2 + 0.005);
    scene.add(viewMesh);
    const frameMat = std(themeId === "cabin" ? "#4a3020" : "#ffffff", { roughness: 0.6 });
    scene.add(box(1.05, 0.05, 0.06, frameMat, winX, winY + 0.5, -D / 2 + 0.03));
    scene.add(box(1.05, 0.05, 0.06, frameMat, winX, winY - 0.5, -D / 2 + 0.03));
    scene.add(box(0.05, 1.05, 0.06, frameMat, winX - 0.5, winY, -D / 2 + 0.03));
    scene.add(box(0.05, 1.05, 0.06, frameMat, winX + 0.5, winY, -D / 2 + 0.03));
    scene.add(box(0.03, 0.95, 0.04, frameMat, winX, winY, -D / 2 + 0.03));
    scene.add(box(1.15, 0.04, 0.16, frameMat, winX, winY - 0.53, -D / 2 + 0.08));
  }

  // Floor plant + watering can
  const plant = new THREE.Group();
  plant.add(cyl(0.16, 0.12, 0.32, std(themeId === "cabin" ? "#b5683c" : "#e9e2d0", { roughness: 0.6 }), 0, 0.16, 0));
  const leafMat = std("#4fa65e", { roughness: 0.7 });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), leafMat);
    leaf.scale.set(0.45, 1.6, 0.18);
    leaf.position.set(Math.cos(a) * 0.1, 0.5 + (i % 3) * 0.1, Math.sin(a) * 0.1);
    leaf.rotation.set(Math.sin(a) * 0.5, -a, Math.cos(a) * 0.5);
    leaf.castShadow = true;
    plant.add(leaf);
  }
  plant.position.set(2.15, 0, -1.6);
  scene.add(plant);

  const can = new THREE.Group();
  const canMat = std("#7fb3d1", { roughness: 0.4, metalness: 0.2 });
  can.add(cyl(0.06, 0.07, 0.13, canMat, 0, 0.065, 0));
  const spout = cyl(0.008, 0.014, 0.16, canMat, 0.09, 0.1, 0, 8);
  spout.rotation.z = -1.0;
  can.add(spout);
  const canHandle = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 8, 16, Math.PI), canMat);
  canHandle.position.set(-0.02, 0.13, 0);
  can.add(canHandle);
  can.position.set(1.7, 0, -1.78);
  scene.add(can);

  // ── Walls: calendar, clock, whiteboard ───────────────────────────────────
  const calSurface = makeSurface(400, 480);
  surfaces.push(calSurface);
  drawCalendar(calSurface, new Date(), 0, []);
  // Wall decor hangs on mounts: the back wall normally, the side wall when the back wall is glass.
  const onWall = (mount: THREE.Group, backX: number, sideZ: number) => {
    if (glassWall) {
      mount.position.set(-W / 2, 0, sideZ);
      mount.rotation.y = Math.PI / 2;
    } else {
      mount.position.set(backX, 0, -D / 2);
    }
    scene.add(mount);
    return mount;
  };
  const calMount = onWall(new THREE.Group(), -1.45, -1.6);
  const calMat = std("#ffffff", { map: calSurface.tex, roughness: 0.9 });
  const cal = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.55), calMat);
  cal.position.set(0, 1.55, 0.006);
  calMount.add(cal);
  calMount.add(box(0.48, 0.03, 0.02, std("#3a3a3a"), 0, 1.835, 0.01, false));
  // Page that flips over the top when the mascot checks the calendar.
  const page = new THREE.Group();
  page.position.set(0, 1.825, 0.012);
  const pageMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.55), new THREE.MeshStandardMaterial({ map: calSurface.tex, side: THREE.DoubleSide, roughness: 0.9 }));
  pageMesh.position.y = -0.275;
  page.add(pageMesh);
  page.visible = false;
  calMount.add(page);

  // Clock: above the desk, or above the whiteboard in Ocean Loft.
  const clockMount = onWall(new THREE.Group(), deskX, -0.55);
  const clockY = glassWall ? 2.25 : 2.12;
  const clockFace = cyl(0.17, 0.17, 0.03, std("#ffffff", { roughness: 0.5 }), 0, clockY, 0.02);
  clockFace.rotation.x = Math.PI / 2;
  clockMount.add(clockFace);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.015, 8, 32), std("#3a3a3a"));
  rim.position.set(0, clockY, 0.035);
  clockMount.add(rim);
  const hourHand = box(0.012, 0.09, 0.006, dark, 0, 0.045, 0, false);
  const minHand = box(0.008, 0.14, 0.006, dark, 0, 0.07, 0, false);
  const hourPivot = new THREE.Group();
  const minPivot = new THREE.Group();
  hourPivot.add(hourHand);
  minPivot.add(minHand);
  hourPivot.position.set(0, clockY, 0.04);
  minPivot.position.set(0, clockY, 0.043);
  clockMount.add(hourPivot, minPivot);

  const wbSurface = makeSurface(640, 420);
  surfaces.push(wbSurface);
  drawWhiteboard(wbSurface, 0, 0, 0, []);
  scene.add(box(0.04, 0.9, 1.36, std("#c0c6cc", { metalness: 0.5, roughness: 0.35 }), -W / 2 + 0.02, 1.45, -0.55));
  const wb = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.85), std("#ffffff", { map: wbSurface.tex, roughness: 0.3 }));
  wb.rotation.y = Math.PI / 2;
  wb.position.set(-W / 2 + 0.045, 1.45, -0.55);
  scene.add(wb);
  scene.add(box(0.08, 0.025, 0.9, std("#c0c6cc", { metalness: 0.5, roughness: 0.35 }), -W / 2 + 0.06, 0.99, -0.55));

  // Sticky note (reminders) — rests on the monitor bezel once written.
  const stickySurface = makeSurface(200, 200);
  surfaces.push(stickySurface);
  drawSticky(stickySurface, "", 0);
  const sticky = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.11), std("#ffffff", { map: stickySurface.tex, roughness: 0.9, side: THREE.DoubleSide }));
  sticky.position.set(deskX - 0.34, 1.33, -1.83);
  sticky.rotation.z = 0.12;
  sticky.visible = false;
  scene.add(sticky);

  // ── Theme extras ─────────────────────────────────────────────────────────
  let fireLight: THREE.PointLight | null = null;
  const flames: THREE.Mesh[] = [];
  if (themeId === "cabin") {
    // Stone fireplace on the left wall.
    const stone = std("#7d7468", { roughness: 1 });
    scene.add(box(0.5, 1.1, 1.1, stone, -W / 2 + 0.25, 0.55, 1.0));
    scene.add(box(0.6, 0.1, 1.25, std("#5a3b25"), -W / 2 + 0.3, 1.15, 1.0));
    scene.add(box(0.2, 0.55, 0.65, std("#1a1310"), -W / 2 + 0.42, 0.35, 1.0, false));
    const flameMat = new THREE.MeshBasicMaterial({ color: "#ffb347", transparent: true, opacity: 0.9 });
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.25, 8), flameMat);
      f.position.set(-W / 2 + 0.45, 0.2, 0.8 + i * 0.13);
      flames.push(f);
      scene.add(f);
    }
    fireLight = new THREE.PointLight("#ff9a4a", 3, 4.5, 1.5);
    fireLight.position.set(-W / 2 + 0.7, 0.5, 1.0);
    scene.add(fireLight);
  } else {
    // Bookshelf.
    const shelfMat = std(themeId === "loft" ? "#f2f0ea" : "#e9d3b4", { roughness: 0.7 });
    const sx = -W / 2 + 0.2;
    const sz = 1.0;
    scene.add(box(0.36, 1.7, 0.04, shelfMat, sx, 0.85, sz - 0.5));
    scene.add(box(0.36, 1.7, 0.04, shelfMat, sx, 0.85, sz + 0.5));
    const bookColors = ["#e0685a", "#6fb6e0", "#f2b84b", "#6fcf86", "#b892e0", "#f4a6b4"];
    for (let s = 0; s < 4; s++) {
      const y = 0.05 + s * 0.42;
      scene.add(box(0.36, 0.03, 1.0, shelfMat, sx, y, sz));
      let z = sz - 0.45;
      for (let b = 0; z < sz + 0.4; b++) {
        const bw = 0.04 + ((b * 7 + s * 3) % 4) * 0.012;
        const bh = 0.24 + ((b * 5 + s) % 3) * 0.04;
        scene.add(box(0.24, bh, bw, std(bookColors[(b + s * 2) % bookColors.length], { roughness: 0.7 }), sx + 0.03, y + 0.015 + bh / 2, z + bw / 2));
        z += bw + 0.008;
      }
    }
    scene.add(box(0.36, 0.03, 1.0, shelfMat, sx, 1.7, sz));
  }
  // Focus cards live on top of the bookshelf — or on the mantel, where the cabin has its fireplace.
  const deckAt = themeId === "cabin" ? new THREE.Vector3(-W / 2 + 0.33, 1.2, 1.0) : new THREE.Vector3(-W / 2 + 0.2, 1.715, 1.0);
  const focusDeck = createFocusDeck(scene, deckAt, Math.atan2(4.0, 5.4), 1.4);
  const fairy: THREE.Mesh[] = [];

  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const rest = (o: THREE.Object3D) => ({ restPos: o.position.clone(), restQuat: o.quaternion.clone() });

  let viewTick = 0;
  return {
    scene,
    exposure: lt.exposure,
    background: lt.background,
    cameraTarget: v(-0.1, 1.0, -0.55),
    stations: {
      home: { pos: v(0.15, 1.05, 0.2), yaw: 0 },
      monitor: { pos: v(deskX, 1.1, -1.0), yaw: Math.PI },
      notepad: { pos: v(deskX - 0.62, 1.02, -1.0), yaw: Math.PI },
      tablet: { pos: v(deskX + 0.58, 1.02, -1.0), yaw: Math.PI },
      mug: { pos: v(deskX - 0.8, 1.05, -1.1), yaw: Math.PI },
      timer: { pos: v(deskX + 0.42, 1.05, -1.08), yaw: Math.PI },
      alarm: { pos: v(deskX + 0.75, 1.05, -1.12), yaw: Math.PI },
      calendar: glassWall ? { pos: v(-1.85, 1.45, -1.6), yaw: -Math.PI / 2 } : { pos: v(-1.45, 1.45, -1.25), yaw: Math.PI },
      whiteboard: { pos: v(-1.7, 1.35, -0.55), yaw: -Math.PI / 2 },
      window: { pos: v(winX, 1.45, -1.25), yaw: Math.PI },
      plant: { pos: v(1.65, 1.0, -1.1), yaw: Math.atan2(0.5, -0.5) },
      cards: { pos: v(deckAt.x + 0.55, deckAt.y - 0.1, deckAt.z), yaw: -Math.PI / 2 },
    },
    monitor,
    tablet: { obj: tablet, surface: tabletSurface, ...rest(tablet) },
    notepad: { obj: notepad, surface: notepadSurface, ...rest(notepad) },
    mug: { obj: mug, ...rest(mug) },
    can: { obj: can, ...rest(can) },
    sticky: { obj: sticky, surface: stickySurface, ...rest(sticky) },
    calendar: { surface: calSurface, page },
    whiteboard: wbSurface,
    timer: { obj: timer, dial, label, labelSprite, ...rest(timer) },
    alarm: { obj: alarm, ...rest(alarm) },
    plant,
    focusDeck,
    focusCard: { obj: focusDeck.card, restPos: focusDeck.restPos, restQuat: focusDeck.restQuat },
    setAccent(color) {
      if (color) {
        stripMat.color.set(color);
        accentLight.color.set(color);
        accentTarget = time === "day" || time === "morning" ? 0.6 : 1.1;
      } else {
        stripMat.color.set("#3a3f45");
        accentTarget = 0;
      }
    },
    update(t, dt) {
      // Breathe the accent light gently so the block colour feels alive.
      const goal = accentTarget * (0.85 + 0.15 * Math.sin(t * 0.8));
      accentLight.intensity += (goal - accentLight.intensity) * Math.min(1, dt * 2);
      const now = new Date();
      const mins = now.getMinutes() + now.getSeconds() / 60;
      minPivot.rotation.z = -(mins / 60) * Math.PI * 2;
      hourPivot.rotation.z = -(((now.getHours() % 12) + mins / 60) / 12) * Math.PI * 2;
      viewTick += dt;
      if (viewTick > 1 / 15) {
        viewTick = 0;
        view.draw(t);
      }
      if (fireLight) {
        fireLight.intensity = 2.6 + Math.sin(t * 9) * 0.3 + Math.sin(t * 23) * 0.25;
        flames.forEach((f, i) => {
          f.scale.y = 0.8 + Math.abs(Math.sin(t * (6 + i) + i)) * 0.6;
          f.position.y = 0.18 + f.scale.y * 0.06;
        });
      }
      fairy.forEach((b, i) => b.scale.setScalar(0.8 + 0.4 * Math.max(0, Math.sin(t * 2 + i * 0.7))));
      focusDeck.update(t, dt);
    },
    dispose() {
      disposeObject(scene);
      surfaces.forEach((s) => s.tex.dispose());
      focusDeck.dispose();
    },
  };
}
