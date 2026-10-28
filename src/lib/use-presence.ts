import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { useWs } from "./ws-context";
import { useVoice } from "./voice/voice-context";

/**
 * Tells the backend whether the user is actually here — the app on screen, or
 * on a call with it. In the background the socket can stay open (or look open
 * while iOS has frozen the app), so without this the server would think the
 * user is in the app and skip the phone notification.
 */
export function usePresence() {
  const { status, send } = useWs();
  const { micActive } = useVoice();
  const [appState, setAppState] = useState(AppState.currentState);

  useEffect(() => {
    const sub = AppState.addEventListener("change", setAppState);
    return () => sub.remove();
  }, []);

  // "inactive" is brief (app switcher, Control Center) — only background counts as away
  const present = appState !== "background" || micActive;
  useEffect(() => {
    if (status === "open") send({ type: "presence", present });
  }, [status, present, send]);
}
