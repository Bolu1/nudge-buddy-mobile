/*
 * UI-thread port of the geometry the web app's orb uses, from thinking-orbs
 * 0.3.2 (https://libraries.dev/orbs) — MIT License, Copyright (c) 2026 Jakub
 * Antalik. Only the three modes the voice states use (orbits, wave,
 * ribbon/ring) are ported; the math is unchanged, each function is marked as
 * a worklet so a frame is computed on the UI thread, never competing with the
 * voice pipeline on the JS thread. Presets/option scaling still come from the
 * package itself (thinking-orbs/engine) on the JS thread.
 */

export type Dot = { x: number; y: number; z: number; r: number; white: number; a?: number };
export type OrbMode = "orbits" | "wave" | "ribbon" | "ring";
export type ModeOpts = Record<string, number | undefined>;

function hashD(a: number, b: number): number {
  "worklet";
  const h = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return h - Math.floor(h);
}

function fibDir(i: number, n: number): [number, number, number] {
  "worklet";
  const golden = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (2 * (i + 0.5)) / n;
  const rad = Math.sqrt(1 - y * y);
  const a = i * golden;
  return [rad * Math.cos(a), y, rad * Math.sin(a)];
}

/** Shared spin + tilt + orthographic projection, as plain numbers (no closure) */
function project(
  x: number, y: number, z: number,
  sy: number, cyw: number, st: number, ct: number, cx: number, cy: number,
): [number, number, number] {
  "worklet";
  const x1 = x * cyw + z * sy;
  const z1 = -x * sy + z * cyw;
  const y1 = y * ct - z1 * st;
  const z2 = y * st + z1 * ct;
  return [cx + x1, cy - y1, z2];
}

function radiusScale(size: number, pow: number): number {
  "worklet";
  return Math.pow(size / 300, pow);
}

/** Drop invisible marks, clamp radii, z-sort far→near into draw order */
function finalize(dots: Dot[], rMin = 0.3): Dot[] {
  "worklet";
  const visible: Dot[] = [];
  for (let i = 0; i < dots.length; i++) {
    const d = dots[i];
    if ((d.a ?? 1) < 0.02) continue;
    d.r = Math.max(rMin, d.r);
    visible.push(d);
  }
  visible.sort((p, q) => p.z - q.z);
  return visible;
}

function frameWave(size: number, t: number, o: ModeOpts): Dot[] {
  "worklet";
  const cx = size / 2;
  const cy = size / 2;
  const R = (size / 2) * 0.874;
  const yaw = t * 0.18, tilt = 0.38;
  const sy = Math.sin(yaw), cyw = Math.cos(yaw), st = Math.sin(tilt), ct = Math.cos(tilt);
  const rs = radiusScale(size, o.rsPow ?? 0.6);
  const dots: Dot[] = [];
  const rings = o.rings ?? 15;
  const lonDensity = o.lonDensity ?? 40;
  for (let ri = 0; ri <= rings; ri++) {
    const lat = -Math.PI / 2 + (ri / rings) * Math.PI;
    const cosLat = Math.cos(lat);
    const sinLat = Math.sin(lat);
    const w = 0.62 * Math.sin(t * 2.1 - ri * 0.52) + 0.38 * Math.sin(t * 1.27 + ri * 0.83);
    const rr = R * (0.88 + 0.105 * w);
    const lonCount = Math.max(1, Math.round(Math.abs(cosLat) * lonDensity));
    for (let lj = 0; lj < lonCount; lj++) {
      const lon = (lj / lonCount) * 2 * Math.PI;
      const p = project(cosLat * Math.cos(lon) * rr, sinLat * rr, cosLat * Math.sin(lon) * rr, sy, cyw, st, ct, cx, cy);
      const depth = (p[2] / R + 1) / 2;
      const crest = Math.max(0, w);
      dots.push({
        x: p[0],
        y: p[1],
        z: p[2],
        r: ((o.rBase ?? 0.6) + (o.rDepth ?? 1.7) * depth) * (1 + 0.4 * crest) * rs,
        white: 0.66 - 0.56 * depth - 0.1 * crest,
      });
    }
  }
  return finalize(dots, o.rMin);
}

