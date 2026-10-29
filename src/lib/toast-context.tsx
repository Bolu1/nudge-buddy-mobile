import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { FadeInUp, FadeOutUp, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/ui/Icon";
import { listLayout, MOTION, SPRING_SNAPPY } from "@/lib/motion";

type ToastType = "success" | "error" | "info" | "event";

interface Toast {
  id: number;
  type: ToastType;
  message: string;
  title?: string;
}

interface ToastCtx {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  /** Titled toast for server events (reminders, pomodoro, workday) */
  event: (title: string, message: string, durationMs?: number) => void;
}

const ToastContext = createContext<ToastCtx>({
  success: () => {},
  error: () => {},
  info: () => {},
  event: () => {},
});

export const useToast = () => useContext(ToastContext);

const STYLES: Record<ToastType, { box: string; text: string; color: string }> = {
  success: { box: "bg-[#1a2b1a] border-[#8da38a]/50", text: "text-[#b6cdb2]", color: "#b6cdb2" },
  error: { box: "bg-[#2a1010] border-[#93000a]/60", text: "text-[#ffb4ab]", color: "#ffb4ab" },
  info: { box: "bg-surface-low border-outline-variant", text: "text-on-surface-variant", color: "#c3c8bf" },
  event: { box: "bg-surface-low border-[#263926]", text: "text-on-surface", color: "#8da38a" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);
  const insets = useSafeAreaInsets();

  const dismiss = useCallback((id: number) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (type: ToastType, message: string, title?: string, durationMs = 3500) => {
      const id = ++counter.current;
      setToasts((prev) => [...prev.slice(-2), { id, type, message, title }]);
      setTimeout(() => dismiss(id), durationMs);
    },
    [dismiss],
  );

  const value = useMemo<ToastCtx>(
    () => ({
      success: (m) => push("success", m),
      error: (m) => push("error", m),
      info: (m) => push("info", m),
      event: (title, m, d = 8000) => push("event", m, title, d),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <View pointerEvents="box-none" className="absolute left-0 right-0 px-4 gap-2" style={{ top: insets.top + 8 }}>
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </View>
    </ToastContext.Provider>
  );
}

// Past this far up, or flicked faster than this, a toast is swiped away
const SWIPE_DISMISS = 30;
const SWIPE_VELOCITY = 500;

/** Drops in from the top, glides as others come and go; tap or swipe up to dismiss */
function ToastCard({ toast: t, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const s = STYLES[t.type];
  const dy = useSharedValue(0);
  const pan = Gesture.Pan()
    .activeOffsetY([-8, 8])
    .onUpdate((e) => { dy.value = Math.min(0, e.translationY); })
    .onEnd((e) => {
      if (e.translationY < -SWIPE_DISMISS || e.velocityY < -SWIPE_VELOCITY) {
        dy.value = withTiming(-120, { duration: MOTION.fast });
        scheduleOnRN(onDismiss, t.id);
      } else {
        dy.value = withSpring(0, SPRING_SNAPPY);
      }
    });
  const dragStyle = useAnimatedStyle(() => ({ transform: [{ translateY: dy.value }] }));

  return (
    <Animated.View entering={FadeInUp.duration(MOTION.base)} exiting={FadeOutUp.duration(MOTION.fast)} layout={listLayout}>
      <GestureDetector gesture={pan}>
        <Animated.View style={dragStyle}>
          <Pressable
            onPress={() => onDismiss(t.id)}
            accessibilityHint="Dismisses the message"
            className={`flex-row items-start gap-3 rounded-2xl border p-3.5 ${s.box}`}
          >
            {t.type === "event" ? (
              <View className="w-2 h-2 rounded-full mt-1.5 bg-primary-container" />
            ) : (
              <Icon name={t.type === "success" ? "check" : "help-circle"} size={16} color={s.color} strokeWidth={2.5} />
            )}
            <View className="flex-1">
              {t.title ? (
                <Text className="text-primary-container text-[11px] font-medium tracking-widest uppercase mb-1">
                  {t.title}
                </Text>
              ) : null}
              <Text className={`text-sm leading-5 ${s.text}`}>{t.message}</Text>
            </View>
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}
