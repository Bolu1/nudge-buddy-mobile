import { useMemo } from "react";
import { View } from "react-native";
import { BlurMask, Canvas, Circle, Picture, Skia, createPicture, useClock } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";
import { resolvePreset, type OrbState } from "thinking-orbs/engine";
import { orbFrame, scaleCounts, scaleRadii, type OrbMode } from "./orb/engine";

export type VoiceOrbState = "idle" | "listening" | "hearing" | "speaking" | "processing" | "muted";

// App voice states → thinking-orbs animation + Lumina Focus palette ink (same as the web orb)
const STATES: Record<VoiceOrbState, { orb: OrbState; color: string; glow: string; speed: number }> = {
  idle:       { orb: "breathing", color: "#8da38a", glow: "rgba(141,163,138,0.14)", speed: 0.8 }, // primary-container
  listening:  { orb: "listening", color: "#b6cdb2", glow: "rgba(141,163,138,0.28)", speed: 1 },   // primary
  hearing:    { orb: "listening", color: "#d2e8cd", glow: "rgba(182,205,178,0.45)", speed: 1.8 }, // user is talking — brighter, livelier
  speaking:   { orb: "composing", color: "#f7b8a5", glow: "rgba(247,184,165,0.22)", speed: 1 },   // secondary
  processing: { orb: "working",   color: "#b6cdb2", glow: "rgba(141,163,138,0.24)", speed: 1.2 }, // primary
  muted:      { orb: "breathing", color: "#434842", glow: "transparent",            speed: 0.5 }, // outline-variant
};

const hexToRgb = (h: string) => ({
  r: parseInt(h.slice(1, 3), 16),
  g: parseInt(h.slice(3, 5), 16),
  b: parseInt(h.slice(5, 7), 16),
});

/**
 * The web app's dotted voice orb (thinking-orbs), drawn with Skia. Each frame's
 * geometry is computed and painted on the UI thread, so it never competes with
 * the voice pipeline running in JS. Animation pauses on its own when the app is
 * in the background.
 */
export function VoiceOrb({ state, size = 64, glow = true }: { state: VoiceOrbState; size?: number; glow?: boolean }) {
  const s = STATES[state];

  // Mode + options for this state and size — computed once per change, on the JS thread.
  // Above 64pt, dots and density grow sub-linearly so the orb doesn't read sparse.
  const preset = useMemo(() => {
    const { mode, speed, opts } = resolvePreset(s.orb, size >= 48 ? 64 : size >= 26 ? 32 : 20);
    const grow = Math.max(1, size / 64);
    const scaled = grow > 1 ? scaleCounts(scaleRadii(opts, grow ** 0.4), grow ** 0.3) : opts;
    return { mode: mode as OrbMode, speed: speed * s.speed, opts: scaled };
  }, [s, size]);
  const tint = useMemo(() => hexToRgb(s.color), [s.color]);

  const clock = useClock();
  const picture = useDerivedValue(() => {
    const dots = orbFrame(preset.mode, size, (clock.value / 1000) * preset.speed, preset.opts);
    return createPicture((canvas) => {
      const paint = Skia.Paint();
      paint.setAntiAlias(true);
      const color = new Float32Array(4);
      for (let i = 0; i < dots.length; i++) {
        const d = dots[i];
        // Dark-substrate ink: near dots (low `white`) render brightest in the tint
        const w = Math.min(1, Math.max(0, d.white));
        color[0] = (tint.r * (1 - w)) / 255;
        color[1] = (tint.g * (1 - w)) / 255;
        color[2] = (tint.b * (1 - w)) / 255;
        color[3] = d.a ?? 1;
        paint.setColor(color);
        canvas.drawCircle(d.x, d.y, d.r, paint);
      }
    }, { width: size, height: size });
  }, [preset, tint, size]);

  return (
    <View style={{ width: size, height: size }} accessibilityRole="image" accessibilityLabel={`Voice assistant ${state === "processing" ? "thinking" : state}`}>
      <Canvas style={{ width: size, height: size }}>
        {glow && s.glow !== "transparent" ? (
          <Circle cx={size / 2} cy={size / 2} r={size * 0.32} color={s.glow}>
            <BlurMask blur={size * 0.18} style="normal" />
          </Circle>
        ) : null}
        <Picture picture={picture} />
      </Canvas>
    </View>
  );
}
