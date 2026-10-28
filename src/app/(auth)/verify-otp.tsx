import { useState } from "react";
import { Text, View } from "react-native";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { auth as authApi } from "@/lib/api";
import { firstError } from "@/lib/auth-context";
import { AuthShell } from "@/components/AuthShell";
import { Button, ErrorBanner, Field, Label } from "@/components/ui";

export default function VerifyOtpScreen() {
  const { email = "" } = useLocalSearchParams<{ email?: string }>();
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (!email) return <Redirect href="/forgot-password" />;

  async function handleSubmit() {
    if (otp.length < 4) return;
    setError("");
    setLoading(true);
    try {
      const res = await authApi.verifyOtp({ email, otpCode: otp });
      if (res.ok) router.push({ pathname: "/reset-password", params: { email, otp } });
      else setError(firstError(res.data, "Invalid or expired code."));
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Enter reset code"
      subtitle={<>We sent a code to <Text className="text-on-surface-variant">{email}</Text>.</>}
    >
      <ErrorBanner message={error} />
      <View>
        <Label>Reset code</Label>
        <Field
          value={otp}
          onChangeText={(v) => { setOtp(v.replace(/\D/g, "").slice(0, 6)); setError(""); }}
          placeholder="000000"
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={6}
          className="text-center text-lg tracking-[8px]"
          onSubmitEditing={handleSubmit}
        />
      </View>
      <Button title={loading ? "Verifying…" : "Verify code"} onPress={handleSubmit} loading={loading} disabled={otp.length < 4} />
    </AuthShell>
  );
}
