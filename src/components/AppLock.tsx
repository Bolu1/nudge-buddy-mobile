import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Modal, Pressable, Text, View } from "react-native";
import { useAuth } from "@/lib/auth-context";
import { appLockEnabled, authenticate, biometricLabel, setAppLock } from "@/lib/app-lock";
import { useVoice } from "@/lib/voice/voice-context";
import { Button } from "@/components/ui";
import { Mascot } from "@/components/Mascot";

/** Coming back after this long in the background asks to unlock again */
const LOCK_AFTER_MS = 30_000;
/** iOS refuses Face ID while the app is still becoming active — give it a moment */
const PROMPT_DELAY_MS = 350;

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
  // Cancelling (or failing) Face ID shouldn't bring it straight back — wait until they leave and return
  const userCancelled = useRef(false);
  const micActiveRef = useRef(micActive);
  useEffect(() => { micActiveRef.current = micActive; }, [micActive]);

  const unlock = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    const result = await authenticate();
    prompting.current = false;
    if (result === "ok") setLocked(false);
    else if (result === "refused") userCancelled.current = true;
  }, []);

  useEffect(() => { void biometricLabel().then((l) => { if (l) setLabel(l); }); }, []);

  // Whoever signs in next on this phone starts without the lock
  useEffect(() => registerBeforeSignOut(() => { void setAppLock(false); }), [registerBeforeSignOut]);

  // Start Face ID by itself whenever the lock is up and the app is on screen —
  // at launch the app isn't active yet, so also wait for it to become active
  useEffect(() => {
    if (!locked) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = () => {
      if (userCancelled.current) return;
      clearTimeout(timer);
      timer = setTimeout(() => void unlock(), PROMPT_DELAY_MS);
    };
    if (AppState.currentState === "active") ask();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "background") userCancelled.current = false;
      if (s === "active") ask();
    });
    return () => { clearTimeout(timer); sub.remove(); };
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
        <Mascot size={96} variant="full" animated />
        {locked ? (
          <>
            <View className="items-center gap-1.5">
              <Text className="text-on-surface text-lg font-semibold">Nudge Buddy is locked</Text>
              <Text className="text-outline text-sm text-center">Use {label} to open the app.</Text>
            </View>
            <View className="w-full gap-3">
              <Button title={`Unlock with ${label}`} onPress={() => { userCancelled.current = false; void unlock(); }} />
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
