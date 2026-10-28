import { Platform } from "react-native";
import {
  AlphaType,
  BlendMode,
  ColorType,
  FontWeight,
  PaintStyle,
  Skia,
  StrokeCap,
  TileMode,
  type SkCanvas,
  type SkFont,
  type SkPaint,
  type SkPath,
  type SkSurface,
  type SkTypeface,
} from "@shopify/react-native-skia";
import * as THREE from "three";

// The Zen room's live surfaces (monitor, notepad, whiteboard…) are drawn with
// the browser's 2D canvas API on the web. Phones have no <canvas>, so this is
// that API — the part the room uses — drawn with Skia, plus a three.js texture
// that's refreshed from the pixels whenever the drawing is committed.

type Style = string | LinearGradient;

class LinearGradient {
  stops: [number, string][] = [];
  constructor(readonly x0: number, readonly y0: number, readonly x1: number, readonly y1: number) {}
  addColorStop(offset: number, color: string) {
    this.stops.push([offset, color]);
  }
}

interface State {
  fillStyle: Style;
  strokeStyle: Style;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  lineWidth: number;
  lineCap: CanvasLineCap;
  globalAlpha: number;
  lineDash: number[];
  lineDashOffset: number;
}

const DEFAULT_STATE: State = {
  fillStyle: "#000",
  strokeStyle: "#000",
  font: "10px sans-serif",
  textAlign: "start",
  textBaseline: "alphabetic",
  lineWidth: 1,
  lineCap: "butt",
  globalAlpha: 1,
  lineDash: [],
  lineDashOffset: 0,
};

// ── fonts ────────────────────────────────────────────────────────────────────

const UI_FAMILY = Platform.OS === "ios" ? "Helvetica Neue" : "sans-serif";
const HAND_FAMILY = Platform.OS === "ios" ? "Marker Felt" : "casual";
const typefaces = new Map<string, SkTypeface>();
const fonts = new Map<string, SkFont>();

function typeface(family: string, weight: number): SkTypeface {
  const key = `${family}:${weight}`;
  let tf = typefaces.get(key);
  if (!tf) {
    tf = Skia.FontMgr.System().matchFamilyStyle(family, { weight: weight as FontWeight });
    typefaces.set(key, tf);
  }
  return tf;
}

/** CSS font shorthand as the room writes it: "[weight] <size>px <families>" */
function fontFor(css: string): SkFont {
  let f = fonts.get(css);
  if (f) return f;
  const m = /^\s*(?:(bold|normal|\d{3})\s+)?([\d.]+)px\s+(.*)$/.exec(css);
  const weight = !m?.[1] || m[1] === "normal" ? 400 : m[1] === "bold" ? 700 : Number(m[1]);
  const size = m ? Number(m[2]) : 10;
  const family = m && /marker|comic|chalk|cursive/i.test(m[3]) ? HAND_FAMILY : UI_FAMILY;
  f = Skia.Font(typeface(family, weight), size);
  fonts.set(css, f);
  return f;
}

function textWidth(font: SkFont, text: string) {
  if (!text) return 0;
  return font.getGlyphWidths(font.getGlyphIDs(text)).reduce((a, b) => a + b, 0);
}

// ── context ──────────────────────────────────────────────────────────────────

export class Canvas2D {
  private state: State = { ...DEFAULT_STATE, lineDash: [] };
  private stack: State[] = [];
  private path: SkPath = Skia.Path.Make();

  constructor(private readonly canvas: SkCanvas) {}

  // Plain properties read and written by the drawing code
  get fillStyle() { return this.state.fillStyle as string; }
  set fillStyle(v: Style) { this.state.fillStyle = v; }
  get strokeStyle() { return this.state.strokeStyle as string; }
  set strokeStyle(v: Style) { this.state.strokeStyle = v; }
  get font() { return this.state.font; }
  set font(v: string) { this.state.font = v; }
  get textAlign() { return this.state.textAlign; }
  set textAlign(v: CanvasTextAlign) { this.state.textAlign = v; }
  get textBaseline() { return this.state.textBaseline; }
  set textBaseline(v: CanvasTextBaseline) { this.state.textBaseline = v; }
  get lineWidth() { return this.state.lineWidth; }
  set lineWidth(v: number) { this.state.lineWidth = v; }
  get lineCap() { return this.state.lineCap; }
  set lineCap(v: CanvasLineCap) { this.state.lineCap = v; }
  get globalAlpha() { return this.state.globalAlpha; }
  set globalAlpha(v: number) { this.state.globalAlpha = v; }
  get lineDashOffset() { return this.state.lineDashOffset; }
  set lineDashOffset(v: number) { this.state.lineDashOffset = v; }

