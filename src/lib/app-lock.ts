import * as LocalAuthentication from "expo-local-authentication";
import { Platform } from "react-native";
import { getPref, setPref } from "./storage";
import { PREFS } from "./prefs";

// Optional App lock: Face ID / Touch ID / fingerprint (or the phone's passcode
// as a fallback) to open the app. Per device — it's about who holds the phone.

export function appLockEnabled(): boolean {
  return getPref(PREFS.appLock) === "1";
}

/** What the phone calls its biometrics ("Face ID", "Fingerprint"…), or null if none is set up */
export async function biometricLabel(): Promise<string | null> {
  try {
    if (!(await LocalAuthentication.hasHardwareAsync()) || !(await LocalAuthentication.isEnrolledAsync())) return null;
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    const { FACIAL_RECOGNITION, FINGERPRINT, IRIS } = LocalAuthentication.AuthenticationType;
    if (Platform.OS === "ios") return types.includes(FACIAL_RECOGNITION) ? "Face ID" : "Touch ID";
    if (types.includes(FINGERPRINT)) return "Fingerprint";
    if (types.includes(FACIAL_RECOGNITION)) return "Face unlock";
    if (types.includes(IRIS)) return "Iris unlock";
    return "Biometrics";
  } catch {
    return null;
  }
}

/** iOS / Android stopped the prompt (app went inactive, another prompt…) — worth asking again */
const INTERRUPTED = new Set(["system_cancel", "app_cancel", "not_interactive"]);

/**
 * Ask for biometrics (the phone's passcode is offered if they fail).
 * "interrupted": the system cut it short, so asking again is fine.
 * "refused": cancelled by the person, or biometrics failed — don't keep asking.
 */
export async function authenticate(reason = "Unlock Nudge Buddy"): Promise<"ok" | "interrupted" | "refused"> {
  try {
    const res = await LocalAuthentication.authenticateAsync({ promptMessage: reason, cancelLabel: "Cancel" });
    if (res.success) return "ok";
    return INTERRUPTED.has(res.error) ? "interrupted" : "refused";
  } catch {
    return "interrupted";
  }
}

/** Turning it on needs a successful check first, so nobody locks themselves out */
export async function setAppLock(on: boolean): Promise<boolean> {
  if (on && (await authenticate("Turn on App lock")) !== "ok") return false;
  setPref(PREFS.appLock, on ? "1" : null);
  return true;
}
