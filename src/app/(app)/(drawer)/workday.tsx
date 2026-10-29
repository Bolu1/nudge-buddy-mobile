import { useCallback, useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "@/components/ui/SafeArea";
import { workday as workdayApi, tasks as tasksApi } from "@/lib/api";
import { emitChange, onChange } from "@/lib/events";
import { playTaskCompleteSound } from "@/lib/sounds";
import { colors } from "@/lib/theme";
import { useWs } from "@/lib/ws-context";
import {
  errorMessage,
  formatBlockTime,
  formatHour,
  hhmmFromIso,
  localDate,
  minutesFromIso,
  wallClock,
  type ActiveWorkday,
  type ActiveWorkdayBlock,
  type ActiveWorkdayBlockTask,
  type BlockDraft,
  type EndOfDayData,
  type WorkdayGoal,
  type WorkdayTemplate,
} from "@/lib/workday";
import { Button, Field, Icon, ScreenHeader, SectionTitle, Spinner } from "@/components/ui";
import { BlockSheet } from "@/components/workday/BlockSheet";
import { EndOfDaySheet } from "@/components/workday/EndOfDaySheet";
import { StartWorkdaySheet, type StartWorkdayBody } from "@/components/workday/StartWorkdaySheet";
import { useToast } from "@/lib/toast-context";

const PX_PER_MIN = 1.4;

function nowMins() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

export default function WorkdayScreen() {
  const toast = useToast();
  const { addListener } = useWs();
  const [workday, setWorkday] = useState<ActiveWorkday | null>(null);
  const [templates, setTemplates] = useState<WorkdayTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [preTemplate, setPreTemplate] = useState<string | null>(null);
  const [blockSheet, setBlockSheet] = useState<{ open: boolean; block: ActiveWorkdayBlock | null; defaultStart?: string }>({ open: false, block: null });
  const [endOfDay, setEndOfDay] = useState<EndOfDayData | null>(null);
  const [goalText, setGoalText] = useState("");
  const [busy, setBusy] = useState<"complete" | "cancel" | null>(null);
  const [now, setNow] = useState(nowMins);

  const load = useCallback(async () => {
    try {
      const [wdRes, tmplRes] = await Promise.all([workdayApi.getCurrent(), workdayApi.getTemplates()]);
      const wd = (wdRes.data as { data?: ActiveWorkday | null } | null)?.data ?? null;
      setWorkday(wd && wd.status === "ACTIVE" ? wd : null);
      setTemplates((tmplRes.data as { data?: WorkdayTemplate[] } | null)?.data ?? []);
    } catch {
      toast.error("Failed to load workday.");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
    const off = onChange("workday", load);
    const id = setInterval(() => setNow(nowMins()), 60_000);
    return () => { off(); clearInterval(id); };
  }, [load]);

  // The workday can also end server-side when its time runs out
  useEffect(() => addListener((msg) => {
    if (msg.type !== "workday_complete") return;
    setEndOfDay({
      unachievedGoals: (msg.unachievedGoals as { id: string; title: string }[] | undefined) ?? [],
      completedGoals: (msg.completedGoals as number | undefined) ?? 0,
      totalGoals: (msg.totalGoals as number | undefined) ?? 0,
    });
    setWorkday(null);
  }), [addListener]);

  async function handleStart(body: StartWorkdayBody) {
    const { templateName, ...startBody } = body;
    const res = await workdayApi.start(startBody);
    if (!res.ok) throw new Error(errorMessage(res.data, "Failed to start workday."));
    if (templateName) await workdayApi.saveTemplate({ name: templateName }).catch(() => {});
    setStartOpen(false);
    setPreTemplate(null);
    emitChange("workday");
    await load();
  }

  async function handleComplete() {
    setBusy("complete");
    try {
      const res = await workdayApi.complete();
      if (!res.ok) { toast.error(errorMessage(res.data, "Failed to complete workday.")); return; }
      const d = (res.data as { data?: Partial<EndOfDayData> } | null)?.data;
      setEndOfDay({ unachievedGoals: d?.unachievedGoals ?? [], completedGoals: d?.completedGoals ?? 0, totalGoals: d?.totalGoals ?? 0 });
      setWorkday(null);
      emitChange("workday");
    } catch {
      toast.error("Failed to complete workday.");
    } finally {
      setBusy(null);
    }
  }

  function handleCancel() {
    Alert.alert("Cancel workday?", "Your blocks and goals for today will be discarded.", [
      { text: "Keep it", style: "cancel" },
      {
        text: "Cancel workday",
        style: "destructive",
        onPress: async () => {
          setBusy("cancel");
          try {
            await workdayApi.cancel();
            setWorkday(null);
            emitChange("workday");
          } catch {
            toast.error("Failed to cancel workday.");
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  }

  async function saveBlock(draft: BlockDraft) {
    if (!workday) return;
    const date = localDate(new Date(workday.startTime));
    const data = {
      name: draft.name,
      color: draft.color,
      description: draft.description,
      startTime: wallClock(date, draft.start),
      endTime: wallClock(date, draft.end),
      notifyOnStart: true,
      notifyOnStartMinutesBefore: draft.notifyOnStartMinutesBefore,
      notifyOnEnd: false,
    };
    const res = blockSheet.block ? await workdayApi.updateBlock(blockSheet.block.id, data) : await workdayApi.addBlock(data);
    if (!res.ok) throw new Error(errorMessage(res.data, "Failed to save block."));
    setBlockSheet({ open: false, block: null });
    emitChange("workday");
    await load();
  }

  async function deleteBlock() {
    if (!blockSheet.block) return;
    const res = await workdayApi.deleteBlock(blockSheet.block.id);
    if (!res.ok) throw new Error("Failed to delete block.");
    setBlockSheet({ open: false, block: null });
    emitChange("workday");
    await load();
  }

  async function addGoal() {
    if (!goalText.trim()) return;
    const title = goalText.trim();
    setGoalText("");
    await workdayApi.addGoal({ title }).catch(() => {});
    await load();
  }

  async function toggleGoal(goal: WorkdayGoal) {
    setWorkday((prev) => prev ? { ...prev, goals: prev.goals.map((g) => (g.id === goal.id ? { ...g, completed: !g.completed } : g)) } : null);
    await workdayApi.updateGoal(goal.id, { completed: !goal.completed }).catch(() => load());
  }

  async function deleteGoal(id: string) {
    setWorkday((prev) => (prev ? { ...prev, goals: prev.goals.filter((g) => g.id !== id) } : null));
    await workdayApi.deleteGoal(id).catch(() => load());
  }

  async function toggleBlockTask(blockId: string, task: ActiveWorkdayBlockTask) {
    const next = task.status === "COMPLETED" ? "PENDING" : "COMPLETED";
    setWorkday((prev) => prev ? {
      ...prev,
      blocks: prev.blocks.map((b) => (b.id === blockId ? { ...b, tasks: b.tasks?.map((t) => (t.id === task.id ? { ...t, status: next } : t)) } : b)),
    } : null);
    if (next === "COMPLETED") {
      playTaskCompleteSound();
      await tasksApi.complete(task.id).catch(() => {});
    } else {
      await tasksApi.update(task.id, { status: "PENDING" }).catch(() => {});
    }
    emitChange("tasks");
  }

  async function addGoalsAsTasks(goals: { id: string; title: string }[]) {
    for (const g of goals) await tasksApi.create({ title: g.title }).catch(() => {});
    emitChange("tasks");
    setEndOfDay(null);
  }

  function deleteTemplate(t: WorkdayTemplate) {
    Alert.alert("Delete template?", t.name, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => { await workdayApi.deleteTemplate(t.id).catch(() => {}); load(); } },
    ]);
  }

  if (loading) {
    return (
      <SafeAreaView edges={["top"]} className="flex-1 bg-bg">
        <ScreenHeader title="Workday" />
        <Spinner />
      </SafeAreaView>
    );
  }

  // ── No active workday ──────────────────────────────────────────────────────
  if (!workday) {
    const system = templates.filter((t) => t.isSystem).slice(0, 3);
    const mine = templates.filter((t) => !t.isSystem);
    const TemplateCard = ({ t, deletable }: { t: WorkdayTemplate; deletable?: boolean }) => (
      <Pressable
        onPress={() => { setPreTemplate(t.id); setStartOpen(true); }}
        onLongPress={deletable ? () => deleteTemplate(t) : undefined}
        className="bg-surface-low border border-divider rounded-2xl p-4 active:border-outline-variant"
      >
        {t.blocks.length ? (
          <View className="flex-row gap-1 mb-3">
            {t.blocks.slice(0, 6).map((b) => <View key={b.id} className="h-4 flex-1 max-w-8 rounded-sm" style={{ backgroundColor: b.color }} />)}
          </View>
        ) : null}
        <Text className="text-on-surface-variant text-sm font-medium">{t.name}</Text>
        <Text className="text-outline-variant text-xs mt-0.5">{t.blocks.length} blocks{deletable ? " · hold to delete" : ""}</Text>
      </Pressable>
    );
    return (
      <SafeAreaView edges={["top"]} className="flex-1 bg-bg">
        <ScreenHeader title="Workday" />
        <ScrollView
          contentContainerClassName="p-5 gap-6 pb-32"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.primaryContainer} />}
        >
          <View className="items-center mt-4">
            <View className="w-14 h-14 rounded-2xl bg-on-primary-container items-center justify-center mb-4">
              <Icon name="calendar" size={24} color={colors.primaryContainer} />
            </View>
            <Text className="text-on-surface text-xl font-semibold mb-2">Plan your workday</Text>
            <Text className="text-outline text-sm text-center">Structure your day into focused time blocks with clear goals.</Text>
          </View>
          {system.length ? (
            <View>
              <SectionTitle>Templates</SectionTitle>
              <View className="gap-3">{system.map((t) => <TemplateCard key={t.id} t={t} />)}</View>
            </View>
          ) : null}
          {mine.length ? (
            <View>
              <SectionTitle>Your templates</SectionTitle>
              <View className="gap-3">{mine.map((t) => <TemplateCard key={t.id} t={t} deletable />)}</View>
            </View>
          ) : null}
          <Button title="Start your workday" onPress={() => { setPreTemplate(null); setStartOpen(true); }} />
        </ScrollView>

        <StartWorkdaySheet
          visible={startOpen}
          templates={templates}
          preSelectedTemplateId={preTemplate}
          onStart={handleStart}
          onClose={() => { setStartOpen(false); setPreTemplate(null); }}
        />
        <EndOfDaySheet data={endOfDay} onAddToTasks={addGoalsAsTasks} onDismiss={() => setEndOfDay(null)} />
      </SafeAreaView>
    );
  }

  // ── Active workday ─────────────────────────────────────────────────────────
  const startMins = minutesFromIso(workday.startTime);
  const endMins = minutesFromIso(workday.endTime);
  const totalMins = Math.max(endMins - startMins, 60);
  const height = totalMins * PX_PER_MIN;
  const hours: number[] = [];
  for (let h = Math.floor(startMins / 60); h <= Math.ceil(endMins / 60); h++) hours.push(h);
  const current = workday.blocks.find((b) => now >= minutesFromIso(b.startTime) && now < minutesFromIso(b.endTime)) ?? null;
  const showNow = now >= startMins && now <= endMins;
  const lastBlockEnd = workday.blocks.length
    ? hhmmFromIso(workday.blocks.reduce((a, b) => (minutesFromIso(b.endTime) > minutesFromIso(a.endTime) ? b : a)).endTime)
    : hhmmFromIso(workday.startTime);

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-bg">
      <ScreenHeader
        title="Workday"
        subtitle={`${formatBlockTime(workday.startTime)} – ${formatBlockTime(workday.endTime)}`}
        right={
          <View className="flex-row gap-2">
            <Button title={busy === "complete" ? "…" : "Complete"} size="sm" onPress={handleComplete} disabled={!!busy} />
            <Button title={busy === "cancel" ? "…" : "Cancel"} size="sm" variant="outline" onPress={handleCancel} disabled={!!busy} />
          </View>
        }
      />
      <KeyboardAvoidingView behavior="padding" className="flex-1">
      <ScrollView
        contentContainerClassName="p-4 gap-6 pb-32"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.primaryContainer} />}
      >
        {/* Current block */}
        <View className="bg-surface-low border border-divider rounded-2xl p-4">
          <SectionTitle>Current block</SectionTitle>
          {current ? (
            <>
              <View className="flex-row items-center gap-2 mb-3">
                <View className="w-2 h-2 rounded-full" style={{ backgroundColor: current.color }} />
                <Text className="text-on-surface text-base font-semibold flex-1">{current.name}</Text>
                <Text className="text-outline text-xs">{formatBlockTime(current.startTime)} – {formatBlockTime(current.endTime)}</Text>
              </View>
              {current.tasks?.length ? (
                <View className="gap-2">
                  {current.tasks.map((t) => (
                    <Pressable key={t.id} onPress={() => toggleBlockTask(current.id, t)} className="flex-row items-center gap-2.5 px-3 py-2.5 rounded-xl border border-divider bg-field">
                      <View className={`w-4 h-4 rounded border items-center justify-center ${t.status === "COMPLETED" ? "bg-primary-container border-primary-container" : "border-outline-variant"}`}>
                        {t.status === "COMPLETED" ? <Icon name="check" size={10} color={colors.onPrimary} strokeWidth={3} /> : null}
                      </View>
                      <Text className={`flex-1 text-sm ${t.status === "COMPLETED" ? "line-through text-outline-variant" : "text-on-surface-variant"}`} numberOfLines={1}>{t.title}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : (
                <Text className="text-outline-variant text-xs">No tasks in this block.</Text>
              )}
            </>
          ) : (
            <Text className="text-outline-variant text-xs">No block running right now.</Text>
          )}
        </View>

        {/* Timeline */}
        <View>
          <SectionTitle right={<Button title="Block" icon="plus" variant="tonal" size="sm" onPress={() => setBlockSheet({ open: true, block: null, defaultStart: lastBlockEnd })} />}>
            Timeline
          </SectionTitle>
          <View className="flex-row gap-3" style={{ height: height + 16 }}>
            <View className="w-10" style={{ height }}>
              {hours.map((h) => {
                const top = (h * 60 - startMins) * PX_PER_MIN;
                if (top < -10 || top > height + 10) return null;
                return (
                  <Text key={h} className="absolute right-0 text-outline-variant text-[11px]" style={{ top: top - 7 }}>
                    {formatHour(h)}
                  </Text>
                );
              })}
            </View>
            <View className="flex-1 bg-surface-low rounded-xl border border-divider overflow-hidden" style={{ height }}>
              {hours.map((h) => {
                const top = (h * 60 - startMins) * PX_PER_MIN;
                if (top <= 0 || top >= height) return null;
                return <View key={h} className="absolute left-0 right-0 border-t border-divider" style={{ top }} />;
              })}
              {workday.blocks.map((b) => {
                const bs = minutesFromIso(b.startTime);
                const be = minutesFromIso(b.endTime);
                const top = (bs - startMins) * PX_PER_MIN;
                const h = Math.max((be - bs) * PX_PER_MIN, 22);
                const isCurrent = now >= bs && now < be;
                return (
                  <Pressable
                    key={b.id}
                    onPress={() => setBlockSheet({ open: true, block: b })}
                    className={`absolute left-2 right-2 rounded-lg px-2.5 py-1.5 ${isCurrent ? "border border-white/25" : ""}`}
                    style={{ top, height: h, backgroundColor: `${b.color}cc`, borderLeftWidth: 3, borderLeftColor: b.color }}
                  >
                    <Text className="text-white text-xs font-semibold" numberOfLines={1}>{b.name}</Text>
                    {h > 40 ? <Text className="text-white/70 text-[11px] mt-0.5">{formatBlockTime(b.startTime)} – {formatBlockTime(b.endTime)}</Text> : null}
                  </Pressable>
                );
              })}
              {showNow ? (
                <View pointerEvents="none" className="absolute left-0 right-0 flex-row items-center" style={{ top: (now - startMins) * PX_PER_MIN - 4 }}>
                  <View className="w-2 h-2 rounded-full bg-secondary" />
                  <View className="flex-1 h-px bg-secondary/60" />
                </View>
              ) : null}
            </View>
          </View>
        </View>

        {/* Goals */}
        <View className="bg-surface-low border border-divider rounded-2xl p-4">
          <SectionTitle right={workday.goals.length ? <Text className="text-outline-variant text-xs">{workday.goals.filter((g) => g.completed).length}/{workday.goals.length} completed</Text> : undefined}>
            Goals
          </SectionTitle>
          {workday.goals.length === 0 ? <Text className="text-outline-variant text-xs mb-3">No goals yet.</Text> : null}
          <View className="gap-1 mb-3">
            {workday.goals.map((g) => (
              <View key={g.id} className="flex-row items-start gap-2.5 py-1.5">
                <Pressable onPress={() => toggleGoal(g)} hitSlop={6} className={`w-4 h-4 rounded border mt-0.5 items-center justify-center ${g.completed ? "bg-primary-container border-primary-container" : "border-outline-variant"}`}>
                  {g.completed ? <Icon name="check" size={10} color={colors.onPrimary} strokeWidth={3} /> : null}
                </Pressable>
                <Text className={`flex-1 text-sm ${g.completed ? "line-through text-outline-variant" : "text-on-surface-variant"}`}>{g.title}</Text>
                <Pressable onPress={() => deleteGoal(g.id)} hitSlop={8}>
                  <Icon name="x" size={14} color={colors.outlineVariant} />
                </Pressable>
              </View>
            ))}
          </View>
          <View className="flex-row gap-2">
            <Field value={goalText} onChangeText={setGoalText} placeholder="Add a goal…" className="flex-1 py-2.5" onSubmitEditing={addGoal} returnKeyType="done" />
            <Pressable onPress={addGoal} disabled={!goalText.trim()} className={`w-11 rounded-xl bg-on-primary-container items-center justify-center ${goalText.trim() ? "" : "opacity-40"}`}>
              <Icon name="plus" size={16} color={colors.primaryContainer} strokeWidth={2} />
            </Pressable>
          </View>
        </View>
      </ScrollView>
      </KeyboardAvoidingView>

      <BlockSheet
        visible={blockSheet.open}
        initial={blockSheet.block ? {
          name: blockSheet.block.name,
          color: blockSheet.block.color,
          description: blockSheet.block.description,
          start: hhmmFromIso(blockSheet.block.startTime),
          end: hhmmFromIso(blockSheet.block.endTime),
          notifyOnStartMinutesBefore: blockSheet.block.notifyOnStartMinutesBefore,
        } : null}
        defaultStart={blockSheet.defaultStart}
        onSave={saveBlock}
        onDelete={blockSheet.block ? deleteBlock : undefined}
        onClose={() => setBlockSheet({ open: false, block: null })}
      />
      <EndOfDaySheet data={endOfDay} onAddToTasks={addGoalsAsTasks} onDismiss={() => setEndOfDay(null)} />
    </SafeAreaView>
  );
}
