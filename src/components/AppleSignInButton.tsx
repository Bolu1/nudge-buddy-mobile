import { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import { auth as authApi } from "@/lib/api";
import { extractTokens, firstError, useAuth } from "@/lib/auth-context";

/**
 * Sign in with Apple (iOS only) → identity token → /auth/apple. Uses Apple's
 * own button, as the App Store guidelines ask.
 */
export function AppleSignInButton({ onError }: { onError: (msg: string) => void }) {
  const { signIn } = useAuth();
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    AppleAuthentication.isAvailableAsync().then(setAvailable).catch(() => {});
  }, []);

  if (!available) return null;

  async function handlePress() {
    if (loading) return;
    setLoading(true);
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
      });
      if (!credential.identityToken) { onError("Apple sign-in failed."); return; }
      const res = await authApi.apple({
        identityToken: credential.identityToken,
        authorizationCode: credential.authorizationCode ?? undefined,
        // Apple only shares the name the first time; the server ignores it afterwards
        firstName: credential.fullName?.givenName ?? undefined,
        lastName: credential.fullName?.familyName ?? undefined,
      });
      const { accessToken, refreshToken } = extractTokens(res.data);
      if (res.ok && accessToken) await signIn(accessToken, refreshToken);
      else onError(firstError(res.data, "Apple sign-in failed."));
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "ERR_REQUEST_CANCELED") return;
      onError(code ? `Apple sign-in failed (${code}). Please try again.` : "Apple sign-in failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={{ opacity: loading ? 0.5 : 1 }} pointerEvents={loading ? "none" : "auto"}>
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
        cornerRadius={999}
        style={{ height: 46, width: "100%" }}
        onPress={handlePress}
      />
    </View>
  );
}
