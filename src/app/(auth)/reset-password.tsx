import { useState } from "react";
import { Text, View } from "react-native";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { auth as authApi } from "@/lib/api";
import { firstError } from "@/lib/auth-context";
import { AuthShell } from "@/components/AuthShell";
import { Button, ErrorBanner, Label, PasswordField } from "@/components/ui";

export default function ResetPasswordScreen() {
  const { email = "", otp = "" } = useLocalSearchParams<{ email?: string; otp?: string }>();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (!email || !otp) return <Redirect href="/forgot-password" />;

  async function handleSubmit() {
    setError("");
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const res = await authApi.resetPassword({ email, otpCode: otp, newPassword });
      if (res.ok) router.dismissTo("/signin");
      else setError(firstError(res.data, "Could not reset password. Please try again."));
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell title="Set new password" subtitle="Choose a strong password for your account.">
      <ErrorBanner message={error} />
      <View>
        <Label>New password</Label>
        <PasswordField value={newPassword} onChangeText={(v) => { setNewPassword(v); setError(""); }} placeholder="••••••••" textContentType="newPassword" />
        <Text className="text-outline text-xs mt-1.5">Minimum 8 characters</Text>
      </View>
      <View>
        <Label>Confirm password</Label>
        <PasswordField
          value={confirmPassword}
          onChangeText={(v) => { setConfirmPassword(v); setError(""); }}
          placeholder="••••••••"
          textContentType="newPassword"
          onSubmitEditing={handleSubmit}
        />
      </View>
      <Button
        title={loading ? "Saving…" : "Reset password"}
        onPress={handleSubmit}
        loading={loading}
        disabled={newPassword.length < 8 || !confirmPassword}
      />
    </AuthShell>
  );
}