function frameOrbits(size: number, t: number, o: ModeOpts): Dot[] {
  "worklet";
  const cx = size / 2;
  const cy = size / 2;
  const R = (size / 2) * 0.82;
  const yaw = t * 0.12, tilt = 0.3;
  const sy = Math.sin(yaw), cyw = Math.cos(yaw), st = Math.sin(tilt), ct = Math.cos(tilt);
  const rs = radiusScale(size, o.rsPow ?? 0.6);
  const dots: Dot[] = [];
  const orbitN = o.orbitN ?? 12;
  const ghostN = o.ghostN ?? 40;
  const particles = o.particles ?? 3;
  for (let orb = 0; orb < orbitN; orb++) {
    const h1 = hashD(orb, 1.7);
    const h2 = hashD(orb, 5.2);
    const h3 = hashD(orb, 8.9);
    const ro = R * (0.45 + 0.52 * h1);
    const th = h1 * 2 * Math.PI;
    const phi = Math.acos(2 * h2 - 1);
    const nx = Math.sin(phi) * Math.cos(th);
    const ny = Math.cos(phi);
    const nz = Math.sin(phi) * Math.sin(th);
    let ux = -ny;
    let uy = nx;
    const uz = 0;
    const ul = Math.max(1e-6, Math.sqrt(ux * ux + uy * uy));
    ux /= ul;
    uy /= ul;
    const vx = ny * uz - nz * uy;
    const vy = nz * ux - nx * uz;
    const vz = nx * uy - ny * ux;
    const speed = (0.25 + 0.55 * h3) * (h3 > 0.5 ? 1 : -1);
    for (let k = 0; k < ghostN; k++) {
      const a = (k / ghostN) * 2 * Math.PI;
      const p = project(
        (ux * Math.cos(a) + vx * Math.sin(a)) * ro,
        (uy * Math.cos(a) + vy * Math.sin(a)) * ro,
        (uz * Math.cos(a) + vz * Math.sin(a)) * ro,
        sy, cyw, st, ct, cx, cy,
      );
      const depth = (p[2] / ro + 1) / 2;
      dots.push({ x: p[0], y: p[1], z: p[2], r: (o.ghostR ?? 0.9) * rs, white: 0.72, a: (o.ghostA ?? 0.5) * (0.4 + 0.6 * depth) });
    }
    for (let m = 0; m < particles; m++) {
      const a = t * speed + (m / particles) * 2 * Math.PI + h2 * 6;
      const p = project(
        (ux * Math.cos(a) + vx * Math.sin(a)) * ro,
        (uy * Math.cos(a) + vy * Math.sin(a)) * ro,
        (uz * Math.cos(a) + vz * Math.sin(a)) * ro,
        sy, cyw, st, ct, cx, cy,
      );
      const depth = (p[2] / ro + 1) / 2;
      dots.push({
        x: p[0],
        y: p[1],
        z: p[2],
        r: ((o.partR ?? 1.2) + (o.partRDepth ?? 1.6) * depth) * rs,
        white: 0.3 - 0.22 * depth,
      });
    }
  }
  return finalize(dots, o.rMin);
}

