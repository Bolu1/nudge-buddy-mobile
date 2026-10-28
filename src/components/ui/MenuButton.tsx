import { Pressable } from "react-native";
import { useNavigation } from "expo-router";
import { colors } from "@/lib/theme";
import { Icon } from "./Icon";

/** Opens the app's side menu (the drawer replaces a bottom tab bar) */
export function MenuButton() {
  const navigation = useNavigation();
  return (
    <Pressable
      onPress={() => navigation.dispatch({ type: "OPEN_DRAWER" })}
      hitSlop={8}
      accessibilityLabel="Open menu"
      className="w-9 h-9 rounded-full items-center justify-center active:bg-surface-high"
    >
      <Icon name="menu" size={20} color={colors.onSurfaceVariant} />
    </Pressable>
  );
}
