// AsyncStorage keys (same names as the web app's localStorage keys where shared)
export const PREFS = {
  voiceId: "nudge:selectedVoiceId",
  musicMix: "nudge:musicMix",
  musicLoop: "nudge:musicLoop",
  musicDisabled: "nudge:musicDisabled",
  introSeen: "nudge:introSeen",
  callsEnabled: "nudge:callsEnabled",
  tutorialSeen: "nudge:tutorialSeen",
  // Face ID / fingerprint to open the app — "1" = on
  appLock: "nudge:appLock",
} as const;

export const PREF_KEYS = Object.values(PREFS);
