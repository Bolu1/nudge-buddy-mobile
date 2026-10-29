import { forwardRef, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type TextInputProps,
} from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  interpolateColor,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "@/lib/theme";
import { haptic } from "@/lib/haptics";
import { EASE_OUT, listEntering, listExiting, listLayout, MOTION, SPRING_SNAPPY } from "@/lib/motion";
import { Icon, type IconName } from "./Icon";
import { MenuButton } from "./MenuButton";

export { Icon, PhoneIcon, GoogleIcon, type IconName } from "./Icon";
export { MenuButton } from "./MenuButton";

// ── Buttons ──────────────────────────────────────────────────────────────────

type ButtonVariant = "primary" | "tonal" | "ghost" | "danger" | "outline";

const buttonBg: Record<ButtonVariant, string> = {
  primary: "bg-primary-container active:bg-primary",
  tonal: "bg-on-primary-container active:bg-primary-dim",
  ghost: "bg-transparent active:bg-surface-high",
  danger: "bg-error-container/80 active:bg-error-container",
  outline: "bg-surface-high border border-outline-variant active:bg-surface-highest",
};

const buttonText: Record<ButtonVariant, string> = {
  primary: "text-on-primary",
  tonal: "text-primary-container",
  ghost: "text-outline",
  danger: "text-error",
  outline: "text-on-surface",
};

export function Button({
  title,
  onPress,
  variant = "primary",
  disabled,
  loading,
  icon,
  size = "md",
  className = "",
}: {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  icon?: IconName;
  size?: "sm" | "md";
  className?: string;
}) {
  const pad = size === "sm" ? "px-3.5 py-2" : "px-5 py-3";
  const textSize = size === "sm" ? "text-xs" : "text-sm";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      className={`flex-row items-center justify-center gap-2 rounded-full ${pad} ${buttonBg[variant]} ${disabled || loading ? "opacity-50" : ""} ${className}`}
    >
      {loading ? (
        <ActivityIndicator size="small" color={variant === "primary" ? colors.onPrimary : colors.primaryContainer} />
      ) : icon ? (
        <Icon name={icon} size={size === "sm" ? 13 : 15} color={variant === "primary" ? colors.onPrimary : colors.primaryContainer} strokeWidth={2} />
      ) : null}
      <Text className={`${textSize} font-semibold ${buttonText[variant]}`}>{title}</Text>
    </Pressable>
  );
}

export function IconButton({
  name,
  onPress,
  size = 18,
  color = colors.outline,
  className = "",
  disabled,
  accessibilityLabel,
}: {
  name: IconName;
  onPress?: () => void;
  size?: number;
  color?: string;
  className?: string;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      className={`w-9 h-9 rounded-full items-center justify-center active:bg-surface-high ${disabled ? "opacity-40" : ""} ${className}`}
    >
      <Icon name={name} size={size} color={color} />
    </Pressable>
  );
}

// ── Text inputs ──────────────────────────────────────────────────────────────

export const Field = forwardRef<TextInput, TextInputProps & { className?: string }>(function Field(
  { className = "", multiline, ...props },
  ref,
) {
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={colors.placeholder}
      selectionColor={colors.primaryContainer}
      multiline={multiline}
      textAlignVertical={multiline ? "top" : "center"}
      className={`w-full bg-field border border-field-border text-on-surface rounded-xl px-4 py-3 text-sm ${multiline ? "min-h-20" : ""} ${className}`}
      {...props}
    />
  );
});

export function PasswordField(props: TextInputProps) {
  const [shown, setShown] = useState(false);
  return (
    <View className="relative justify-center">
      <Field {...props} secureTextEntry={!shown} autoCapitalize="none" autoCorrect={false} className="pr-12" />
      <Pressable
        onPress={() => setShown((s) => !s)}
        hitSlop={8}
        className="absolute right-3 p-1"
        accessibilityRole="button"
        accessibilityLabel={shown ? "Hide password" : "Show password"}
      >
        <Icon name={shown ? "eye-off" : "eye"} size={17} color={colors.outline} />
      </Pressable>
    </View>
  );
}

export function Label({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <Text className={`text-outline text-xs font-medium mb-2 tracking-wide uppercase ${className}`}>{children}</Text>
  );
}

export function ErrorBanner({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <View className="bg-error-container/30 border border-error/30 rounded-xl p-3">
      <Text className="text-error text-sm">{message}</Text>
    </View>
  );
}

export function InfoBanner({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <View className="bg-on-primary-container/40 border border-primary-container/30 rounded-xl p-3">
      <Text className="text-primary text-sm">{message}</Text>
    </View>
  );
}

