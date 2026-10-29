import { useCallback, useEffect, useState } from "react";
import { Alert, AppState, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "@/components/ui/SafeArea";
import * as WebBrowser from "expo-web-browser";
import { account, calendar, payment, subscriptionPlans } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { AMBIENT_TRACKS_INFO, MUSIC_CATEGORIES, type MusicCategory } from "@/lib/music";
import { getPref, setPref } from "@/lib/storage";
import { PREFS } from "@/lib/prefs";
import { registerForPush } from "@/lib/push";
import { appLockEnabled, biometricLabel, setAppLock } from "@/lib/app-lock";
import { colors } from "@/lib/theme";
import { useToast } from "@/lib/toast-context";
import { useVoice } from "@/lib/voice/voice-context";
import { VOICES } from "@/lib/voices";
import { Button, ErrorBanner, Field, Icon, Label, PasswordField, ScreenHeader, Toggle } from "@/components/ui";

interface Profile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  timezone: string;
  subscription: { status: string; plan: { name: string; price: string; interval: string } | null } | null;
}

interface Plan {
  id: string;
  name: string;
  description: string;
  price: string;
  currency: string;
  interval: string;
}

interface UsagePeriod { used: number; limit: number; percentage: number }
interface TokenUsage { daily: UsagePeriod; monthly: UsagePeriod }

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="bg-surface-low border border-divider rounded-2xl p-4 gap-3">
      <Text className="text-on-surface text-sm font-semibold">{title}</Text>
      {children}
    </View>
  );
}

function Row({ title, sub, right }: { title: string; sub?: string; right: React.ReactNode }) {
  return (
    <View className="flex-row items-center gap-3 py-1">
      <View className="flex-1">
        <Text className="text-on-surface-variant text-sm">{title}</Text>
        {sub ? <Text className="text-outline text-xs mt-0.5 leading-4">{sub}</Text> : null}
      </View>
      {right}
    </View>
  );
}

function UsageBar({ label, p }: { label: string; p: UsagePeriod }) {
  return (
    <View className="gap-1.5">
      <View className="flex-row justify-between">
        <Text className="text-on-surface-variant text-xs">{label}</Text>
        <Text className="text-outline text-xs">{p.used.toLocaleString()} / {p.limit.toLocaleString()}</Text>
      </View>
      <View className="h-1.5 rounded-full bg-surface-high overflow-hidden">
        <View className="h-full rounded-full" style={{ width: `${Math.min(100, p.percentage)}%`, backgroundColor: p.percentage >= 90 ? colors.error : colors.primaryContainer }} />
      </View>
    </View>
  );
}

