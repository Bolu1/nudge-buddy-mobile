import * as Haptics from "expo-haptics";
import { getPref } from "./storage";
import { PREFS } from "./prefs";

// Each pattern keeps one meaning across the app so people learn it, and all of
// them follow the Haptics switch in Settings (off until someone turns it on):
//   selection — a choice changed (toggle, segmented control, card flip)
//   impact    — something physical-feeling landed (a missed flashcard)
//   success   — a task or milestone finished
function enabled() {
  return getPref(PREFS.haptics) === "1";
}

export const haptic = {
  selection() {
    if (enabled()) void Haptics.selectionAsync().catch(() => {});
  },
  impact(style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) {
    if (enabled()) void Haptics.impactAsync(style).catch(() => {});
  },
  success() {
    if (enabled()) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  },
};

export { ImpactFeedbackStyle } from "expo-haptics";
