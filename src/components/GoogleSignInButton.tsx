import { useState } from "react";
import { Platform, Pressable, Text } from "react-native";
import { GoogleSignin, isErrorWithCode, isSuccessResponse, statusCodes } from "@react-native-google-signin/google-signin";
import { auth as authApi } from "@/lib/api";
import { extractTokens, firstError, useAuth } from "@/lib/auth-context";
import { GOOGLE_IOS_CLIENT_ID, GOOGLE_WEB_CLIENT_ID } from "@/lib/config";
import { GoogleIcon } from "./ui";

let configured = false;

/** Native Google sign-in → ID token → the same /auth/google endpoint the web uses */
export function GoogleSignInButton({ onError }: { onError: (msg: string) => void }) {
  const { signIn } = useAuth();
  const [loading, setLoading] = useState(false);

  // The backend verifies tokens against the web client id; without it, hide the button
  if (!GOOGLE_WEB_CLIENT_ID || (Platform.OS === "ios" && !GOOGLE_IOS_CLIENT_ID)) return null;

  async function handlePress() {
    if (!configured) {
      GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID, iosClientId: GOOGLE_IOS_CLIENT_ID || undefined });
      configured = true;
    }
    setLoading(true);
    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const result = await GoogleSignin.signIn();
      if (!isSuccessResponse(result)) return; // cancelled
      const idToken = result.data.idToken;
      if (!idToken) { onError("Google sign-in failed."); return; }
      const res = await authApi.google({ token: idToken });
      const { accessToken, refreshToken } = extractTokens(res.data);
      if (res.ok && accessToken) await signIn(accessToken, refreshToken);
      else onError(firstError(res.data, "Google sign-in failed."));
    } catch (e) {
      if (isErrorWithCode(e) && e.code === statusCodes.SIGN_IN_CANCELLED) return;
      if (isErrorWithCode(e) && e.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        onError("Google Play Services isn't available on this device.");
        return;
      }
      onError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Pressable
      onPress={handlePress}
      disabled={loading}
      className={`flex-row items-center justify-center gap-3 bg-surface-high active:bg-surface-highest py-3 px-4 rounded-full border border-outline-variant ${loading ? "opacity-50" : ""}`}
    >
      <GoogleIcon />
      <Text className="text-on-surface text-sm font-medium">{loading ? "Signing in…" : "Continue with Google"}</Text>
    </Pressable>
  );
}
