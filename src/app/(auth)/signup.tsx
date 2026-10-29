import { useState } from "react";
import { Text, View } from "react-native";
import { Link, router } from "expo-router";
import { auth as authApi } from "@/lib/api";
import { firstError } from "@/lib/auth-context";
import { AuthShell } from "@/components/AuthShell";
import { AppleSignInButton } from "@/components/AppleSignInButton";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { Button, ErrorBanner, Field, Label, PasswordField } from "@/components/ui";

export default function SignUpScreen() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const canSubmit = firstName.trim() && lastName.trim() && email.trim() && password.length >= 8 && confirmPassword;

  async function handleSubmit() {
    if (!canSubmit) return;
    setError("");
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const res = await authApi.signup({
        email: email.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        password,
        confirmPassword,
      });
      if (res.ok) router.push({ pathname: "/activate-account", params: { email: email.trim() } });
      else setError(firstError(res.data, "Something went wrong. Please try again."));
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const clear = <T,>(set: (v: T) => void) => (v: T) => { set(v); setError(""); };

  return (
    <AuthShell
      title="Create your account"
      subtitle="Focus First Methodology."
      footer={
        <Text className="text-outline text-sm">
          Already have an account?{" "}
          <Link href="/signin" className="text-primary font-medium">
            Sign in
          </Link>
        </Text>
      }
    >
      <AppleSignInButton onError={setError} />
      <GoogleSignInButton onError={setError} />
      <ErrorBanner message={error} />
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Label>First name</Label>
          <Field value={firstName} onChangeText={clear(setFirstName)} placeholder="John" autoComplete="given-name" textContentType="givenName" />
        </View>
        <View className="flex-1">
          <Label>Last name</Label>
          <Field value={lastName} onChangeText={clear(setLastName)} placeholder="Doe" autoComplete="family-name" textContentType="familyName" />
        </View>
      </View>
      <View>
        <Label>Email</Label>
        <Field
          value={email}
          onChangeText={clear(setEmail)}
          placeholder="you@example.com"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
        />
      </View>
      <View>
        <Label>Password</Label>
        <PasswordField value={password} onChangeText={clear(setPassword)} placeholder="••••••••" autoComplete="new-password" textContentType="newPassword" />
        <Text className="text-outline-variant text-xs mt-1.5">Minimum 8 characters</Text>
      </View>
      <View>
        <Label>Confirm password</Label>
        <PasswordField
          value={confirmPassword}
          onChangeText={clear(setConfirmPassword)}
          placeholder="••••••••"
          autoComplete="new-password"
          textContentType="newPassword"
          onSubmitEditing={handleSubmit}
        />
      </View>
      <Button title={loading ? "Creating account…" : "Create account"} onPress={handleSubmit} loading={loading} disabled={!canSubmit} className="mt-1" />
    </AuthShell>
  );
}