// ── Toggles ──────────────────────────────────────────────────────────────────

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className = "",
}: {
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  // The highlight slides to the chosen option instead of jumping
  const [frames, setFrames] = useState<Record<string, { x: number; width: number }>>({});
  const frame = frames[value];
  const x = useSharedValue(0);
  const w = useSharedValue(0);
  const placed = useRef(false);
  useEffect(() => {
    if (!frame) return;
    if (!placed.current) {
      placed.current = true;
      x.set(frame.x);
      w.set(frame.width);
      return;
    }
    x.set(withTiming(frame.x, { duration: MOTION.base, easing: EASE_OUT }));
    w.set(withTiming(frame.width, { duration: MOTION.base, easing: EASE_OUT }));
  }, [frame, x, w]);
  const pillStyle = useAnimatedStyle(() => ({ width: w.value, transform: [{ translateX: x.value }] }));

  return (
    <View className={`bg-field border border-divider rounded-full p-0.5 ${className}`}>
      {/* Plain inner row: the pill and the options' measured frames share its origin */}
      <View className="flex-row items-center gap-0.5" accessibilityRole="tablist">
        {frame ? <Animated.View pointerEvents="none" className="absolute top-0 bottom-0 left-0 rounded-full bg-surface-high" style={pillStyle} /> : null}
        {options.map((o) => {
          const active = o.value === value;
          return (
            <Pressable
              key={o.value}
              onPress={() => {
                if (active) return;
                haptic.selection();
                onChange(o.value);
              }}
              onLayout={(e) => {
                const { x: ox, width } = e.nativeEvent.layout;
                setFrames((f) => (f[o.value]?.x === ox && f[o.value]?.width === width ? f : { ...f, [o.value]: { x: ox, width } }));
              }}
              disabled={o.disabled}
              accessibilityRole="tab"
              accessibilityState={{ selected: active, disabled: !!o.disabled }}
              className={`px-3 py-1.5 rounded-full ${active && !frame ? "bg-surface-high" : ""} ${o.disabled ? "opacity-40" : ""}`}
            >
              <Text className={`text-xs font-medium ${active ? "text-on-surface" : "text-outline"}`}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const AnimatedPath = Animated.createAnimatedComponent(Path);
// Length of the tick path below, so the stroke can draw itself in
const TICK_LENGTH = 23;

export function Checkbox({
  checked,
  onPress,
  size = 20,
  dimmed,
  accessibilityLabel,
}: {
  checked: boolean;
  onPress?: () => void;
  size?: number;
  /** Looks unavailable but still takes the tap, e.g. to explain why */
  dimmed?: boolean;
  accessibilityLabel?: string;
}) {
  // Fills with a small pop and the tick draws from left to right
  const p = useSharedValue(checked ? 1 : 0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    p.set(checked ? withSpring(1, SPRING_SNAPPY) : withTiming(0, { duration: MOTION.fast }));
  }, [checked, p]);
  const boxStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(p.value, [0, 1], ["rgba(141,163,138,0)", colors.primaryContainer]),
    borderColor: interpolateColor(p.value, [0, 1], [colors.outline, colors.primaryContainer]),
    transform: [{ scale: interpolate(p.value, [0, 0.5, 1], [1, 1.15, 1], Extrapolation.CLAMP) }],
  }));
  const tickProps = useAnimatedProps(() => ({
    strokeDashoffset: TICK_LENGTH * (1 - Math.min(Math.max(p.value, 0), 1)),
  }));
  const tick = size * 0.6;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={accessibilityLabel}
      className={dimmed ? "opacity-30" : ""}
    >
      <Animated.View style={[{ width: size, height: size }, boxStyle]} className="rounded-full border-2 items-center justify-center">
        <Svg width={tick} height={tick} viewBox="0 0 24 24" fill="none">
          <AnimatedPath
            d="M4 12l5 5L20 6"
            stroke={colors.onPrimary}
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={TICK_LENGTH}
            animatedProps={tickProps}
          />
        </Svg>
      </Animated.View>
    </Pressable>
  );
}

export function Toggle({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  // The thumb slides across and the track colour blends, like the system switch
  const p = useSharedValue(value ? 1 : 0);
  useEffect(() => {
    p.set(withTiming(value ? 1 : 0, { duration: MOTION.fast, easing: EASE_OUT }));
  }, [value, p]);
  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(p.value, [0, 1], [colors.surfaceHighest, colors.primaryContainer]),
  }));
  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: p.value * 20 }] }));
  return (
    <Pressable
      onPress={() => {
        haptic.selection();
        onChange(!value);
      }}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: !!disabled }}
      className={disabled ? "opacity-40" : ""}
    >
      <Animated.View className="w-11 h-6 rounded-full p-0.5" style={trackStyle}>
        <Animated.View className="w-5 h-5 rounded-full bg-on-surface" style={thumbStyle} />
      </Animated.View>
    </Pressable>
  );
}