  setLineDash(segments: number[]) { this.state.lineDash = [...segments]; }
  getLineDash() { return [...this.state.lineDash]; }

  save() {
    this.stack.push({ ...this.state, lineDash: [...this.state.lineDash] });
    this.canvas.save();
  }
  restore() {
    const s = this.stack.pop();
    if (!s) return;
    this.state = s;
    this.canvas.restore();
  }
  translate(x: number, y: number) { this.canvas.translate(x, y); }
  rotate(radians: number) { this.canvas.rotate((radians * 180) / Math.PI, 0, 0); }
  scale(x: number, y: number) { this.canvas.scale(x, y); }

  createLinearGradient(x0: number, y0: number, x1: number, y1: number) {
    return new LinearGradient(x0, y0, x1, y1);
  }

  // Paths
  beginPath() { this.path = Skia.Path.Make(); }
  closePath() { this.path.close(); }
  moveTo(x: number, y: number) { this.path.moveTo(x, y); }
  lineTo(x: number, y: number) {
    if (this.path.countPoints() === 0) this.path.moveTo(x, y);
    else this.path.lineTo(x, y);
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number) { this.path.quadTo(cx, cy, x, y); }
  rect(x: number, y: number, w: number, h: number) { this.path.addRect(Skia.XYWHRect(x, y, w, h)); }
  roundRect(x: number, y: number, w: number, h: number, r: number | number[] = 0) {
    const rad = Array.isArray(r) ? (r[0] ?? 0) : r;
    this.path.addRRect(Skia.RRectXY(Skia.XYWHRect(x, y, w, h), rad, rad));
  }
  arc(x: number, y: number, r: number, start: number, end: number, ccw = false) {
    this.ellipse(x, y, r, r, 0, start, end, ccw);
  }
  ellipse(x: number, y: number, rx: number, ry: number, rotation: number, start: number, end: number, ccw = false) {
    const oval = Skia.XYWHRect(x - rx, y - ry, rx * 2, ry * 2);
    let sweep = end - start;
    if (!ccw && sweep < 0) sweep = (sweep % (2 * Math.PI)) + 2 * Math.PI;
    if (ccw && sweep > 0) sweep = (sweep % (2 * Math.PI)) - 2 * Math.PI;
    if (Math.abs(sweep) >= 2 * Math.PI - 1e-6) {
      // Full circle: Skia's arcTo collapses a 360° sweep, so draw it as two halves
      const s = (start * 180) / Math.PI;
      const half = ccw ? -180 : 180;
      this.path.arcToOval(oval, s, half, this.path.countPoints() === 0);
      this.path.arcToOval(oval, s + half, half, false);
    } else {
      this.path.arcToOval(oval, (start * 180) / Math.PI, (sweep * 180) / Math.PI, this.path.countPoints() === 0);
    }
    if (rotation) this.path.transform(Skia.Matrix().translate(x, y).rotate(rotation).translate(-x, -y));
  }

  fill() { this.canvas.drawPath(this.path, this.paint(this.state.fillStyle, PaintStyle.Fill)); }
  stroke() { this.canvas.drawPath(this.path, this.paint(this.state.strokeStyle, PaintStyle.Stroke)); }

  fillRect(x: number, y: number, w: number, h: number) {
    this.canvas.drawRect(Skia.XYWHRect(x, y, w, h), this.paint(this.state.fillStyle, PaintStyle.Fill));
  }
  strokeRect(x: number, y: number, w: number, h: number) {
    this.canvas.drawRect(Skia.XYWHRect(x, y, w, h), this.paint(this.state.strokeStyle, PaintStyle.Stroke));
  }
  clearRect(x: number, y: number, w: number, h: number) {
    const p = Skia.Paint();
    p.setBlendMode(BlendMode.Clear);
    this.canvas.drawRect(Skia.XYWHRect(x, y, w, h), p);
  }

