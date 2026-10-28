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
  // Last focus timer setup, used for the next session
  pomoWork: "pomo_work",
  pomoShort: "pomo_short",
  pomoLong: "pomo_long",
  pomoCycles: "pomo_cycles",
  // Zen room and time of day ("auto" follows the clock)
  zenRoom: "zen_room",
  zenTime: "zen_time",
  // Flashcard study order — "0" = keep the saved order, otherwise shuffled
  flashcardShuffle: "nudge:flashcardShuffle",
} as const;

export const PREF_KEYS = Object.values(PREFS);