// ── Layout ───────────────────────────────────────────────────────────────────

export function ScreenHeader({
  title,
  subtitle,
  right,
  left = <MenuButton />,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  /** Defaults to the menu (hamburger) button */
  left?: ReactNode;
}) {
  return (
    <View className="px-4 pt-2 pb-3 border-b border-divider flex-row items-center justify-between gap-3">
      <View className="flex-row items-center gap-2 flex-1 min-w-0">
        {left}
        <View className="flex-1 min-w-0">
          <Text className="text-on-surface text-2xl font-semibold tracking-tight" numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text className="text-outline text-sm mt-0.5" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      {right}
    </View>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <View className={`bg-surface-low rounded-2xl border border-divider ${className}`}>{children}</View>;
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <View className={`items-center justify-center py-10 ${className}`}>
      <ActivityIndicator color={colors.primaryContainer} />
    </View>
  );
}

/**
 * A list row that fades in when added, fades out when removed, and glides when
 * its neighbours change. Wrap the list in <LayoutAnimationConfig skipEntering>
 * so rows already there on first render don't all fade in.
 */
export function ListItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Animated.View entering={listEntering} exiting={listExiting} layout={listLayout} className={className}>
      {children}
    </Animated.View>
  );
}

export function EmptyState({ icon, title, body }: { icon?: IconName; title: string; body?: string }) {
  return (
    <View className="items-center justify-center py-14 px-8 gap-2">
      {icon ? (
        <View className="w-12 h-12 rounded-full bg-surface-high items-center justify-center mb-2">
          <Icon name={icon} size={20} color={colors.outline} />
        </View>
      ) : null}
      <Text className="text-on-surface-variant text-base font-medium text-center">{title}</Text>
      {body ? <Text className="text-outline text-sm text-center leading-5">{body}</Text> : null}
    </View>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View className="flex-row items-center justify-between mb-2">
      <Text className="text-outline text-[11px] font-semibold tracking-widest uppercase">{children}</Text>
      {right}
    </View>
  );
}

// ── Bottom sheet (modal) ─────────────────────────────────────────────────────

// Drag past this far, or flick faster than this, and the sheet closes
const SHEET_CLOSE_DISTANCE = 120;
const SHEET_CLOSE_VELOCITY = 900;
const SHEET_SPRING = { damping: 26, stiffness: 260 };

function useKeyboardVisible() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const ios = Platform.OS === "ios";
    const show = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", () => setShown(true));
    const hide = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", () => setShown(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return shown;
}

