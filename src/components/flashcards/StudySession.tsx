import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, BackHandler, Pressable, ScrollView, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { flashcards as flashcardsApi } from "@/lib/api";
import { apiError, unwrap } from "@/lib/boards";
import { emitChange } from "@/lib/events";
import {
  SCORE_COLOR,
  formatDuration,
  scoreTone,
  shuffle,
  type CollectionDetail,
  type Flashcard,
  type FlashcardTheme,
  type SessionResult,
  type StudyMode,
} from "@/lib/flashcards";
import { colors } from "@/lib/theme";
import { Celebration } from "@/components/flashcards/Celebration";
import { ThemeBackground } from "@/components/flashcards/ThemeBackground";
import { Button, ErrorBanner, Icon, IconButton, SectionTitle } from "@/components/ui";

interface CardResult {
  cardId: string;
  correct: boolean;
  timeMs: number;
}

interface Finished {
  mode: StudyMode;
  deck: Flashcard[];
  results: CardResult[];
  durationMs: number;
  status: "saving" | "saved" | "error";
  error?: string;
  response?: SessionResult;
}

function buildDeck(cards: Flashcard[], shuffled: boolean) {
  return shuffled ? shuffle(cards) : [...cards];
}

// ── Card ─────────────────────────────────────────────────────────────────────

function Face({ label, text, theme, seed }: { label: string; text: string; theme: FlashcardTheme; seed: string }) {
  return (
    <View className="flex-1 rounded-3xl overflow-hidden border border-divider items-center justify-center p-5">
      <ThemeBackground theme={theme} seed={seed} />
      {/* Scrim keeps text readable over the busier styles */}
      <View className="bg-black/65 rounded-2xl px-5 py-4 w-full max-h-full">
        <Text className="text-outline text-[11px] font-semibold tracking-widest uppercase text-center mb-2">{label}</Text>
        <ScrollView contentContainerClassName="grow justify-center">
          <Text className="text-on-surface text-xl font-semibold text-center leading-7">{text}</Text>
        </ScrollView>
      </View>
    </View>
  );
}

function StudyCard({
  card,
  theme,
  revealed,
  onReveal,
}: {
  card: Flashcard;
  theme: FlashcardTheme;
  revealed: boolean;
  onReveal: () => void;
}) {
  const flip = useSharedValue(revealed ? 180 : 0);

  useEffect(() => {
    flip.value = revealed ? withTiming(180, { duration: 380 }) : 0;
  }, [revealed, flip]);

  // Each face hides once it turns past edge-on, so neither shows mirrored
  const front = useAnimatedStyle(() => ({
    opacity: flip.value < 90 ? 1 : 0,
    transform: [{ perspective: 1200 }, { rotateY: `${flip.value}deg` }],
  }));
  const back = useAnimatedStyle(() => ({
    opacity: flip.value >= 90 ? 1 : 0,
    transform: [{ perspective: 1200 }, { rotateY: `${interpolate(flip.value, [0, 180], [-180, 0])}deg` }],
  }));

  return (
    <Pressable onPress={onReveal} disabled={revealed} className="flex-1" accessibilityHint={revealed ? undefined : "Reveals the answer"}>
      <Animated.View style={[{ position: "absolute", inset: 0, backfaceVisibility: "hidden" }, front]}>
        <Face label="Question" text={card.question} theme={theme} seed={card.id} />
      </Animated.View>
      <Animated.View style={[{ position: "absolute", inset: 0, backfaceVisibility: "hidden" }, back]}>
        <Face label="Answer" text={card.answer} theme={theme} seed={card.id} />
      </Animated.View>
    </Pressable>
  );
}

// ── Summary ──────────────────────────────────────────────────────────────────

