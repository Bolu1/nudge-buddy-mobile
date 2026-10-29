import { Easing, FadeIn, FadeOut, LinearTransition, useReducedMotion } from "react-native-reanimated";

// Shared timings so motion feels like one system: short, and tied to the action
// that caused it. Reanimated's withTiming/withSpring and layout animations
// already jump to their end state when Reduce Motion is on (ReduceMotion.System
// is their default); useReducedMotion is for the loops and canvases Reanimated
// doesn't drive.
export const MOTION = {
  fast: 150,
  base: 220,
  slow: 320,
} as const;

export const EASE_OUT = Easing.out(Easing.cubic);

/** Quick settle with a hint of overshoot — checkmarks, badges, pills */
export const SPRING_SNAPPY = { damping: 16, stiffness: 320, mass: 0.6 } as const;

/** How long a ticked task stays put so the checkmark lands before it moves to Completed */
export const COMPLETE_SETTLE_MS = 350;

/** List rows: fade in when added, fade out when removed, neighbours glide into place */
export const listEntering = FadeIn.duration(MOTION.base);
export const listExiting = FadeOut.duration(MOTION.fast);
export const listLayout = LinearTransition.duration(MOTION.base).easing(EASE_OUT);

export { useReducedMotion };
