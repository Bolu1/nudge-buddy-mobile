import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "@/components/ui/SafeArea";
import { router, useLocalSearchParams } from "expo-router";
import { flashcards as flashcardsApi } from "@/lib/api";
import { apiError, unwrap } from "@/lib/boards";
import { emitChange, onChange } from "@/lib/events";
import {
  ANSWER_MAX,
  MAX_CARDS,
  QUESTION_MAX,
  SCORE_COLOR,
  formatDuration,
  scoreTone,
  type CollectionDetail,
  type SessionSummary,
  type StudyMode,
} from "@/lib/flashcards";
import { PREFS } from "@/lib/prefs";
import { getPref, setPref } from "@/lib/storage";
import { colors } from "@/lib/theme";
import { CollectionFormSheet } from "@/components/flashcards/CollectionFormSheet";
import { GenerateFromDocumentSheet, type GenerateResult } from "@/components/flashcards/GenerateFromDocumentSheet";
import { ThemeBackground } from "@/components/flashcards/ThemeBackground";
import { Button, ErrorBanner, Field, Icon, IconButton, InfoBanner, SectionTitle, Spinner, Toggle } from "@/components/ui";

/** A card as edited here: `id` is absent until the server has it; `key` doubles as the background seed. */
interface DraftCard {
  key: string;
  id?: string;
  question: string;
  answer: string;
}

function toDraft(collection: CollectionDetail): DraftCard[] {
  return collection.cards.map((c) => ({ key: c.id, id: c.id, question: c.question, answer: c.answer }));
}

function sameCards(draft: DraftCard[], collection: CollectionDetail | null): boolean {
  const saved = collection?.cards ?? [];
  return (
    draft.length === saved.length &&
    draft.every((d, i) => d.id === saved[i].id && d.question === saved[i].question && d.answer === saved[i].answer)
  );
}

function sessionDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function CollectionScreen() {
  const { collectionId } = useLocalSearchParams<{ collectionId: string }>();
  const [collection, setCollection] = useState<CollectionDetail | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [draft, setDraft] = useState<DraftCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editingDetails, setEditingDetails] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState("");
  const [shuffleOn, setShuffleOn] = useState(() => getPref(PREFS.flashcardShuffle) !== "0");
  const tmpCounter = useRef(0);

  const dirty = !sameCards(draft, collection);

  // `resetDraft` false keeps unsaved card edits through background reloads
  const load = useCallback(async (resetDraft = true) => {
    const [c, s] = await Promise.all([flashcardsApi.get(collectionId), flashcardsApi.sessions(collectionId)]);
    if (!c.ok) { setNotFound(true); setLoading(false); return; }
    const detail = unwrap<CollectionDetail>(c);
    setCollection(detail);
    if (detail && resetDraft) setDraft(toDraft(detail));
    if (s.ok) setSessions(unwrap<SessionSummary[]>(s) ?? []);
    setLoading(false);
  }, [collectionId]);

  useEffect(() => {
    load();
    // A finished study session changes scores and "missed" counts
    return onChange("flashcards", () => load(false));
  }, [load]);

  function goBack() {
    const leave = () => (router.canGoBack() ? router.back() : router.replace("/flashcards"));
    if (!dirty) { leave(); return; }
    Alert.alert("Discard changes?", "Your card edits haven't been saved.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: leave },
    ]);
  }

  function updateCard(key: string, patch: Partial<Pick<DraftCard, "question" | "answer">>) {
    setDraft((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  }

  function addCard() {
    if (draft.length >= MAX_CARDS) return;
    tmpCounter.current += 1;
    setDraft((prev) => [...prev, { key: `tmp-${tmpCounter.current}`, question: "", answer: "" }]);
  }

  function addGeneratedCards(result: GenerateResult) {
    const added = result.cards.slice(0, MAX_CARDS - draft.length).map((c) => {
      tmpCounter.current += 1;
      return { key: `tmp-${tmpCounter.current}`, question: c.question, answer: c.answer };
    });
    setDraft((prev) => [...prev, ...added]);
    setGenerating(false);
    setError("");
    setNotice(
      `Added ${added.length} card${added.length === 1 ? "" : "s"} from your document — review them, then save.` +
        (result.source.truncated ? " It was long, so only the first part was used." : "")
    );
  }

  function removeCard(key: string) {
    setDraft((prev) => prev.filter((c) => c.key !== key));
  }

  async function saveCards() {
    if (draft.some((c) => !c.question.trim() || !c.answer.trim())) {
      setError("Every card needs a question and an answer.");
      return;
    }
    setSaving(true);
    setError("");
    const res = await flashcardsApi.replaceCards(
      collectionId,
      draft.map((c) => ({ id: c.id, question: c.question, answer: c.answer })),
    );
    setSaving(false);
    if (!res.ok) { setError(apiError(res)); return; }
    const detail = unwrap<CollectionDetail>(res);
    if (detail) { setCollection(detail); setDraft(toDraft(detail)); setNotice(""); }
    emitChange("flashcards");
  }

  function confirmDelete() {
    Alert.alert("Delete collection?", `Delete "${collection?.title}" and all its cards and results? This can't be undone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          const res = await flashcardsApi.delete(collectionId);
          if (!res.ok) { setError(apiError(res)); return; }
          emitChange("flashcards");
          router.replace("/flashcards");
        },
      },
    ]);
  }

  function toggleShuffle(on: boolean) {
    setShuffleOn(on);
    setPref(PREFS.flashcardShuffle, on ? "1" : "0");
  }

  function study(mode: StudyMode) {
    if (dirty) { Alert.alert("Save your changes first", "Study uses the saved cards."); return; }
    router.push({
      pathname: "/flashcards/[collectionId]/study",
      params: { collectionId, mode, shuffle: shuffleOn ? "1" : "0" },
    });
  }

  if (notFound) {
    return (
      <SafeAreaView className="flex-1 bg-bg items-center justify-center gap-3 p-8">
        <Text className="text-on-surface-variant text-sm text-center">This collection doesn&apos;t exist anymore.</Text>
        <Button title="Back to flashcards" variant="tonal" onPress={() => router.replace("/flashcards")} />
      </SafeAreaView>
    );
  }

  const savedCount = collection?.cards.length ?? 0;
  const missedCount = collection?.cards.filter((c) => c.lastCorrect === false).length ?? 0;

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-bg">
      <View className="px-2 pt-1 pb-3 border-b border-divider">
        <View className="flex-row items-center justify-between">
          <IconButton name="chevron-left" onPress={goBack} accessibilityLabel="Back to flashcards" />
          <View className="flex-row items-center gap-1">
            <IconButton name="edit" onPress={() => setEditingDetails(true)} accessibilityLabel="Edit collection" disabled={!collection} />
            <IconButton name="trash" onPress={confirmDelete} accessibilityLabel="Delete collection" disabled={!collection} />
          </View>
        </View>
        <View className="px-2">
          <Text className="text-on-surface text-2xl font-semibold tracking-tight mt-1" numberOfLines={2}>
            {collection?.title ?? "Loading…"}
          </Text>
          {collection?.description ? <Text className="text-outline text-sm mt-1">{collection.description}</Text> : null}
          {collection ? (
            <Text className="text-outline text-xs mt-2">
              {savedCount} card{savedCount === 1 ? "" : "s"}
              {collection.lastSession ? " · Last score " : ""}
              {collection.lastSession ? (
                <Text style={{ color: SCORE_COLOR[scoreTone(collection.lastSession.scorePct)] }}>{collection.lastSession.scorePct}%</Text>
              ) : null}
            </Text>
          ) : null}
        </View>
      </View>

      {loading ? (
        <Spinner />
      ) : (
        <KeyboardAvoidingView behavior="padding" className="flex-1">
          <ScrollView
            contentContainerClassName="p-4 gap-8 pb-32"
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(!dirty); setRefreshing(false); }} tintColor={colors.primaryContainer} />}
          >
            <View className="gap-3">
              <Button title="Study" icon="play" onPress={() => study("ALL")} disabled={savedCount === 0} />
              {missedCount > 0 ? (
                <Button title={`Study missed (${missedCount})`} icon="rotate-ccw" variant="tonal" onPress={() => study("MISSED")} />
              ) : null}
              <View className="flex-row items-center justify-between px-1">
                <View className="flex-row items-center gap-2">
                  <Icon name="shuffle" size={15} color={colors.outline} />
                  <Text className="text-on-surface-variant text-sm">Shuffle cards</Text>
                </View>
                <Toggle value={shuffleOn} onChange={toggleShuffle} />
              </View>
            </View>

            <View>
              <SectionTitle
                right={<Text className="text-outline text-xs">{draft.length}/{MAX_CARDS}</Text>}
              >
                Cards
              </SectionTitle>
              <View className="gap-3">
                {draft.length === 0 ? (
                  <View className="rounded-2xl bg-surface-low border border-divider p-6 items-center">
                    <Text className="text-on-surface-variant text-sm font-medium">No cards yet</Text>
                    <Text className="text-outline text-sm mt-1 text-center">Write them yourself, or let us draft them from your notes.</Text>
                    <Button title="Generate from a document" icon="sparkles" variant="tonal" onPress={() => setGenerating(true)} className="mt-4" />
                  </View>
                ) : (
                  draft.map((card, i) => (
                    <View key={card.key} className="bg-surface-low border border-divider rounded-2xl overflow-hidden">
                      <View className="h-10 flex-row items-center justify-between px-2">
                        {collection ? <ThemeBackground theme={collection.theme} seed={card.key} /> : null}
                        <View className="bg-black/50 rounded-full px-2.5 py-0.5 ml-1">
                          <Text className="text-on-surface text-xs font-semibold">{i + 1}</Text>
                        </View>
                        <IconButton
                          name="x"
                          size={16}
                          color={colors.onSurface}
                          className="bg-black/40"
                          onPress={() => removeCard(card.key)}
                          accessibilityLabel={`Remove card ${i + 1}`}
                        />
                      </View>
                      <View className="p-3 gap-2">
                        <Field
                          value={card.question}
                          onChangeText={(question) => updateCard(card.key, { question })}
                          maxLength={QUESTION_MAX}
                          placeholder="Question"
                          multiline
                          className="min-h-12"
                        />
                        <Field
                          value={card.answer}
                          onChangeText={(answer) => updateCard(card.key, { answer })}
                          maxLength={ANSWER_MAX}
                          placeholder="Answer"
                          multiline
                        />
                      </View>
                    </View>
                  ))
                )}
                <Button
                  title={draft.length >= MAX_CARDS ? `Limit of ${MAX_CARDS} cards reached` : "Add card"}
                  icon="plus"
                  variant="outline"
                  onPress={addCard}
                  disabled={draft.length >= MAX_CARDS}
                />
                {draft.length > 0 && draft.length < MAX_CARDS ? (
                  <Button title="Generate from document" icon="sparkles" variant="ghost" onPress={() => setGenerating(true)} />
                ) : null}
                <ErrorBanner message={error} />
                <InfoBanner message={notice} />
                {dirty ? (
                  <View className="flex-row justify-end gap-2">
                    <Button title="Discard" variant="ghost" onPress={() => { if (collection) setDraft(toDraft(collection)); setError(""); setNotice(""); }} />
                    <Button title={saving ? "Saving…" : "Save cards"} onPress={saveCards} loading={saving} />
                  </View>
                ) : null}
              </View>
            </View>

            {sessions.length > 0 ? (
              <View>
                <SectionTitle>Recent sessions</SectionTitle>
                <View className="bg-surface-low border border-divider rounded-2xl">
                  {sessions.map((s, i) => (
                    <View key={s.id} className={`flex-row items-center gap-3 px-4 py-3 ${i ? "border-t border-divider" : ""}`}>
                      <View className="flex-1">
                        <Text className="text-on-surface text-sm">{sessionDate(s.completedAt)}</Text>
                        <Text className="text-outline text-xs mt-0.5">
                          {s.mode === "MISSED" ? "Missed cards · " : ""}
                          {s.correctCards}/{s.totalCards} · {formatDuration(s.durationMs)}
                        </Text>
                      </View>
                      <Text className="text-base font-semibold" style={{ color: SCORE_COLOR[scoreTone(s.scorePct)] }}>{s.scorePct}%</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      <GenerateFromDocumentSheet
        visible={generating}
        collectionId={collectionId}
        remaining={MAX_CARDS - draft.length}
        onClose={() => setGenerating(false)}
        onGenerated={addGeneratedCards}
      />

      <CollectionFormSheet
        visible={editingDetails}
        collection={collection}
        onClose={() => setEditingDetails(false)}
        onSaved={() => {
          setEditingDetails(false);
          emitChange("flashcards");
        }}
      />
    </SafeAreaView>
  );
}
