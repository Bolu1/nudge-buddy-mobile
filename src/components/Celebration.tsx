import { useEffect } from "react";
import { Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { PartyMascot } from "@/components/Mascot";
import { SCORE_COLOR, scoreTone } from "@/lib/flashcards";
import { colors } from "@/lib/theme";

const CONFETTI_COLORS = ["#f7b8a5", "#b6cdb2", "#e9c46a", "#e7e1de", "#8fc78a", "#f0806f"];
const PIECES = 24;

// Deterministic upward fan that falls away — same shape as the web burst
const confetti = Array.from({ length: PIECES }, (_, i) => {
  const angle = (-165 + (150 * i) / (PIECES - 1)) * (Math.PI / 180);
  const dist = 60 + ((i * 37) % 60);
  return {
    dx: Math.cos(angle) * dist * 1.5,
    dy: Math.sin(angle) * dist,
    rot: ((i * 97) % 540) - 270,
    delay: (i % 5) * 40,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    round: i % 3 === 0,
  };
});

function headline(scorePct: number): string {
  if (scorePct === 100) return "Perfect run!";
  const tone = scoreTone(scorePct);
  if (tone === "good") return "Nailed it!";
  if (tone === "average") return "Nice work!";
  return "Done! Every round counts.";
}

function ConfettiPiece({ piece }: { piece: (typeof confetti)[number] }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(piece.delay, withTiming(1, { duration: 1600, easing: Easing.out(Easing.cubic) }));
  }, [t, piece.delay]);
  const style = useAnimatedStyle(() => {
    // Burst out for the first ~45%, then drift down and fade
    const burst = Math.min(t.value / 0.45, 1);
    const fall = Math.max((t.value - 0.45) / 0.55, 0);
    return {
      opacity: 1 - fall,
      transform: [
        { translateX: piece.dx * burst + piece.dx * 0.25 * fall },
        { translateY: piece.dy * burst + 160 * fall * fall },
        { rotate: `${piece.rot * t.value}deg` },
      ],
    };
  });
  return (
    <Animated.View
      style={[
        style,
        {
          position: "absolute",
          backgroundColor: piece.color,
          width: piece.round ? 8 : 6,
          height: piece.round ? 8 : 12,
          borderRadius: piece.round ? 4 : 2,
        },
      ]}
    />
  );
}

/**
 * Buddy in a party hat with a confetti burst: the top of a flashcard session
 * summary (pass scorePct), or any milestone (pass a title).
 */
export function Celebration({ scorePct, title }: { scorePct?: number; title?: string }) {
  const reduceMotion = useReducedMotion();
  const tone = scorePct === undefined ? null : scoreTone(scorePct);
  const text = title ?? (scorePct === undefined ? "" : headline(scorePct));
  const pop = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (!reduceMotion) pop.value = withSpring(1, { damping: 9, stiffness: 140 });
  }, [pop, reduceMotion]);

  const popStyle = useAnimatedStyle(() => ({
    opacity: Math.min(pop.value * 1.5, 1),
    transform: [{ scale: 0.4 + 0.6 * pop.value }, { translateY: (1 - pop.value) * 20 }],
  }));

  return (
    <View className="items-center" accessibilityRole="text" accessibilityLabel={text}>
      <View className="items-center justify-center">
        {!reduceMotion ? (
          <View pointerEvents="none" style={{ position: "absolute", top: "50%", left: "50%" }}>
            {confetti.map((c, i) => (
              <ConfettiPiece key={i} piece={c} />
            ))}
          </View>
        ) : null}
        <Animated.View style={popStyle}>
          <PartyMascot size={112} wink={tone !== "bad"} />
        </Animated.View>
      </View>
      <Text className="text-lg font-semibold mt-1" style={{ color: tone ? SCORE_COLOR[tone] : colors.primary }}>
        {text}
      </Text>
    </View>
  );
}