function Delta({ value, unit, lowerIsBetter }: { value: number; unit: "pts" | "ms"; lowerIsBetter?: boolean }) {
  const text = unit === "pts" ? `${Math.abs(value)} pts` : formatDuration(Math.abs(value));
  // Compare what's shown, so a 300ms difference doesn't read as "▲ 0s"
  if (value === 0 || (unit === "ms" && text === formatDuration(0))) {
    return <Text className="text-xs font-medium" style={{ color: SCORE_COLOR.average }}>same as last time</Text>;
  }
  // Coloured like scores: better green, same yellow, worse red
  const better = lowerIsBetter ? value < 0 : value > 0;
  return (
    <Text className="text-xs font-medium" style={{ color: better ? SCORE_COLOR.good : SCORE_COLOR.bad }}>
      {value > 0 ? "▲" : "▼"} {text}
    </Text>
  );
}

function Stat({ label, value, delta }: { label: string; value: string; delta?: ReactNode }) {
  return (
    <View className="flex-1 bg-surface-low border border-divider rounded-2xl p-3 gap-1">
      <Text className="text-outline text-[11px] uppercase tracking-wide">{label}</Text>
      <Text className="text-on-surface text-lg font-semibold">{value}</Text>
      {delta}
    </View>
  );
}

function Summary({
  finished,
  onRetrySave,
  onRetryMissed,
  onAgain,
  onDone,
}: {
  finished: Finished;
  onRetrySave: () => void;
  onRetryMissed: () => void;
  onAgain: () => void;
  onDone: () => void;
}) {
  const total = finished.results.length;
  const correct = finished.results.filter((r) => r.correct).length;
  const missed = total - correct;
  // Server numbers once saved; the same maths locally until then
  const s = finished.response?.session ?? {
    scorePct: total ? Math.round((correct / total) * 100) : 0,
    durationMs: finished.durationMs,
    avgMs: total ? Math.round(finished.durationMs / total) : 0,
  };
  const prev = finished.response?.previous;
  const improved = finished.response?.improved ?? [];
  const slipped = finished.response?.slipped ?? [];

  return (
    <ScrollView contentContainerClassName="p-4 gap-6 pb-16">
      <View className="items-center gap-1 pt-4">
        <Celebration scorePct={s.scorePct} />
        <Text className="text-outline text-xs uppercase tracking-widest mt-3">
          {finished.mode === "MISSED" ? "Missed cards round" : "Session complete"}
        </Text>
        <Text className="text-6xl font-semibold tracking-tight" style={{ color: SCORE_COLOR[scoreTone(s.scorePct)] }}>
          {s.scorePct}%
        </Text>
        <Text className="text-on-surface-variant text-sm">{correct} of {total} correct</Text>
        {prev ? (
          <View className="mt-1"><Delta value={s.scorePct - prev.scorePct} unit="pts" /></View>
        ) : null}
      </View>

      <View className="flex-row gap-3">
        <Stat
          label="Total time"
          value={formatDuration(s.durationMs)}
          delta={prev ? <Delta value={s.durationMs - prev.durationMs} unit="ms" lowerIsBetter /> : undefined}
        />
        <Stat
          label="Per card"
          value={formatDuration(s.avgMs)}
          delta={prev ? <Delta value={s.avgMs - prev.avgMs} unit="ms" lowerIsBetter /> : undefined}
        />
      </View>

      {finished.status === "saved" ? (
        <Text className="text-outline text-xs text-center">
          {prev
            ? `Compared with ${prev.scorePct}% on ${new Date(prev.completedAt).toLocaleDateString([], { month: "short", day: "numeric" })}`
            : "First time — next session will be compared with this one."}
        </Text>
      ) : finished.status === "saving" ? (
        <Text className="text-outline text-xs text-center">Saving results…</Text>
      ) : (
        <View className="gap-2">
          <ErrorBanner message={`Couldn't save results. ${finished.error ?? ""}`.trim()} />
          <Button title="Retry save" variant="outline" icon="refresh" onPress={onRetrySave} />
        </View>
      )}

      {improved.length > 0 ? (
        <View>
          <SectionTitle>Now right</SectionTitle>
          <View className="gap-2">
            {improved.map((c) => (
              <View key={c.id} className="flex-row items-center gap-2.5 bg-surface-low border border-divider rounded-xl px-3 py-2.5">
                <Icon name="check" size={15} color={colors.primary} strokeWidth={2.5} />
                <Text className="text-on-surface-variant text-sm flex-1" numberOfLines={2}>{c.question}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {slipped.length > 0 ? (
        <View>
          <SectionTitle>Slipped</SectionTitle>
          <View className="gap-2">
            {slipped.map((c) => (
              <View key={c.id} className="flex-row items-center gap-2.5 bg-surface-low border border-divider rounded-xl px-3 py-2.5">
                <Icon name="x" size={15} color={colors.secondary} strokeWidth={2.5} />
                <Text className="text-on-surface-variant text-sm flex-1" numberOfLines={2}>{c.question}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <View className="gap-2.5">
        {missed > 0 ? <Button title={`Retry missed (${missed})`} icon="rotate-ccw" onPress={onRetryMissed} /> : null}
        <Button title="Study again" variant={missed > 0 ? "tonal" : "primary"} icon="play" onPress={onAgain} />
        <Button title="Done" variant="ghost" onPress={onDone} />
      </View>
    </ScrollView>
  );
}

// ── Session ──────────────────────────────────────────────────────────────────

function startingCards(collection: CollectionDetail, mode: StudyMode) {
  return mode === "MISSED" ? collection.cards.filter((c) => c.lastCorrect === false) : collection.cards;
}

/**
 * One study run over a loaded collection: reveal, mark ✓ / ✗, then a saved
 * summary compared with last time. Used by the study screen and by Zen,
 * which decide what leaving means (`onLeave`).
 */
export function StudySession({
  collection,
  initialMode,
  shuffled,
  onLeave,
}: {
  collection: CollectionDetail;
  initialMode: StudyMode;
  shuffled: boolean;
  /** Quit (already confirmed) or Done. */
  onLeave: () => void;
}) {
  const [mode, setMode] = useState<StudyMode>(initialMode);
  const [deck, setDeck] = useState<Flashcard[]>(() => buildDeck(startingCards(collection, initialMode), shuffled));
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [results, setResults] = useState<CardResult[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [finished, setFinished] = useState<Finished | null>(null);
  const [startedAt] = useState(() => Date.now());
  const sessionStart = useRef(startedAt);
  const cardStart = useRef(startedAt);

  const start = useCallback((nextMode: StudyMode, cards: Flashcard[]) => {
    const now = Date.now();
    sessionStart.current = now;
    cardStart.current = now;
    setMode(nextMode);
    setDeck(buildDeck(cards, shuffled));
    setIndex(0);
    setRevealed(false);
    setResults([]);
    setElapsedMs(0);
    setFinished(null);
  }, [shuffled]);

  const studying = !finished && deck.length > 0;

  // Elapsed clock while a session runs
  useEffect(() => {
    if (!studying) return;
    const id = setInterval(() => setElapsedMs(Date.now() - sessionStart.current), 1000);
    return () => clearInterval(id);
  }, [studying]);

  const confirmQuit = useCallback(() => {
    if (!studying || results.length === 0) { onLeave(); return; }
    Alert.alert("Quit this session?", "Your answers so far won't be saved.", [
      { text: "Keep going", style: "cancel" },
      { text: "Quit", style: "destructive", onPress: onLeave },
    ]);
  }, [studying, results.length, onLeave]);

  // Android back button goes through the same confirmation (iOS swipe-back is off for the study screen)
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { confirmQuit(); return true; });
    return () => sub.remove();
  }, [confirmQuit]);

  const save = useCallback(async (f: Finished) => {
    setFinished({ ...f, status: "saving", error: undefined });
    const res = await flashcardsApi.saveSession(collection.id, { mode: f.mode, durationMs: f.durationMs, results: f.results });
    if (!res.ok) { setFinished({ ...f, status: "error", error: apiError(res, "") }); return; }
    setFinished({ ...f, status: "saved", response: unwrap<SessionResult>(res) ?? undefined });
    emitChange("flashcards");
  }, [collection.id]);

  function reveal() {
    setRevealed(true);
    void Haptics.selectionAsync().catch(() => {});
  }

  function mark(correct: boolean) {
    const card = deck[index];
    const now = Date.now();
    const next = [...results, { cardId: card.id, correct, timeMs: now - cardStart.current }];
    void (correct
      ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    ).catch(() => {});
    cardStart.current = now;
    setResults(next);
    if (index + 1 < deck.length) {
      setIndex(index + 1);
      setRevealed(false);
      return;
    }
    void save({ mode, deck, results: next, durationMs: now - sessionStart.current, status: "saving" });
  }

  if (finished) {
    const missedIds = new Set(finished.results.filter((r) => !r.correct).map((r) => r.cardId));
    return (
      <View className="flex-1">
        <View className="px-2 pt-1 flex-row items-center">
          <IconButton name="x" onPress={onLeave} accessibilityLabel="Close" />
          <Text className="text-on-surface text-base font-semibold flex-1" numberOfLines={1}>{collection.title}</Text>
        </View>
        <Summary
          finished={finished}
          onRetrySave={() => void save(finished)}
          onRetryMissed={() => start("MISSED", finished.deck.filter((c) => missedIds.has(c.id)))}
          onAgain={() => start(finished.mode, finished.deck)}
          onDone={onLeave}
        />
      </View>
    );
  }

  if (deck.length === 0) {
    return (
      <View className="flex-1 items-center justify-center gap-3 p-8">
        <Text className="text-on-surface-variant text-sm text-center">
          {mode === "MISSED" ? "No missed cards — nice work." : "This collection has no cards yet."}
        </Text>
        <Button title="Back" variant="tonal" onPress={onLeave} />
      </View>
    );
  }

  const card = deck[index];
  const progress = index / deck.length;

  return (
    <View className="flex-1">
      <View className="px-2 pt-1 pb-2 flex-row items-center gap-2">
        <IconButton name="x" onPress={confirmQuit} accessibilityLabel="Quit session" />
        <View className="flex-1">
          <Text className="text-on-surface text-sm font-semibold" numberOfLines={1}>{collection.title}</Text>
          <Text className="text-outline text-xs">
            {mode === "MISSED" ? "Missed cards · " : ""}Card {index + 1} of {deck.length}
          </Text>
        </View>
        <View className="flex-row items-center gap-1.5 pr-3">
          <Icon name="clock" size={14} color={colors.outline} />
          <Text className="text-outline text-sm" style={{ fontVariant: ["tabular-nums"] }}>{formatDuration(elapsedMs)}</Text>
        </View>
      </View>
      <View className="h-1 mx-4 rounded-full bg-surface-high overflow-hidden">
        <View className="h-full bg-primary-container rounded-full" style={{ width: `${progress * 100}%` }} />
      </View>

      <View className="flex-1 p-4">
        <StudyCard key={card.id} card={card} theme={collection.theme} revealed={revealed} onReveal={reveal} />
      </View>

      <View className="px-4 pb-4 h-24 justify-center">
        {revealed ? (
          <View className="flex-row gap-4 justify-center">
            <Pressable
              onPress={() => mark(false)}
              accessibilityLabel="I got it wrong"
              className="w-16 h-16 rounded-full bg-secondary-container/60 border border-secondary-container items-center justify-center active:opacity-70"
            >
              <Icon name="x" size={26} color={colors.secondary} strokeWidth={2.5} />
            </Pressable>
            <Pressable
              onPress={() => mark(true)}
              accessibilityLabel="I got it right"
              className="w-16 h-16 rounded-full bg-on-primary-container border border-primary-container items-center justify-center active:opacity-70"
            >
              <Icon name="check" size={26} color={colors.primary} strokeWidth={2.5} />
            </Pressable>
          </View>
        ) : (
          <Button title="Reveal answer" variant="outline" onPress={reveal} />
        )}
      </View>
    </View>
  );
}
