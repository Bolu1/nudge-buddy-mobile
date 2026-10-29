import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { auth as authApi } from "@/lib/api";
import { firstError } from "@/lib/auth-context";
import { AuthShell } from "@/components/AuthShell";
import { Button, ErrorBanner, Field, InfoBanner, Label } from "@/components/ui";

export default function ActivateAccountScreen() {
  const { email = "" } = useLocalSearchParams<{ email?: string }>();
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  if (!email) return <Redirect href="/signup" />;

  async function handleSubmit() {
    if (otp.length < 4) return;
    setError("");
    setLoading(true);
    try {
      const res = await authApi.activateAccount({ email, otpCode: otp });
      if (res.ok) router.replace("/signin");
      else setError(firstError(res.data, "Invalid code. Please try again."));
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setError("");
    setSuccess("");
    setResending(true);
    try {
      await authApi.resendOtp({ email });
      setSuccess("A new code is on its way.");
      setCountdown(60);
    } catch {
      setError("Could not resend. Please try again.");
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthShell
      title="Check your email"
      subtitle={
        <>
          Enter the activation code we sent to <Text className="text-on-surface-variant">{email}</Text>.{"\n"}
          Don&apos;t see it? Check your spam or junk folder.
        </>
      }
      footer={
        <View className="flex-row items-center">
          <Text className="text-outline text-sm">Didn&apos;t receive it? </Text>
          {countdown > 0 ? (
            <Text className="text-outline text-sm font-medium">Resend in {countdown}s</Text>
          ) : (
            <Pressable onPress={handleResend} disabled={resending} hitSlop={8}>
              <Text className="text-primary-container text-sm font-medium">{resending ? "Sending…" : "Resend code"}</Text>
            </Pressable>
          )}
        </View>
      }
    >
      <ErrorBanner message={error} />
      <InfoBanner message={success} />
      <View>
        <Label>Activation code</Label>
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
      <Button title={loading ? "Verifying…" : "Activate account"} onPress={handleSubmit} loading={loading} disabled={otp.length < 4} />
    </AuthShell>
  );
}
