import { useState } from "react";
import { View } from "react-native";
import { Link, router } from "expo-router";
import { auth as authApi } from "@/lib/api";
import { AuthShell } from "@/components/AuthShell";
import { Button, ErrorBanner, Field, Label } from "@/components/ui";

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!email.trim()) return;
    setError("");
    setLoading(true);
    try {
      await authApi.forgotPassword({ email: email.trim() });
      router.push({ pathname: "/verify-otp", params: { email: email.trim() } });
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter your email and we'll send a reset code if an account exists."
      footer={
        <Link href="/signin" className="text-primary text-sm font-medium">
          Back to sign in
        </Link>
      }
    >
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
          onSubmitEditing={handleSubmit}
        />
      </View>
      <Button title={loading ? "Sending…" : "Send reset code"} onPress={handleSubmit} loading={loading} disabled={!email.trim()} />
    </AuthShell>
  );
}
