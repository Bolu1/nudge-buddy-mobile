import type { ComponentProps } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { Drawer } from "expo-router/drawer";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/lib/auth-context";
import { colors } from "@/lib/theme";
import { useActiveFocus } from "@/lib/use-active-focus";
import { useBoardInviteCount } from "@/lib/use-board-invite-count";
import { useVoice } from "@/lib/voice/voice-context";
import { Icon, type IconName } from "@/components/ui";
import { Mascot } from "@/components/Mascot";
import { fmtDuration } from "@/components/CallBar";

type DrawerContentComponentProps = Parameters<NonNullable<ComponentProps<typeof Drawer>["drawerContent"]>>[0];

const MAIN: { name: string; title: string; icon: IconName }[] = [
  { name: "workspace", title: "Buddy", icon: "mic" },
  { name: "tasks", title: "Tasks", icon: "check-square" },
  { name: "workday", title: "Workday", icon: "sun" },
  { name: "boards", title: "Boards", icon: "grid" },
  { name: "notes", title: "Brain Dump", icon: "file-text" },
  { name: "flashcards", title: "Flashcards", icon: "layers" },
  { name: "focus", title: "Focus", icon: "target" },
  { name: "calendar", title: "Calendar", icon: "calendar" },
  { name: "insights", title: "Insights", icon: "bar-chart" },
];

function Row({
  icon,
  title,
  active,
  onPress,
  hint,
  badge,
  tone,
}: {
  icon: IconName;
  title: string;
  active?: boolean;
  onPress: () => void;
  hint?: string;
  badge?: number;
  tone?: "danger";
}) {
  const color = tone === "danger" ? colors.error : active ? colors.primary : colors.onSurfaceVariant;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="menuitem"
      accessibilityState={{ selected: !!active }}
      className={`flex-row items-center gap-3.5 px-4 py-3 rounded-2xl ${active ? "bg-on-primary-container" : "active:bg-surface-high"}`}
    >
      <Icon name={icon} size={19} color={color} strokeWidth={active ? 2 : 1.75} />
      <Text className="text-[15px] font-medium flex-1" style={{ color }}>{title}</Text>
      {hint ? <Text className="text-primary-container text-xs">{hint}</Text> : null}
      {badge ? (
        <View className="min-w-5 h-5 px-1.5 rounded-full bg-secondary items-center justify-center">
          <Text className="text-on-secondary text-[11px] font-bold">{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function Menu({ state, navigation }: DrawerContentComponentProps) {
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();
  const { micActive, endSession } = useVoice();
  const invites = useBoardInviteCount();
  const { activeFocus, seconds, paused } = useActiveFocus();
  const current = state.routes[state.index]?.name;

  // Always close explicitly: navigating to the screen that's already open
  // changes nothing, so the drawer would otherwise stay open
  function go(name: string) {
    if (name !== current) navigation.navigate(name);
    navigation.closeDrawer();
  }

  function goOutside(path: "/boards/invites" | "/zen") {
    navigation.closeDrawer();
    router.push(path);
  }

  function confirmSignOut() {
    Alert.alert("Sign out?", undefined, [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => { endSession(); void signOut(); } },
    ]);
  }

  return (
    <View className="flex-1 bg-surface-lowest" style={{ paddingTop: insets.top + 8, paddingBottom: Math.max(insets.bottom, 12) }}>
      <View className="flex-row items-center gap-3 pl-5 pr-3 pb-5">
        <Mascot size={34} />
        <Text className="text-on-surface text-lg font-semibold tracking-tight flex-1">Nudge Buddy</Text>
        {/* Some Android phones don't pass taps to the backdrop, so there's always a visible way out */}
        <Pressable
          onPress={() => navigation.closeDrawer()}
          hitSlop={8}
          accessibilityLabel="Close menu"
          className="w-9 h-9 rounded-full items-center justify-center active:bg-surface-high"
        >
          <Icon name="x" size={20} color={colors.onSurfaceVariant} />
        </Pressable>
      </View>

      {micActive ? (
        <Pressable onPress={() => go("workspace")} className="mx-3 mb-3 flex-row items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-[#1a2b1a] border border-on-primary-container">
          <View className="w-2 h-2 rounded-full bg-primary-container" />
          <Text className="text-primary text-sm flex-1">On a call</Text>
          <Text className="text-outline text-xs">Return</Text>
        </Pressable>
      ) : null}

      <ScrollView className="flex-1" contentContainerClassName="px-3 gap-0.5">
        {MAIN.map((item) => (
          <Row
            key={item.name}
            icon={item.icon}
            title={item.title}
            active={current === item.name}
            onPress={() => go(item.name)}
            badge={item.name === "boards" ? invites : undefined}
            hint={item.name === "focus" && activeFocus ? `${fmtDuration(seconds)}${paused ? " · paused" : ""}` : undefined}
          />
        ))}
        <Row icon="sparkles" title="Zen" onPress={() => goOutside("/zen")} hint="Buddy's room" />
        <View className="h-px bg-divider mx-4 my-3" />
        <Row icon="mail" title="Board invites" onPress={() => goOutside("/boards/invites")} badge={invites} />
        <Row icon="settings" title="Settings" active={current === "settings"} onPress={() => go("settings")} />
      </ScrollView>

      <View className="px-3 pt-2 border-t border-divider">
        <Row icon="log-out" title="Sign out" onPress={confirmSignOut} tone="danger" />
      </View>
    </View>
  );
}

export default function DrawerLayout() {
  return (
    <Drawer
      drawerContent={(props) => <Menu {...props} />}
      screenOptions={{
        headerShown: false,
        drawerType: "front",
        swipeEdgeWidth: 40,
        overlayColor: "rgba(0,0,0,0.55)",
        drawerStyle: { backgroundColor: colors.surfaceLowest, width: 290 },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      {MAIN.map((s) => (
        <Drawer.Screen key={s.name} name={s.name} options={{ title: s.title }} />
      ))}
      <Drawer.Screen name="settings" options={{ title: "Settings" }} />
    </Drawer>
  );
}