export default function SettingsScreen() {
  const toast = useToast();
  const { signOut } = useAuth();
  const voice = useVoice();
  const { isPremium, selectedVoiceId, setVoiceId, previewVoice, musicMixCats, musicOffTracks, musicLoopSrc, setMusicMix, setMusicLoop } = voice;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState("");
  const [usage, setUsage] = useState<TokenUsage | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [callsEnabled, setCallsEnabled] = useState(() => getPref(PREFS.callsEnabled) !== "0");
  const [hapticsOn, setHapticsOn] = useState(() => getPref(PREFS.haptics) === "1");
  const [appLock, setAppLockState] = useState(appLockEnabled);
  // undefined while checking; null when the phone has no biometrics set up
  const [lockLabel, setLockLabel] = useState<string | null | undefined>(undefined);
  const [cancelling, setCancelling] = useState(false);

  const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const loadProfile = useCallback(async () => {
    const res = await account.getProfile().catch(() => null);
    const p = (res?.data as { data?: Profile } | null)?.data;
    if (p) { setProfile(p); setFirstName(p.firstName); setLastName(p.lastName); }
  }, []);

  const checkCalendar = useCallback(async () => {
    const res = await calendar.status().catch(() => null);
    const d = res?.data as { connected?: boolean; data?: { connected?: boolean } } | null;
    setCalendarConnected(!!res?.ok && !!(d?.connected ?? d?.data?.connected));
  }, []);

  useEffect(() => {
    loadProfile();
    checkCalendar();
    account.getTokenUsage().then((res) => {
      const raw = res.data as ({ data?: TokenUsage } & Partial<TokenUsage>) | null;
      const data = raw?.data ?? raw;
      if (data?.daily && data?.monthly) setUsage(data as TokenUsage);
    }).catch(() => {});
    subscriptionPlans.getAll().then((res) => setPlans((res.data as { data?: Plan[] } | null)?.data ?? [])).catch(() => {});
    void biometricLabel().then(setLockLabel);
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") checkCalendar(); });
    return () => sub.remove();
  }, [loadProfile, checkCalendar]);

  async function saveProfile() {
    setSavingProfile(true);
    try {
      const res = await account.updateProfile({ firstName: firstName.trim(), lastName: lastName.trim(), timezone: deviceTz });
      if (res.ok) { toast.success("Profile saved"); loadProfile(); }
      else toast.error((res.data as { errors?: string[] } | null)?.errors?.[0] ?? "Failed to save.");
    } catch {
      toast.error("Network error.");
    } finally {
      setSavingProfile(false);
    }
  }

  async function changePassword() {
    setPwError("");
    setPwSaving(true);
    try {
      const res = await account.changePassword({ currentPassword, newPassword });
      if (res.ok) { toast.success("Password changed."); setCurrentPassword(""); setNewPassword(""); }
      else setPwError((res.data as { errors?: string[] } | null)?.errors?.[0] ?? "Failed to change password.");
    } catch {
      setPwError("Network error.");
    } finally {
      setPwSaving(false);
    }
  }

  async function toggleAppLock(on: boolean) {
    if (await setAppLock(on)) setAppLockState(on);
  }

  function toggleCalls(on: boolean) {
    setCallsEnabled(on);
    setPref(PREFS.callsEnabled, on ? "1" : "0");
    void registerForPush();
  }

  function toggleHaptics(on: boolean) {
    setHapticsOn(on);
    setPref(PREFS.haptics, on ? "1" : "0");
  }

  async function connectCalendar() {
    setCalendarBusy(true);
    try {
      const res = await calendar.connect();
      const d = res.data as { data?: { authorizationUrl?: string } | string; authorizationUrl?: string } | null;
      const url = (typeof d?.data === "object" ? d.data?.authorizationUrl : typeof d?.data === "string" ? d.data : undefined) ?? d?.authorizationUrl;
      if (res.ok && url) {
        await WebBrowser.openBrowserAsync(url);
        await checkCalendar();
      } else {
        toast.error("Could not start Google Calendar connection.");
      }
    } catch {
      toast.error("Network error.");
    } finally {
      setCalendarBusy(false);
    }
  }

  function disconnectCalendar() {
    Alert.alert("Disconnect Google Calendar?", "You can reconnect at any time.", [
      { text: "Cancel", style: "cancel" },
      { text: "Disconnect", style: "destructive", onPress: async () => { await calendar.disconnect().catch(() => {}); setCalendarConnected(false); } },
    ]);
  }

  function cancelSubscription() {
    Alert.alert("Cancel subscription?", "You'll keep access until the end of the current period.", [
      { text: "Keep it", style: "cancel" },
      {
        text: "Cancel subscription",
        style: "destructive",
        onPress: async () => {
          setCancelling(true);
          const res = await payment.cancelSubscription().catch(() => null);
          setCancelling(false);
          if (res?.ok) loadProfile();
          else toast.error("Failed to cancel subscription.");
        },
      },
    ]);
  }

  function confirmSignOut() {
    Alert.alert("Sign out?", undefined, [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => { voice.endSession(); void signOut(); } },
    ]);
  }

  function confirmDelete() {
    Alert.alert(
      "Delete your account?",
      "This permanently removes your focus data, tasks, reminders and notes. It can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete account",
          style: "destructive",
          onPress: async () => {
            const res = await account.deleteAccount().catch(() => null);
            if (res?.ok) { voice.endSession(); await signOut(); }
            else toast.error("Couldn't delete your account. Please try again.");
          },
        },
      ],
    );
  }

  // Music: Vibe + Jazz mix freely; Nature / White Noise loop one track exclusively
  function toggleMixCat(cat: MusicCategory) {
    const next = musicMixCats.includes(cat) ? musicMixCats.filter((c) => c !== cat) : [...musicMixCats, cat];
    const catSrcs = AMBIENT_TRACKS_INFO.filter((t) => t.category === cat).map((t) => t.src);
    setMusicMix(next, musicOffTracks.filter((s) => !catSrcs.includes(s)));
  }

  const sub = profile?.subscription;

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-bg">
      <ScreenHeader title="Settings" />
      <KeyboardAvoidingView behavior="padding" className="flex-1">
      <ScrollView contentContainerClassName="p-4 gap-4 pb-32" keyboardShouldPersistTaps="handled">
        <Section title="Profile">
          <View className="flex-row gap-3">
            <View className="flex-1"><Label>First name</Label><Field value={firstName} onChangeText={setFirstName} /></View>
            <View className="flex-1"><Label>Last name</Label><Field value={lastName} onChangeText={setLastName} /></View>
          </View>
          <View>
            <Label>Email</Label>
            <Text className="text-on-surface-variant text-sm px-1">{profile?.email ?? "…"}</Text>
          </View>
          <View>
            <Label>Timezone</Label>
            <Text className="text-on-surface-variant text-sm px-1">{deviceTz}{profile && profile.timezone !== deviceTz ? ` (saved: ${profile.timezone})` : ""}</Text>
            <Text className="text-outline text-xs px-1 mt-1">Follows this phone&apos;s timezone.</Text>
          </View>
          <Button title={savingProfile ? "Saving…" : "Save profile"} variant="tonal" onPress={saveProfile} loading={savingProfile} disabled={!firstName.trim() || !lastName.trim()} />
        </Section>

        <Section title="Change password">
          <ErrorBanner message={pwError} />
          <PasswordField value={currentPassword} onChangeText={setCurrentPassword} placeholder="Current password" textContentType="password" />
          <PasswordField value={newPassword} onChangeText={setNewPassword} placeholder="New password (min 8 characters)" textContentType="newPassword" />
          <Button title={pwSaving ? "Saving…" : "Change password"} variant="tonal" onPress={changePassword} loading={pwSaving} disabled={!currentPassword || newPassword.length < 8} />
        </Section>

        <Section title="Security">
          <Row
            title="App lock"
            sub={
              lockLabel === null
                ? "Set up Face ID, Touch ID or a fingerprint in your phone's settings to use App lock."
                : `Require ${lockLabel ?? "biometrics"} to open Nudge Buddy. Your phone's passcode works as a backup.`
            }
            right={<Toggle value={appLock} onChange={(v) => void toggleAppLock(v)} disabled={lockLabel === null && !appLock} />}
          />
        </Section>

        <Section title="Feedback">
          <Row
            title="Haptics"
            sub="Gentle vibrations when you tick things off, switch options or finish a session."
            right={<Toggle value={hapticsOn} onChange={toggleHaptics} />}
          />
        </Section>

        <Section title="Calls">
          <Row
            title="Let Nudge Buddy call me"
            sub="When a reminder is due and the app is closed, your buddy rings you like a phone call so you can talk it through."
            right={<Toggle value={callsEnabled} onChange={toggleCalls} />}
          />
        </Section>

        <Section title="AI voice">
          {VOICES.map((v) => {
            const locked = v.premium && !isPremium;
            const selected = v.id === selectedVoiceId;
            return (
              <Pressable
                key={v.id}
                disabled={locked}
                onPress={() => setVoiceId(v.id)}
                className={`flex-row items-center gap-3 px-3 py-3 rounded-xl border ${selected ? "bg-on-primary-container/50 border-primary-container" : "border-divider"} ${locked ? "opacity-50" : ""}`}
              >
                <View className="flex-1">
                  <Text className="text-on-surface text-sm font-medium">{v.label}{v.premium ? <Text className="text-gold text-xs"> · Plus</Text> : null}</Text>
                  <Text className="text-outline text-xs mt-0.5">{v.description}</Text>
                </View>
                <Pressable onPress={() => previewVoice(v.id)} hitSlop={8} className="w-9 h-9 rounded-full bg-surface-high items-center justify-center" accessibilityLabel={`Preview ${v.label}`}>
                  <Icon name="volume-2" size={15} color={colors.onSurfaceVariant} />
                </Pressable>
                {selected ? <Icon name="check" size={16} color={colors.primaryContainer} /> : <View className="w-4" />}
              </Pressable>
            );
          })}
        </Section>

        <Section title="Background music">
          <Text className="text-outline text-xs -mt-1">Plays after a minute of quiet on a call. Mix Vibe + Jazz freely; Nature and White Noise loop one track.</Text>
          <View className="flex-row flex-wrap gap-2">
            {MUSIC_CATEGORIES.filter((c) => !c.exclusive).map((c) => {
              const on = !musicLoopSrc && musicMixCats.includes(c.id);
              const locked = c.premium && !isPremium;
              return (
                <Pressable
                  key={c.id}
                  disabled={locked}
                  onPress={() => (musicLoopSrc ? setMusicMix([c.id], []) : toggleMixCat(c.id))}
                  className={`px-4 py-2 rounded-full border ${on ? "bg-on-primary-container border-primary-container" : "border-divider"} ${locked ? "opacity-50" : ""}`}
                >
                  <Text className={`text-sm ${on ? "text-primary" : "text-on-surface-variant"}`}>{c.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {MUSIC_CATEGORIES.filter((c) => c.exclusive).map((c) => (
            <View key={c.id} className="gap-1.5">
              <Text className="text-outline text-[11px] uppercase tracking-widest mt-1">{c.label} · loop</Text>
              {AMBIENT_TRACKS_INFO.filter((t) => t.category === c.id).map((t) => {
                const selected = musicLoopSrc === t.src;
                const locked = t.premium && !isPremium;
                return (
                  <Pressable
                    key={t.src}
                    disabled={locked}
                    onPress={() => setMusicLoop(selected ? null : t.src)}
                    className={`flex-row items-center justify-between px-3 py-2.5 rounded-xl ${selected ? "bg-on-primary-container/60" : "active:bg-surface-high"} ${locked ? "opacity-50" : ""}`}
                  >
                    <Text className={`text-sm ${selected ? "text-primary" : "text-on-surface-variant"}`}>{t.label}</Text>
                    {selected ? <Icon name="check" size={15} color={colors.primaryContainer} /> : null}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </Section>

        <Section title="Subscription">
          <Row
            title={sub?.plan?.name ?? "Free"}
            sub={sub?.status ? `Status: ${sub.status.toLowerCase()}` : "No active subscription"}
            right={sub?.status === "ACTIVE" && sub.plan?.price !== "0" ? (
              <Button title={cancelling ? "…" : "Cancel"} size="sm" variant="outline" onPress={cancelSubscription} disabled={cancelling} />
            ) : null}
          />
          {usage ? (
            <View className="gap-3 mt-1">
              <UsageBar label="AI usage today" p={usage.daily} />
              <UsageBar label="AI usage this month" p={usage.monthly} />
            </View>
          ) : null}
          {plans.length ? (
            <View className="gap-2 mt-1">
              {plans.map((p) => (
                <View key={p.id} className="flex-row items-center justify-between px-3 py-2.5 rounded-xl border border-divider">
                  <View className="flex-1">
                    <Text className="text-on-surface-variant text-sm font-medium">{p.name}{sub?.plan?.name === p.name ? <Text className="text-primary text-xs"> · Current</Text> : null}</Text>
                    {p.description ? <Text className="text-outline text-xs mt-0.5" numberOfLines={2}>{p.description}</Text> : null}
                  </View>
                  <Text className="text-outline text-xs">{p.price === "0" ? "Free" : `${p.currency} ${p.price}/${p.interval.toLowerCase()}`}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {/* App Store / Play rules: digital subscriptions can't be sold here through Paystack */}
          <Text className="text-outline text-xs">Plans are managed from the Nudge Buddy website.</Text>
        </Section>

        <Section title="Integrations">
          <Row
            title="Google Calendar"
            sub={calendarConnected ? "Connected" : "See events and let your buddy add to your calendar"}
            right={calendarConnected
              ? <Button title="Disconnect" size="sm" variant="outline" onPress={disconnectCalendar} />
              : <Button title={calendarBusy ? "…" : "Connect"} size="sm" variant="tonal" onPress={connectCalendar} disabled={calendarBusy} />}
          />
        </Section>

        <Button title="Sign out" icon="log-out" variant="outline" onPress={confirmSignOut} />

        <View className="bg-[#3b0e0e]/20 border border-error-container/30 rounded-2xl p-4 gap-3">
          <Text className="text-error text-sm font-semibold">Danger zone</Text>
          <Text className="text-outline text-xs leading-4">Deleting your account permanently removes all your focus data, tasks, reminders, and notes.</Text>
          <Button title="Delete account" variant="danger" onPress={confirmDelete} />
        </View>

        <Text className="text-outline text-[11px] text-center">Nudge Buddy · {Platform.OS === "ios" ? "iOS" : "Android"}</Text>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