export function Sheet({
  visible,
  onClose,
  title,
  children,
  footer,
  tall,
  stickToBottom,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Fixed at the full sheet height instead of fitting the content (e.g. a chat) */
  tall?: boolean;
  /** Keep the newest content in view as it grows (e.g. a chat) */
  stickToBottom?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const keyboardShown = useKeyboardVisible();
  // Stays mounted through the slide-out after the parent hides it
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);

  const y = useSharedValue(screenH);
  const atTop = useSharedValue(true);
  const dragging = useSharedValue(false);
  const scrollRef = useRef<ScrollView>(null);
  const onCloseRef = useRef(onClose);
  const visibleRef = useRef(visible);
  useEffect(() => {
    onCloseRef.current = onClose;
    visibleRef.current = visible;
  });

  useEffect(() => {
    if (!mounted) return;
    if (visible) y.set(withTiming(0, { duration: 260, easing: Easing.out(Easing.cubic) }));
    else y.set(withTiming(screenH, { duration: 220 }, (done) => { if (done) scheduleOnRN(setMounted, false); }));
  }, [visible, mounted, screenH, y]);

  // Swiped away: ask the parent to close; if it doesn't (e.g. mid-save), settle back
  const requestClose = useCallback(() => {
    onCloseRef.current();
    setTimeout(() => { if (visibleRef.current) y.set(withSpring(0, SHEET_SPRING)); }, 300);
  }, [y]);

  // The handle and title always drag the sheet; the content only when it's
  // scrolled to the top (otherwise the drag scrolls it)
  const makePan = useCallback((fromContent: boolean) => Gesture.Pan()
    .activeOffsetY([-10, 10])
    .failOffsetX([-24, 24])
    .onStart(() => { dragging.value = !fromContent || atTop.value; })
    .onUpdate((e) => { if (dragging.value) y.value = Math.max(0, e.translationY); })
    .onEnd((e) => {
      if (!dragging.value) return;
      if (e.translationY > SHEET_CLOSE_DISTANCE || e.velocityY > SHEET_CLOSE_VELOCITY) {
        y.value = withTiming(screenH, { duration: 200 });
        scheduleOnRN(requestClose);
      } else {
        y.value = withSpring(0, SHEET_SPRING);
      }
    }), [atTop, dragging, requestClose, screenH, y]);
  // The compiler lint reads the builder's callbacks as running during render;
  // gesture-handler only calls them on touch.
  /* eslint-disable react-hooks/refs */
  const headerPan = useMemo(() => makePan(false), [makePan]);
  // Runs alongside the content's own scrolling
  const contentGesture = useMemo(() => Gesture.Simultaneous(makePan(true), Gesture.Native()), [makePan]);
  /* eslint-enable react-hooks/refs */

  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: interpolate(y.value, [0, screenH * 0.6], [1, 0], Extrapolation.CLAMP) }));

  if (!mounted) return null;
  const maxHeight = screenH * 0.88;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      {/* Gestures inside a Modal need their own root (Android) */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        {/* The panel shrinks to fit between the status bar and the keyboard, so a
            tall sheet's title and newest messages never get pushed off screen */}
        <KeyboardAvoidingView behavior="padding" className="flex-1 justify-end" style={{ paddingTop: insets.top + 8 }}>
          <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
            <Pressable className="flex-1 bg-black/50" onPress={onClose} accessibilityLabel="Close" />
          </Animated.View>
          <Animated.View style={[panelStyle, { flexShrink: 1 }]}>
            <View
              className="bg-surface-low rounded-t-3xl border-t border-divider"
              style={[
                // The keyboard covers the home indicator, so its inset isn't needed then
                { paddingBottom: keyboardShown ? 12 : Math.max(insets.bottom, 12), flexShrink: 1 },
                tall ? { height: maxHeight } : { maxHeight },
              ]}
            >
              <GestureDetector gesture={headerPan}>
                <View>
                  <View className="items-center pt-2.5 pb-1">
                    <View className="w-10 h-1 rounded-full bg-outline-variant" />
                  </View>
                  {title ? (
                    <View className="flex-row items-center justify-between px-5 pt-2 pb-3">
                      <Text className="text-on-surface font-semibold text-base">{title}</Text>
                      <IconButton name="x" onPress={onClose} accessibilityLabel="Close" />
                    </View>
                  ) : (
                    <View className="h-3" />
                  )}
                </View>
              </GestureDetector>
              <GestureDetector gesture={contentGesture}>
                <ScrollView
                  ref={scrollRef}
                  className={tall ? "flex-1 px-5" : "grow-0 px-5"}
                  // A short chat sits just above the input, like a messages thread
                  contentContainerClassName={stickToBottom ? "grow justify-end pb-4 gap-4" : "pb-4 gap-4"}
                  keyboardShouldPersistTaps="handled"
                  // No bounce at the top: pulling down there moves the sheet instead
                  bounces={false}
                  overScrollMode="never"
                  scrollEventThrottle={16}
                  onScroll={(e) => atTop.set(e.nativeEvent.contentOffset.y <= 0)}
                  onContentSizeChange={() => { if (stickToBottom) scrollRef.current?.scrollToEnd({ animated: true }); }}
                  onLayout={() => { if (stickToBottom) scrollRef.current?.scrollToEnd({ animated: false }); }}
                >
                  {children}
                </ScrollView>
              </GestureDetector>
              {footer ? <View className="px-5 pt-3 border-t border-divider">{footer}</View> : null}
            </View>
          </Animated.View>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}

/** Pick one option from a list (replaces <select>) */
export function SelectField<T extends string>({
  value,
  options,
  onChange,
  placeholder = "Select…",
  title,
}: {
  value: T | "";
  options: { value: T; label: string; color?: string }[];
  onChange: (v: T) => void;
  placeholder?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        className="w-full bg-field border border-field-border rounded-xl px-4 py-3 flex-row items-center justify-between"
      >
        <View className="flex-row items-center gap-2 flex-1">
          {current?.color ? <View className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: current.color }} /> : null}
          <Text className={`text-sm ${current ? "text-on-surface" : "text-placeholder"}`} numberOfLines={1}>
            {current?.label ?? placeholder}
          </Text>
        </View>
        <Icon name="chevron-down" size={16} color={colors.outline} />
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title={title ?? placeholder}>
        <View className="gap-1">
          {options.map((o) => (
            <Pressable
              key={o.value}
              onPress={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={`flex-row items-center gap-3 px-3 py-3 rounded-xl ${o.value === value ? "bg-surface-high" : "active:bg-surface-high"}`}
            >
              {o.color ? <View className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: o.color }} /> : null}
              <Text className="text-on-surface text-sm flex-1">{o.label}</Text>
              {o.value === value ? <Icon name="check" size={16} color={colors.primaryContainer} /> : null}
            </Pressable>
          ))}
        </View>
      </Sheet>
    </>
  );
}
