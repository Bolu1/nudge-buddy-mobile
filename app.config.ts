import type { ConfigContext, ExpoConfig } from "expo/config";
import { withEntitlementsPlist, type ConfigPlugin } from "expo/config-plugins";

// Native Google sign-in needs the iOS client's reversed id as a URL scheme.
// Leave EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID unset to build without Google sign-in.
const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const googleIosUrlScheme = googleIosClientId
  ? `com.googleusercontent.apps.${googleIosClientId.replace(".apps.googleusercontent.com", "")}`
  : undefined;

// Free Apple "Personal Team" signing can't include push notifications.
// IOS_PUSH=off builds without them (VoIP calls and remote pushes then don't
// arrive; everything started from inside the app still works).
const pushEnabled = process.env.IOS_PUSH !== "off";
const withoutPushEntitlement: ConfigPlugin = (cfg) =>
  withEntitlementsPlist(cfg, (c) => {
    delete c.modResults["aps-environment"];
    return c;
  });

const appConfig = ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Nudge Buddy",
  slug: "nudge-buddy",
  // Must match APP_SCHEME in modules/voice-engine (Android incoming-call deep link)
  scheme: "nudgebuddy",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "dark",
  backgroundColor: "#151311",
  ios: {
    bundleIdentifier: process.env.IOS_BUNDLE_ID ?? "com.nudgebuddy.app",
    // Needed to sign the Live Activity widget extension
    appleTeamId: process.env.APPLE_TEAM_ID,
    supportsTablet: false,
    infoPlist: {
      NSMicrophoneUsageDescription: "Nudge Buddy listens while you're on a call with it.",
      // audio: keep talking with the screen off / app in background
      // voip: the buddy can call you (PushKit + CallKit)
      UIBackgroundModes: ["audio", "voip", "remote-notification"],
      // Dynamic Island / lock screen: focus timer, reminders, workday block, calls
      NSSupportsLiveActivities: true,
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: process.env.ANDROID_PACKAGE ?? "com.nudgebuddy.app",
    adaptiveIcon: {
      // Full-bleed artwork with the mascot inside the adaptive-icon safe zone
      backgroundColor: "#263926",
      foregroundImage: "./assets/android-icon-foreground.png",
    },
    predictiveBackGestureEnabled: false,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? undefined,
  },
  plugins: [
    // Builds targets/widget (the Live Activity extension) into the iOS project
    "@bacons/apple-targets",
    // iOS 27 only launches apps on the scene-based life cycle
    "./plugins/with-scene-lifecycle",
    "expo-router",
    "expo-status-bar",
    "expo-secure-store",
    "expo-web-browser",
    "@react-native-community/datetimepicker",
    [
      "expo-audio",
      {
        microphonePermission: "Nudge Buddy listens while you're on a call with it.",
        enableBackgroundPlayback: true,
      },
    ],
    [
      "expo-notifications",
      {
        color: "#8da38a",
        enableBackgroundRemoteNotifications: true,
      },
    ],
    [
      "expo-splash-screen",
      {
        image: "./assets/splash-icon.png",
        imageWidth: 120,
        resizeMode: "contain",
        backgroundColor: "#151311",
      },
    ],
    [
      "expo-build-properties",
      {
        ios: { deploymentTarget: "16.4" },
        android: { minSdkVersion: 26 },
      },
    ],
    ...(googleIosUrlScheme
      ? ([["@react-native-google-signin/google-signin", { iosUrlScheme: googleIosUrlScheme }]] as [string, object][])
      : []),
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    eas: process.env.EAS_PROJECT_ID ? { projectId: process.env.EAS_PROJECT_ID } : undefined,
  },
});

export default (ctx: ConfigContext): ExpoConfig => {
  const cfg = appConfig(ctx);
  return pushEnabled ? cfg : withoutPushEntitlement(cfg);
};
