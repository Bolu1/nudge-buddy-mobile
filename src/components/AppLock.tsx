import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Modal, Pressable, Text, View } from "react-native";
import { useAuth } from "@/lib/auth-context";
import { appLockEnabled, authenticate, biometricLabel, setAppLock } from "@/lib/app-lock";
import { useVoice } from "@/lib/voice/voice-context";
import { Button } from "@/components/ui";
import { Mascot } from "@/components/Mascot";

/** Coming back after this long in the background asks to unlock again */
const LOCK_AFTER_MS = 30_000;

/**
 * App lock screen (when turned on in Settings). Locks on launch and after the
 * app has been in the background for a while, never in the middle of a call.
 * While the app isn't active it also covers the screen, so the app switcher
 * doesn't show tasks or notes.
 */
export function AppLock() {
  const { signOut, registerBeforeSignOut } = useAuth();
  const { micActive } = useVoice();
  const [locked, setLocked] = useState(appLockEnabled);
  const [covered, setCovered] = useState(false);
  const [label, setLabel] = useState("Face ID");
  const backgroundedAt = useRef<number | null>(null);
  const prompting = useRef(false);
  const micActiveRef = useRef(micActive);
  useEffect(() => { micActiveRef.current = micActive; }, [micActive]);

  const unlock = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    const ok = await authenticate();
    prompting.current = false;
    if (ok) setLocked(false);
  }, []);

  useEffect(() => { void biometricLabel().then((l) => { if (l) setLabel(l); }); }, []);

  // Whoever signs in next on this phone starts without the lock
  useEffect(() => registerBeforeSignOut(() => { void setAppLock(false); }), [registerBeforeSignOut]);

  // Ask straight away whenever the lock comes up with the app on screen
  useEffect(() => {
    if (locked && AppState.currentState === "active") void unlock();
  }, [locked, unlock]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (!appLockEnabled()) { setCovered(false); return; }
      // The biometric prompt itself only makes the app "inactive", never "background"
      if (s === "background") backgroundedAt.current = Date.now();
      setCovered(s !== "active");
      if (s !== "active") return;
      const awaySince = backgroundedAt.current;
      backgroundedAt.current = null;
      if (awaySince && Date.now() - awaySince > LOCK_AFTER_MS && !micActiveRef.current) setLocked(true);
    });
    return () => sub.remove();
  }, []);

  if (!locked && !covered) return null;

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" statusBarTranslucent onRequestClose={() => {}}>
      <View className="flex-1 bg-bg items-center justify-center px-8 gap-6">
        <Mascot size={96} variant="full" />
        {locked ? (
          <>
            <View className="items-center gap-1.5">
              <Text className="text-on-surface text-lg font-semibold">Nudge Buddy is locked</Text>
              <Text className="text-outline text-sm text-center">Use {label} to open the app.</Text>
            </View>
            <View className="w-full gap-3">
              <Button title={`Unlock with ${label}`} onPress={() => void unlock()} />
              <Pressable onPress={() => void signOut()} hitSlop={8} className="py-2 items-center">
                <Text className="text-outline text-sm">Sign out</Text>
              </Pressable>
            </View>
          </>
        ) : null}
      </View>
    </Modal>
  );
}
