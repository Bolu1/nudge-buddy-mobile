import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import AsyncStorage from "@react-native-async-storage/async-storage";
import VoiceEngine, { type CallPayload } from "@modules/voice-engine";
import { push as pushApi } from "./api";
import { getPref } from "./storage";
import { PREFS } from "./prefs";

// Notifications:
// - Regular pushes (reminders etc. while the app is closed) go through the Expo
//   push service to APNs / FCM.
// - "The buddy is calling" uses VoIP pushes on iOS (PushKit → CallKit, handled
//   natively in modules/voice-engine) and a high-priority data message on
//   Android, which wakes this background task to ring the phone.

export const BACKGROUND_NOTIFICATION_TASK = "nudge-background-notification";
const CALL_PAYLOAD_PREFIX = "nudge:call:";

// Must be defined at module scope so it exists when Android starts JS headless
TaskManager.defineTask<Notifications.NotificationTaskPayload>(BACKGROUND_NOTIFICATION_TASK, async ({ data, error }) => {
  if (error || !data) return Notifications.BackgroundNotificationTaskResult.Failed;
  const payload = parseTaskData(data);
  if (payload?.type === "call" && payload.callId) {
    await rememberCallPayload(payload.callId, payload);
    VoiceEngine.showIncomingCall(payload.callId, payload.title ?? "Nudge Buddy", payload.body ?? "is calling you");
    return Notifications.BackgroundNotificationTaskResult.NewData;
  }
  return Notifications.BackgroundNotificationTaskResult.NoData;
});

function parseTaskData(data: Notifications.NotificationTaskPayload): (CallPayload & { type?: string }) | null {
  const d = (data as { data?: { dataString?: string; [k: string]: unknown } }).data;
  if (!d) return null;
  if (typeof d.dataString === "string") {
    try { return JSON.parse(d.dataString) as CallPayload & { type?: string }; } catch { return null; }
  }
  return d as CallPayload & { type?: string };
}

export async function rememberCallPayload(callId: string, payload: CallPayload) {
  await AsyncStorage.setItem(CALL_PAYLOAD_PREFIX + callId, JSON.stringify(payload)).catch(() => {});
}

export async function takeCallPayload(callId: string): Promise<CallPayload | null> {
  const key = CALL_PAYLOAD_PREFIX + callId;
  const raw = await AsyncStorage.getItem(key).catch(() => null);
  if (raw) AsyncStorage.removeItem(key).catch(() => {});
  try { return raw ? (JSON.parse(raw) as CallPayload) : null; } catch { return null; }
}

// Foreground: the websocket already shows these as in-app toasts and speaks
// them, so a push that races in while the app is open stays quiet.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

let registered: { expoPushToken?: string; voipToken?: string } = {};

/** Ask for permission and register this device's push + VoIP tokens with the backend */
export async function registerForPush(): Promise<void> {
  if (!Device.isDevice) return;
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Reminders",
        importance: Notifications.AndroidImportance.HIGH,
        lightColor: "#8da38a",
      });
      // Android plays the channel's sound, so the phase chime gets its own channel
      await Notifications.setNotificationChannelAsync("focus", {
        name: "Focus timer",
        importance: Notifications.AndroidImportance.HIGH,
        sound: "phase_chime.wav",
        lightColor: "#8da38a",
      });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") ({ status } = await Notifications.requestPermissionsAsync());
    if (status !== "granted") return;

    const projectId =
      (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
      Constants.easConfig?.projectId;
    const expoPushToken = projectId
      ? (await Notifications.getExpoPushTokenAsync({ projectId }).catch(() => null))?.data
      : undefined;
    const voipToken = Platform.OS === "ios" ? (VoiceEngine.getVoipToken() ?? undefined) : undefined;

    await Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK).catch(() => {});

    if (!expoPushToken && !voipToken) return;
    registered = { expoPushToken, voipToken };
    await pushApi.registerDevice({
      platform: Platform.OS === "ios" ? "ios" : "android",
      expoPushToken,
      voipToken,
      deviceName: Device.deviceName ?? undefined,
      callsEnabled: getPref(PREFS.callsEnabled) !== "0",
    });
  } catch (e) {
    console.warn("[push] registration failed", e);
  }
}

/** PushKit hands out its token asynchronously — re-register when it arrives */
export function watchVoipToken(): () => void {
  if (Platform.OS !== "ios") return () => {};
  const sub = VoiceEngine.addListener("onVoipToken", ({ token }) => {
    if (token !== registered.voipToken) void registerForPush();
  });
  return () => sub.remove();
}

export async function unregisterPush(): Promise<void> {
  if (!registered.expoPushToken && !registered.voipToken) return;
  await pushApi.unregisterDevice(registered).catch(() => {});
  registered = {};
}
