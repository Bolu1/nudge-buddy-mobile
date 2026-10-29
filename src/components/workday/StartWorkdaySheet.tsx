import { useState } from "react";
import { Alert, KeyboardAvoidingView, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "@/components/ui/SafeArea";
import { workday as workdayApi } from "@/lib/api";
import { colors } from "@/lib/theme";
import { useOpenKey } from "@/lib/use-open-key";
import {
  errorMessage,
  formatDuration,
  formatHHMM12,
  localDate,
  minutesFromHHMM,
  minutesToHHMM,
  timeOptionsWith,
  wallClock,
  type BlockDraft,
  type WorkdayTemplate,
} from "@/lib/workday";
import { Button, ErrorBanner, Field, Icon, IconButton, Label, SelectField, Toggle } from "@/components/ui";
import { BlockSheet } from "./BlockSheet";

type PlanBlock = BlockDraft & { key: string };

export type StartWorkdayBody = {
  startTime: string;
  endTime: string;
  goals?: string[];
  blocks: {
    name: string;
    color: string;
    description?: string;
    startTime: string;
    endTime: string;
    notifyOnStart: boolean;
    notifyOnStartMinutesBefore: number;
    notifyOnEnd: boolean;
    sortOrder: number;
  }[];
  templateName?: string;
};

interface SuggestedBlock { name: string; startTime: string; endTime: string; color: string; description: string }

const AI_PLAN = "__ai__";
let keySeq = 0;
const newKey = () => `plan-${++keySeq}`;

function fromTemplate(t: WorkdayTemplate): PlanBlock[] {
  return t.blocks.map((b) => ({
    key: newKey(),
    name: b.name,
    color: b.color,
    start: minutesToHHMM(b.startMinute),
    end: minutesToHHMM(b.endMinute),
    notifyOnStartMinutesBefore: b.notifyOnStartMinutesBefore ?? 0,
  }));
}

/** Widen [start, end] so it covers every block */
function widen(start: string, end: string, blocks: { start: string; end: string }[]) {
  if (!blocks.length) return { start, end };
  const s = Math.min(minutesFromHHMM(start), ...blocks.map((b) => minutesFromHHMM(b.start)));
  const e = Math.max(minutesFromHHMM(end), ...blocks.map((b) => minutesFromHHMM(b.end)));
  return { start: minutesToHHMM(s), end: minutesToHHMM(e) };
}

function StartWorkdayForm({
  visible,
  templates,
  preSelectedTemplateId,
  onStart,
  onClose,
}: {
  visible: boolean;
  templates: WorkdayTemplate[];
  preSelectedTemplateId: string | null;
  onStart: (body: StartWorkdayBody) => Promise<void>;
  onClose: () => void;
}) {
  // Fresh on every open (see useOpenKey below), seeded from the chosen template
  const [seed] = useState(() => {
    const t = preSelectedTemplateId ? templates.find((x) => x.id === preSelectedTemplateId) : undefined;
    const planned = t ? fromTemplate(t) : [];
    return { planned, bounds: widen("09:00", "17:00", planned) };
  });
  const [startTime, setStartTime] = useState(seed.bounds.start);
  const [endTime, setEndTime] = useState(seed.bounds.end);
  const [blocks, setBlocks] = useState<PlanBlock[]>(seed.planned);
  const [selected, setSelected] = useState<string | null>(preSelectedTemplateId);
  const [goals, setGoals] = useState<string[]>([]);
  const [goalInput, setGoalInput] = useState("");
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrefs, setAiPrefs] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [blockSheet, setBlockSheet] = useState<{ open: boolean; key: string | null }>({ open: false, key: null });

  function confirmReplace(what: string, then: () => void) {
    if (blocks.length === 0) { then(); return; }
    Alert.alert(
      "Replace your plan?",
      `Replace your current ${blocks.length} block${blocks.length === 1 ? "" : "s"} with ${what}?`,
      [{ text: "Cancel", style: "cancel" }, { text: "Replace", style: "destructive", onPress: then }],
    );
  }

  function selectTemplate(id: string | null) {
    if (id === selected) return;
    const t = id ? templates.find((x) => x.id === id) : undefined;
    confirmReplace(t ? `the "${t.name}" template` : "an empty day", () => {
      setSelected(id);
      setAiOpen(false);
      if (!t) { setBlocks([]); return; }
      const planned = fromTemplate(t);
      setBlocks(planned);
      const bounds = widen(startTime, endTime, planned);
      setStartTime(bounds.start);
      setEndTime(bounds.end);
    });
  }

  async function suggest() {
    const run = async () => {
      setSuggesting(true);
      setError("");
      try {
        const res = await workdayApi.suggest({ startTime, endTime, preferences: aiPrefs.trim() || undefined });
        if (!res.ok) throw new Error(errorMessage(res.data, "Failed to generate suggestions."));
        const suggested = (res.data as { data?: SuggestedBlock[] } | null)?.data ?? [];
        if (suggested.length === 0) {
          setError("Couldn't fit a schedule around your current tasks. Try adjusting your preferences.");
          return;
        }
        setBlocks(suggested.map((b) => ({
          key: newKey(),
          name: b.name,
          color: b.color,
          description: b.description,
          start: b.startTime,
          end: b.endTime,
          notifyOnStartMinutesBefore: 0,
        })));
        setSelected(AI_PLAN);
        setAiOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to generate suggestions.");
      } finally {
        setSuggesting(false);
      }
    };
    if (blocks.length) confirmReplace("an AI-generated plan", () => void run());
    else await run();
  }

  function addGoal() {
    const g = goalInput.trim();
    if (!g) return;
    setGoals((prev) => [...prev, g]);
    setGoalInput("");
  }

  async function start() {
    if (minutesFromHHMM(endTime) <= minutesFromHHMM(startTime)) { setError("End time must be after start time."); return; }
    if (blocks.length === 0) { setError("Add at least one block before starting your workday."); return; }
    setSubmitting(true);
    setError("");
    const today = localDate();
    const sorted = [...blocks].sort((a, b) => minutesFromHHMM(a.start) - minutesFromHHMM(b.start));
    try {
      await onStart({
        startTime: wallClock(today, startTime),
        endTime: wallClock(today, endTime),
        goals: goals.length ? goals : undefined,
        blocks: sorted.map((b, i) => ({
          name: b.name,
          color: b.color,
          description: b.description,
          startTime: wallClock(today, b.start),
          endTime: wallClock(today, b.end),
          notifyOnStart: true,
          notifyOnStartMinutesBefore: b.notifyOnStartMinutesBefore,
          notifyOnEnd: false,
          sortOrder: i,
        })),
        templateName: saveAsTemplate && templateName.trim() ? templateName.trim() : undefined,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start workday.");
      setSubmitting(false);
    }
  }

  const sorted = [...blocks].sort((a, b) => minutesFromHHMM(a.start) - minutesFromHHMM(b.start));
  const plannedMins = blocks.reduce((sum, b) => sum + (minutesFromHHMM(b.end) - minutesFromHHMM(b.start)), 0);
  const hoursValid = minutesFromHHMM(endTime) > minutesFromHHMM(startTime);
  const editing = blockSheet.key ? blocks.find((b) => b.key === blockSheet.key) ?? null : null;
  const lastEnd = sorted.length ? sorted[sorted.length - 1].end : startTime;

  const startOptions: { id: string | null; label: string; colors?: string[] }[] = [
    { id: null, label: "Empty" },
    { id: AI_PLAN, label: "AI plan" },
    ...templates.map((t) => ({ id: t.id, label: t.name, colors: t.blocks.slice(0, 6).map((b) => b.color) })),
  ];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
        <KeyboardAvoidingView behavior="padding" className="flex-1">
          <View className="flex-row items-center justify-between px-4 py-3 border-b border-divider">
            <IconButton name="x" onPress={onClose} accessibilityLabel="Close" />
            <View className="items-center">
              <Text className="text-on-surface font-semibold text-base">Plan your workday</Text>
              <Text className="text-outline text-xs">{new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</Text>
            </View>
            <View className="w-9" />
          </View>

          <ScrollView contentContainerClassName="p-4 gap-6 pb-10" keyboardShouldPersistTaps="handled">
            <ErrorBanner message={error} />

            <View>
              <Label>Hours</Label>
              <View className="flex-row items-center gap-3">
                <View className="flex-1">
                  <SelectField value={startTime} options={timeOptionsWith(startTime)} onChange={setStartTime} title="Start time" />
                </View>
                <Text className="text-outline">–</Text>
                <View className="flex-1">
                  <SelectField value={endTime} options={timeOptionsWith(endTime)} onChange={setEndTime} title="End time" />
                </View>
              </View>
              {!hoursValid ? <Text className="text-secondary text-xs mt-1.5">End must be after start</Text> : null}
            </View>

            <View>
              <Label>Start from</Label>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
                {startOptions.map((o) => {
                  const active = o.id === AI_PLAN ? aiOpen || selected === AI_PLAN : selected === o.id && !aiOpen;
                  return (
                    <Pressable
                      key={o.id ?? "empty"}
                      onPress={() => (o.id === AI_PLAN ? setAiOpen(true) : selectTemplate(o.id))}
                      className={`px-4 py-3 rounded-2xl border min-w-[110px] ${active ? "bg-on-primary-container border-primary-container" : "bg-surface-low border-divider"}`}
                    >
                      {o.colors?.length ? (
                        <View className="flex-row gap-1 mb-2">
                          {o.colors.map((c, i) => <View key={i} className="h-3 flex-1 rounded-sm" style={{ backgroundColor: c }} />)}
                        </View>
                      ) : o.id === AI_PLAN ? (
                        <View className="mb-2"><Icon name="zap" size={14} color={colors.primaryContainer} /></View>
                      ) : null}
                      <Text className={`text-sm font-medium ${active ? "text-primary" : "text-on-surface-variant"}`} numberOfLines={1}>{o.label}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              {aiOpen ? (
                <View className="mt-3 gap-2">
                  <Field
                    value={aiPrefs}
                    onChangeText={setAiPrefs}
                    placeholder="Anything to consider? e.g. long lunch, meetings after 2pm (optional)"
                    multiline
                  />
                  <Button title={suggesting ? "Planning…" : "Generate plan"} icon="zap" variant="tonal" onPress={suggest} loading={suggesting} disabled={!hoursValid} />
                </View>
              ) : null}
            </View>

            <View>
              <View className="flex-row items-center justify-between mb-2">
                <Text className="text-outline text-xs font-medium tracking-wide uppercase">
                  Blocks {blocks.length ? `· ${formatDuration(plannedMins)} planned` : ""}
                </Text>
                <Button title="Add block" icon="plus" variant="tonal" size="sm" onPress={() => setBlockSheet({ open: true, key: null })} />
              </View>
              {sorted.length === 0 ? (
                <View className="bg-surface-low border border-divider border-dashed rounded-2xl p-6 items-center">
                  <Text className="text-on-surface-variant text-sm font-medium">No blocks yet</Text>
                  <Text className="text-outline text-xs mt-1 text-center">Add blocks yourself, or pick a template or the AI plan above.</Text>
                </View>
              ) : (
                <View className="gap-2">
                  {sorted.map((b) => (
                    <Pressable
                      key={b.key}
                      onPress={() => setBlockSheet({ open: true, key: b.key })}
                      className="flex-row items-center gap-3 bg-surface-low border border-divider rounded-xl p-3"
                      style={{ borderLeftWidth: 4, borderLeftColor: b.color }}
                    >
                      <View className="flex-1">
                        <Text className="text-on-surface text-sm font-medium">{b.name}</Text>
                        <Text className="text-outline text-xs mt-0.5">
                          {formatHHMM12(b.start)} – {formatHHMM12(b.end)} · {formatDuration(minutesFromHHMM(b.end) - minutesFromHHMM(b.start))}
                        </Text>
                      </View>
                      <Icon name="chevron-right" size={16} color={colors.outline} />
                    </Pressable>
                  ))}
                </View>
              )}
            </View>

            <View>
              <Label>Goals <Text className="normal-case text-outline">(optional)</Text></Label>
              <View className="gap-2">
                {goals.map((g, i) => (
                  <View key={`${g}-${i}`} className="flex-row items-center gap-2 bg-surface-low border border-divider rounded-xl px-3 py-2.5">
                    <Text className="text-on-surface-variant text-sm flex-1">{g}</Text>
                    <Pressable onPress={() => setGoals((prev) => prev.filter((_, j) => j !== i))} hitSlop={8}>
                      <Icon name="x" size={14} color={colors.outline} />
                    </Pressable>
                  </View>
                ))}
                <View className="flex-row items-center gap-2">
                  <Field value={goalInput} onChangeText={setGoalInput} placeholder="What do you want done today?" className="flex-1" onSubmitEditing={addGoal} blurOnSubmit={false} returnKeyType="done" />
                  <Button title="Add" variant="tonal" size="sm" onPress={addGoal} disabled={!goalInput.trim()} />
                </View>
              </View>
            </View>

            <View className="gap-3">
              <View className="flex-row items-center justify-between">
                <Text className="text-on-surface-variant text-sm">Save as template</Text>
                <Toggle value={saveAsTemplate} onChange={setSaveAsTemplate} />
              </View>
              {saveAsTemplate ? <Field value={templateName} onChangeText={setTemplateName} placeholder="Template name" /> : null}
            </View>
          </ScrollView>

          <View className="px-4 pt-3 pb-2 border-t border-divider">
            <Button title={submitting ? "Starting…" : "Start workday"} onPress={start} loading={submitting} disabled={!hoursValid || blocks.length === 0} />
          </View>
        </KeyboardAvoidingView>

        <BlockSheet
          visible={blockSheet.open}
          initial={editing}
          defaultStart={lastEnd}
          onClose={() => setBlockSheet({ open: false, key: null })}
          onSave={(draft) => {
            setBlocks((prev) =>
              blockSheet.key ? prev.map((b) => (b.key === blockSheet.key ? { ...draft, key: b.key } : b)) : [...prev, { ...draft, key: newKey() }],
            );
            setBlockSheet({ open: false, key: null });
          }}
          onDelete={
            blockSheet.key
              ? () => {
                  setBlocks((prev) => prev.filter((b) => b.key !== blockSheet.key));
                  setBlockSheet({ open: false, key: null });
                }
              : undefined
          }
        />
      </SafeAreaView>
    </Modal>
  );
}

/** Full-screen planner for starting the day: hours, blocks (template / AI / manual), goals */
export function StartWorkdaySheet(props: Parameters<typeof StartWorkdayForm>[0]) {
  const openKey = useOpenKey(props.visible);
  return <StartWorkdayForm key={openKey} {...props} />;
}