  measureText(text: string) {
    return { width: textWidth(fontFor(this.state.font), text) } as TextMetrics;
  }

  fillText(text: string, x: number, y: number, maxWidth?: number) {
    const font = fontFor(this.state.font);
    let w = textWidth(font, text);
    const squeeze = maxWidth != null && w > maxWidth && w > 0 ? maxWidth / w : 1;
    w *= squeeze;
    const align = this.state.textAlign;
    const dx = align === "center" ? -w / 2 : align === "right" || align === "end" ? -w : 0;
    const { ascent, descent } = font.getMetrics(); // ascent is negative
    const base = this.state.textBaseline;
    const dy = base === "top" || base === "hanging" ? -ascent : base === "middle" ? -(ascent + descent) / 2 : base === "bottom" ? -descent : 0;
    const paint = this.paint(this.state.fillStyle, PaintStyle.Fill);
    if (squeeze === 1) {
      this.canvas.drawText(text, x + dx, y + dy, paint, font);
      return;
    }
    this.canvas.save();
    this.canvas.translate(x + dx, y + dy);
    this.canvas.scale(squeeze, 1);
    this.canvas.drawText(text, 0, 0, paint, font);
    this.canvas.restore();
  }

  private paint(style: Style, kind: PaintStyle): SkPaint {
    const p = Skia.Paint();
    p.setAntiAlias(true);
    p.setStyle(kind);
    if (style instanceof LinearGradient) {
      p.setShader(Skia.Shader.MakeLinearGradient(
        { x: style.x0, y: style.y0 },
        { x: style.x1, y: style.y1 },
        style.stops.map(([, c]) => Skia.Color(c)),
        style.stops.map(([o]) => o),
        TileMode.Clamp,
      ));
      p.setAlphaf(this.state.globalAlpha);
    } else {
      p.setColor(Skia.Color(style));
      p.setAlphaf(p.getAlphaf() * this.state.globalAlpha);
    }
    if (kind === PaintStyle.Stroke) {
      p.setStrokeWidth(this.state.lineWidth);
      p.setStrokeCap(this.state.lineCap === "round" ? StrokeCap.Round : this.state.lineCap === "square" ? StrokeCap.Square : StrokeCap.Butt);
      if (this.state.lineDash.length) p.setPathEffect(Skia.PathEffect.MakeDash(this.state.lineDash, this.state.lineDashOffset));
    }
    return p;
  }
}

// ── canvas + texture ─────────────────────────────────────────────────────────

export interface TextureCanvas {
  /** Typed as the DOM context so the room's drawing code ports unchanged */
  ctx: CanvasRenderingContext2D;
  /** Copies the current drawing into a three.js texture (created on first call) */
  toTexture(): THREE.DataTexture;
}

export function createTextureCanvas(w: number, h: number): TextureCanvas {
  const surface: SkSurface | null = Skia.Surface.MakeOffscreen(w, h) ?? Skia.Surface.Make(w, h);
  if (!surface) throw new Error(`Skia surface ${w}×${h} failed`);
  const ctx = new Canvas2D(surface.getCanvas());
  let tex: THREE.DataTexture | null = null;
  const data = new Uint8Array(w * h * 4);
  const info = { width: w, height: h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul };

  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    toTexture() {
      surface.flush();
      const px = surface.makeImageSnapshot().readPixels(0, 0, info) as Uint8Array | null;
      if (px) {
        // expo-gl can't flip on upload (UNPACK_FLIP_Y), so flip the rows here to
        // match a canvas texture's orientation
        const row = w * 4;
        for (let y = 0; y < h; y++) data.set(px.subarray((h - 1 - y) * row, (h - y) * row), y * row);
      }
      if (!tex) {
        tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
        tex.flipY = false;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.magFilter = THREE.LinearFilter;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.generateMipmaps = true;
      }
      tex.needsUpdate = true;
      return tex;
    },
  };
}
