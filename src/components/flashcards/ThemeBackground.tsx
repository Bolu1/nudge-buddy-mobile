import { memo } from "react";
import { StyleSheet, View } from "react-native";
import { SvgXml } from "react-native-svg";
import { themeBackground, type FlashcardTheme } from "@/lib/flashcards";

/** Fills its parent with the theme's DiceBear art for `seed` (a card or collection id). */
export const ThemeBackground = memo(function ThemeBackground({ theme, seed }: { theme: FlashcardTheme; seed: string }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <SvgXml xml={themeBackground(theme, seed)} width="100%" height="100%" />
    </View>
  );
});
