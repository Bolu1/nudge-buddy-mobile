import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  ZoomIn,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

const CHAR_MS = 28;

/** Buddy's reply, typed out as it appears */
function useTypewriter(text: string) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    let n = 0;
    const id = setInterval(() => {
      n = Math.min(text.length, n + 1);
      setShown(n);
      if (n >= text.length) clearInterval(id);
    }, CHAR_MS);
    return () => clearInterval(id);
  }, [text]);
  return text.slice(0, shown);
}

function Float({ children }: { children: React.ReactNode }) {
  const y = useSharedValue(0);
  useEffect(() => {
    y.value = withDelay(500, withRepeat(withSequence(
      withTiming(-4, { duration: 2000, easing: Easing.inOut(Easing.sin) }),
      withTiming(0, { duration: 2000, easing: Easing.inOut(Easing.sin) }),
    ), -1));
  }, [y]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

function Reply({ text }: { text: string }) {
  const typed = useTypewriter(text);
  return (
    <Animated.View entering={ZoomIn.springify().damping(12)}>
      <Float>
        <View
          className="rounded-[22px] px-4 pt-2.5 pb-3"
          style={{ backgroundColor: "#f6fbf7", maxWidth: 280, minWidth: 120, shadowColor: "#10281c", shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 10 } }}
        >
          <View className="flex-row items-center gap-1.5 mb-1">
            <View className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#6fcf86" }} />
            <Text style={{ fontSize: 10, fontWeight: "600", letterSpacing: 0.8, color: "#5f9c70" }}>NUDGE BUDDY</Text>
          </View>
          <Text numberOfLines={6} style={{ fontSize: 14, lineHeight: 20, color: "#22313a" }}>{typed}</Text>
          {/* Tail pointing down at Buddy */}
          <Svg width={26} height={13} viewBox="0 0 26 13" style={{ position: "absolute", bottom: -11, alignSelf: "center" }}>
            <Path d="M0 0 H26 C19 0 16 4 13 13 C10 4 7 0 0 0 Z" fill="#f6fbf7" />
          </Svg>
        </View>
      </Float>
    </Animated.View>
  );
}

function Dot({ delay }: { delay: number }) {
  const o = useSharedValue(0.3);
  useEffect(() => {
    o.value = withDelay(delay, withRepeat(withSequence(withTiming(1, { duration: 400 }), withTiming(0.3, { duration: 700 })), -1));
  }, [o, delay]);
  const style = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ translateY: (1 - o.value) * 3 }] }));
  return <Animated.View className="w-2 h-2 rounded-full" style={[{ backgroundColor: "#6fcf86" }, style]} />;
}

function Thinking() {
  return (
    <Animated.View entering={ZoomIn.springify().damping(12)} className="items-center">
      <View className="flex-row items-center gap-1.5 rounded-full px-4 py-3" style={{ backgroundColor: "rgba(255,255,255,0.95)" }}>
        {[0, 1, 2].map((i) => <Dot key={i} delay={i * 160} />)}
      </View>
      {/* Thought trail */}
      <View className="mt-1.5 w-3 h-3 rounded-full -translate-x-2" style={{ backgroundColor: "rgba(255,255,255,0.95)" }} />
      <View className="mt-1 w-1.5 h-1.5 rounded-full -translate-x-3" style={{ backgroundColor: "rgba(255,255,255,0.95)" }} />
    </Animated.View>
  );
}

function Zzz({ i }: { i: number }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay(i * 800, withRepeat(withTiming(1, { duration: 2400, easing: Easing.out(Easing.quad) }), -1));
  }, [p, i]);
  const style = useAnimatedStyle(() => ({
    opacity: p.value < 0.2 ? p.value * 5 : 1 - (p.value - 0.2) / 0.8,
    transform: [{ translateX: p.value * 18 }, { translateY: -p.value * 34 }],
  }));
  return (
    <Animated.Text style={[{ position: "absolute", left: 12, bottom: 0, fontWeight: "700", color: "#e7f5ec", fontSize: 14 + i * 4 }, style]}>
      z
    </Animated.Text>
  );
}

function Sleeping() {
  return (
    <Animated.View entering={FadeIn} style={{ width: 64, height: 48 }} accessibilityLabel="Sleeping">
      {[0, 1, 2].map((i) => <Zzz key={i} i={i} />)}
    </Animated.View>
  );
}

export function SpeechBubble({ text, mood, id }: { text: string | null; mood: "thinking" | "sleeping" | null; id: number }) {
  if (text) return <View className="mb-4"><Reply key={id} text={text} /></View>;
  if (mood === "thinking") return <View className="mb-3"><Thinking /></View>;
  if (mood === "sleeping") return <View className="mb-2 ml-10"><Sleeping /></View>;
  return null;
}
