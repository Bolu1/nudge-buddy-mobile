import { NativeModule, requireOptionalNativeModule } from "expo";

export type LiveKind = "focus" | "reminder" | "block" | "call";

export type LiveState = {
  title: string;
  subtitle: string;
  /** epoch seconds */
  startEpoch?: number | null;
  /** epoch seconds — the island counts down to this */
  endEpoch?: number | null;
  paused?: boolean;
  pausedRemaining?: number | null;
  status?: string | null;
  colorHex: string;
  /** SF Symbol name */
  symbol: string;
};

export type LiveActivityEvents = {
  onPushToken: (e: { id: string; kind: LiveKind; token: string }) => void;
  onPushToStartToken: (e: { token: string }) => void;
  onActivityEnded: (e: { id: string; kind: LiveKind }) => void;
};

declare class LiveActivityModule extends NativeModule<LiveActivityEvents> {
  areActivitiesEnabled(): boolean;
  list(): { id: string; kind: LiveKind }[];
  /** Rejects with the reason when iOS refuses to start the activity */
  start(kind: LiveKind, state: LiveState, staleEpoch: number | null): Promise<string>;
  update(id: string, state: LiveState, alert: { title: string; body: string } | null, staleEpoch: number | null): Promise<void>;
  end(id: string, state: LiveState | null, dismissAfterSeconds: number | null): Promise<void>;
  endAll(kind: LiveKind | null): Promise<void>;
}

/** iOS only — null on Android */
export default requireOptionalNativeModule<LiveActivityModule>("LiveActivity");
