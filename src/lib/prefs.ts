// AsyncStorage keys (same names as the web app's localStorage keys where shared)
export const PREFS = {
  voiceId: "nudge:selectedVoiceId",
  musicMix: "nudge:musicMix",
  musicLoop: "nudge:musicLoop",
  musicDisabled: "nudge:musicDisabled",
  introSeen: "nudge:introSeen",
  callsEnabled: "nudge:callsEnabled",
  tutorialSeen: "nudge:tutorialSeen",
  // Dynamic Island / lock screen (iOS Live Activities), per kind — "0" = off
  liveFocus: "nudge:live:focus",
  liveReminder: "nudge:live:reminder",
  liveBlock: "nudge:live:block",
  liveCall: "nudge:live:call",
} as const;

export const PREF_KEYS = Object.values(PREFS);
