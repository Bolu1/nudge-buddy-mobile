import { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { Link, router } from "expo-router";
import * as Device from "expo-device";
import { auth as authApi } from "@/lib/api";
import { extractTokens, firstError, useAuth } from "@/lib/auth-context";
import { AuthShell } from "@/components/AuthShell";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { Button, ErrorBanner, Field, Label, PasswordField } from "@/components/ui";

export default function SignInScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!email.trim() || !password) return;
    setError("");
    setLoading(true);
    try {
      const res = await authApi.login({
        email: email.trim(),
        password,
        deviceInfo: [Device.manufacturer, Device.modelName].filter(Boolean).join(" ") || undefined,
        platform: Platform.OS,
      });
      if (res.status === 403) {
        router.push({ pathname: "/activate-account", params: { email: email.trim() } });
        return;
      }
      const { accessToken, refreshToken } = extractTokens(res.data);
      if (res.ok && accessToken) await signIn(accessToken, refreshToken);
      else setError(firstError(res.data, "Invalid email or password."));
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Stay present."
      footer={
        <Text className="text-outline text-sm">
          New to Nudge Buddy?{" "}
          <Link href="/signup" className="text-primary font-medium">
            Create an account
          </Link>
        </Text>
      }
    >
      <GoogleSignInButton onError={setError} />
      <ErrorBanner message={error} />
      <View>
        <Label>Email</Label>
        <Field
          value={email}
          onChangeText={(v) => { setEmail(v); setError(""); }}
          placeholder="you@example.com"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="next"
        />
      </View>
      <View>
        <View className="flex-row items-center justify-between mb-2">
          <Text className="text-outline text-xs font-medium tracking-wide uppercase">Password</Text>
          <Link href="/forgot-password" asChild>
            <Pressable hitSlop={8}>
              <Text className="text-primary-container text-xs">Forgot?</Text>
            </Pressable>
          </Link>
        </View>
        <PasswordField
          value={password}
          onChangeText={(v) => { setPassword(v); setError(""); }}
          placeholder="••••••••"
          autoComplete="password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={handleSubmit}
        />
      </View>
      <Button title={loading ? "Signing in…" : "Sign in"} onPress={handleSubmit} loading={loading} disabled={!email.trim() || !password} className="mt-1" />
    </AuthShell>
  );
}