function frameRibbon(size: number, t: number, o: ModeOpts): Dot[] {
  "worklet";
  const cx = size / 2;
  const cy = size / 2;
  const R = (size / 2) * 0.78;
  const spin = o.spin ?? 1;
  const camTilt = 0.3;
  const yaw = t * 0.1 * spin;
  const sy = Math.sin(yaw), cyw = Math.cos(yaw), st = Math.sin(camTilt), ct = Math.cos(camTilt);
  const rs = radiusScale(size, o.rsPow ?? 0.6);
  const dots: Dot[] = [];
  const ghostN = o.ghostN ?? 150;
  for (let i = 0; i < ghostN; i++) {
    const d = fibDir(i, ghostN);
    const p = project(d[0] * R, d[1] * R, d[2] * R, sy, cyw, st, ct, cx, cy);
    const depth = (p[2] / R + 1) / 2;
    dots.push({ x: p[0], y: p[1], z: p[2], r: 0.8 * rs, white: 0.78, a: 0.1 + 0.22 * depth });
  }
  const ya = t * 0.24 * spin;
  const ta = o.faceOn ? -camTilt : 0.55 + 0.3 * Math.sin(t * 0.18) * spin;
  const ux = Math.cos(ya);
  const uy = 0;
  const uz = Math.sin(ya);
  const vx = -uz * Math.sin(ta);
  const vy = Math.cos(ta);
  const vz = ux * Math.sin(ta);
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const wobAmp = 0.23 * (o.wobMul ?? 1);
  const baseR = o.faceOn ? R / (1 + 0.85 * wobAmp) : R;
  const baseLanes = o.lanes ?? 5;
  const segs = o.segs ?? 88;
  const lanes = Math.max(1, Math.round(baseLanes * (o.bandMul ?? 1)));
  for (let w = 0; w < lanes; w++) {
    const laneOff = (w - (lanes - 1) / 2) * 0.075;
    const edge = Math.abs(w - (lanes - 1) / 2) / Math.max(1, (lanes - 1) / 2);
    for (let k = 0; k < segs; k++) {
      const a = (k / segs) * 2 * Math.PI;
      const wob = (0.16 * Math.sin(a * 3 - t * 1.7 + w * 0.22) + 0.07 * Math.sin(a * 5 + t * 1.1)) * (o.wobMul ?? 1);
      const radial = o.faceOn ? 1 + wob : 1;
      const off = o.faceOn ? laneOff : laneOff + wob;
      const x = ux * Math.cos(a) + vx * Math.sin(a) + nx * off;
      const y = uy * Math.cos(a) + vy * Math.sin(a) + ny * off;
      const z = uz * Math.cos(a) + vz * Math.sin(a) + nz * off;
      const l = Math.sqrt(x * x + y * y + z * z);
      const rr = baseR * radial;
      const p = project((x / l) * rr, (y / l) * rr, (z / l) * rr, sy, cyw, st, ct, cx, cy);
      const depth = (p[2] / R + 1) / 2;
      dots.push({
        x: p[0],
        y: p[1],
        z: p[2],
        r: ((o.rBase ?? 1.1) + (o.rDepth ?? 1.7) * depth) * (1 - 0.25 * edge) * rs,
        white: 0.52 - 0.44 * depth + 0.18 * edge,
        a: 0.4 + 0.6 * depth,
      });
    }
  }
  return finalize(dots, o.rMin);
}

/** One frame of `mode` at time `t` (seconds × speed), already in draw order */
export function orbFrame(mode: OrbMode, size: number, t: number, opts: ModeOpts): Dot[] {
  "worklet";
  if (mode === "orbits") return frameOrbits(size, t, opts);
  if (mode === "wave") return frameWave(size, t, opts);
  return frameRibbon(size, t, opts); // ribbon and ring (faceOn) share geometry
}

// ── option scaling (JS thread) — same as thinking-orbs' scaleCounts/scaleRadii,
// which the package's pure `engine` entry doesn't export ─────────────────────

const COUNT_PAIRS: [string, string][] = [["latRings", "lonDensity"], ["rings", "lonDensity"], ["lanes", "segs"]];
const COUNT_KEYS = ["orbitN", "ghostN", "nodeN", "strandN", "signals"];
const RADIUS_KEYS = ["rBase", "rDepth", "rActive", "rDot", "ghostR", "partR", "partRDepth", "nodeR", "nodeRDepth"];

export function scaleCounts(opts: ModeOpts, scale: number): ModeOpts {
  const out = { ...opts };
  const done = new Set<string>();
  const rt = Math.sqrt(scale);
  for (const [a, b] of COUNT_PAIRS) {
    const va = out[a];
    const vb = out[b];
    if (va != null && vb != null && !done.has(a) && !done.has(b)) {
      out[a] = Math.max(2, Math.round(va * rt));
      out[b] = Math.max(2, Math.round(vb * rt));
      done.add(a);
      done.add(b);
    }
  }
  for (const k of COUNT_KEYS) {
    const v = out[k];
    if (v != null && v !== 0 && !done.has(k)) out[k] = Math.max(1, Math.round(v * scale));
  }
  return out;
}

export function scaleRadii(opts: ModeOpts, scale: number): ModeOpts {
  const out = { ...opts };
  for (const k of RADIUS_KEYS) {
    const v = out[k];
    if (v != null) out[k] = v * scale;
  }
  return out;
}
