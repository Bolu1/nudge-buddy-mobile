import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import Animated, { LayoutAnimationConfig } from "react-native-reanimated";
import { SafeAreaView } from "@/components/ui/SafeArea";
import { tasks as tasksApi, calendar as calendarApi } from "@/lib/api";
import { onChange } from "@/lib/events";
import { haptic } from "@/lib/haptics";
import { COMPLETE_SETTLE_MS, listEntering, listExiting, listLayout } from "@/lib/motion";
import { playTaskCompleteSound } from "@/lib/sounds";
import { PRIORITY_ORDER, formatDue, taskDue, type Task } from "@/lib/tasks";
import { colors, priorityStyle } from "@/lib/theme";
import { useCurrentBlock } from "@/lib/use-current-block";
import { useWorkdayBlocks } from "@/lib/use-workday-blocks";
import { Button, Checkbox, Icon, ScreenHeader, Segmented, SectionTitle } from "@/components/ui";
import { TaskSheet } from "@/components/tasks/TaskSheet";
import { Celebration } from "@/components/Celebration";

type CalendarState = "pending" | "done" | undefined;

function CalendarButton({ state, compact, onPress }: { state: CalendarState; compact?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={state === "pending"}
      className={`flex-row items-center gap-1 px-2 py-1 rounded-lg border ${state === "done" ? "bg-on-primary-container border-primary-container" : "bg-surface border-divider"} ${state === "pending" ? "opacity-40" : ""}`}
    >
      <Icon name={state === "done" ? "check" : "calendar"} size={11} color={state === "done" ? colors.primaryContainer : colors.outline} />
      <Text className={`text-[11px] font-medium ${state === "done" ? "text-primary-container" : "text-outline"}`}>
        {state === "done" ? "Added" : compact ? "+ Calendar" : "Add to calendar"}
      </Text>
    </Pressable>
  );
}

export default function TasksScreen() {
  const [taskList, setTaskList] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<"all" | "block">("all");
  const [sheet, setSheet] = useState<{ open: boolean; task: Task | null }>({ open: false, task: null });
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [calendarState, setCalendarState] = useState<Record<string, "pending" | "done">>({});
  // Ticked but not yet moved to Completed, so the checkmark can animate in place
  const [settling, setSettling] = useState<Set<string>>(new Set());
  // Set when the last open task gets ticked off here, to celebrate instead of showing an empty card
  const [cleared, setCleared] = useState(false);
  const { currentBlock } = useCurrentBlock();
  const { blocks, refetchWorkdayBlocks } = useWorkdayBlocks();

  const loadTasks = useCallback(async () => {
    try {
      const res = await tasksApi.list();
      setTaskList((res.data as { data?: Task[] } | null)?.data ?? []);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTasks();
    calendarApi.status().then((res) => {
      const d = res.data as { connected?: boolean; data?: { connected?: boolean } } | null;
      setCalendarConnected(!!(d?.connected ?? d?.data?.connected));
    }).catch(() => {});
    return onChange("tasks", loadTasks);
  }, [loadTasks]);

  async function refresh() {
    setRefreshing(true);
    await Promise.all([loadTasks(), refetchWorkdayBlocks()]);
    setRefreshing(false);
  }

  async function complete(id: string) {
    if (settling.has(id)) return;
    const lastOne = !taskList.some((t) => t.id !== id && t.status !== "COMPLETED" && !settling.has(t.id));
    playTaskCompleteSound();
    setSettling((s) => new Set(s).add(id));
    const request = tasksApi.complete(id);
    // Refetch only after the move, so a fast reply can't jump ahead of the tick
    const settled = new Promise<void>((resolve) => setTimeout(() => {
      setSettling((s) => { const n = new Set(s); n.delete(id); return n; });
      setTaskList((prev) => prev.map((t) => (t.id === id ? { ...t, status: "COMPLETED" } : t)));
      if (lastOne) setCleared(true);
      resolve();
    }, COMPLETE_SETTLE_MS));
    try { await Promise.all([request, settled]); } finally { loadTasks(); refetchWorkdayBlocks(); }
  }

  async function uncomplete(id: string) {
    setTaskList((prev) => prev.map((t) => (t.id === id ? { ...t, status: "PENDING" } : t)));
    try { await tasksApi.update(id, { status: "PENDING" }); } finally { loadTasks(); }
  }

  function confirmDelete(task: Task) {
    Alert.alert("Delete task?", task.title, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setTaskList((prev) => prev.filter((t) => t.id !== task.id));
          try { await tasksApi.delete(task.id); } catch { loadTasks(); }
        },
      },
    ]);
  }

  async function toggleSubtask(taskId: string, subtaskId: string) {
    haptic.selection();
    setTaskList((prev) =>
      prev.map((t) =>
        t.id === taskId ? { ...t, subtasks: t.subtasks?.map((s) => (s.id === subtaskId ? { ...s, completed: !s.completed } : s)) } : t,
      ),
    );
    try { await tasksApi.toggleSubtask(taskId, subtaskId); } catch { loadTasks(); }
  }

  async function addToCalendar(taskId: string) {
    setCalendarState((s) => ({ ...s, [taskId]: "pending" }));
    try {
      await calendarApi.addTask(taskId);
      setCalendarState((s) => ({ ...s, [taskId]: "done" }));
      setTimeout(() => setCalendarState((s) => { const n = { ...s }; delete n[taskId]; return n; }), 2500);
    } catch {
      setCalendarState((s) => { const n = { ...s }; delete n[taskId]; return n; });
    }
  }

  // /workday/current/block doesn't reliably include tasks — the workday's blocks list does
  const blockTasks = blocks.find((b) => b.id === currentBlock?.id)?.tasks ?? currentBlock?.tasks ?? [];
  const blockTaskIds = new Set(blockTasks.map((t) => t.id));
  const scoped = filter === "block" && currentBlock ? taskList.filter((t) => blockTaskIds.has(t.id)) : taskList;
  const active = scoped.filter((t) => t.status !== "COMPLETED").sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  const done = scoped.filter((t) => t.status === "COMPLETED");
  const focusTask = active[0] ?? null;
  const queue = active.slice(1);

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-bg">
      <ScreenHeader
        title="Stay present"
        subtitle={loading ? "Loading…" : `${active.length} active · ${done.length} completed`}
        right={<Button title="Add task" icon="plus" variant="tonal" size="sm" onPress={() => setSheet({ open: true, task: null })} />}
      />

      <View className="flex-row items-center justify-between gap-2 px-4 py-2.5 border-b border-divider">
        <View className="flex-row items-center gap-1.5 flex-1">
          {currentBlock ? (
            <>
              <View className="w-2 h-2 rounded-full" style={{ backgroundColor: currentBlock.color }} />
              <Text className="text-outline text-xs" numberOfLines={1}>
                Currently in: <Text className="text-on-surface-variant font-medium">{currentBlock.name}</Text>
              </Text>
            </>
          ) : (
            <Text className="text-outline text-xs">No active block</Text>
          )}
        </View>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[{ value: "all", label: "All" }, { value: "block", label: "This block", disabled: !currentBlock }]}
        />
      </View>

      <ScrollView
        contentContainerClassName="p-4 gap-6 pb-32"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primaryContainer} />}
      >
        {loading ? (
          <View className="gap-3">
            {[1, 2, 3].map((i) => <View key={i} className="bg-surface-low border border-divider rounded-xl h-16 opacity-60" />)}
          </View>
        ) : (
          // Rows already there on first render appear as-is; later changes animate
          <LayoutAnimationConfig skipEntering>
            {focusTask ? (
              <Animated.View
                key={focusTask.id}
                entering={listEntering}
                exiting={listExiting}
                layout={listLayout}
                className="rounded-2xl bg-[#1a2b1a] border border-on-primary-container p-5"
              >
                <View className="flex-row items-center justify-between mb-4">
                  <View className="flex-row items-center gap-2 flex-1">
                    <View className="w-2 h-2 rounded-full bg-primary-container" />
                    <Text className="text-primary-container text-[11px] font-medium tracking-wide uppercase">Focus · Current priority</Text>
                  </View>
                  <View className="flex-row items-center gap-1">
                    {calendarConnected ? <CalendarButton state={calendarState[focusTask.id]} onPress={() => addToCalendar(focusTask.id)} /> : null}
                    <Pressable onPress={() => setSheet({ open: true, task: focusTask })} hitSlop={8} className="p-1.5">
                      <Icon name="edit" size={15} color={colors.outline} />
                    </Pressable>
                  </View>
                </View>
                <View className="flex-row items-start gap-4">
                  <View className="mt-1">
                    <Checkbox checked={settling.has(focusTask.id)} onPress={() => complete(focusTask.id)} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-on-surface text-lg font-semibold leading-6">{focusTask.title}</Text>
                    {focusTask.description ? <Text className="text-outline text-sm mt-1 leading-5">{focusTask.description}</Text> : null}
                    {taskDue(focusTask) ? <Text className="text-primary-container text-xs mt-2">Due: {formatDue(taskDue(focusTask))}</Text> : null}
                  </View>
                </View>
                {focusTask.subtasks?.length ? (
                  <View className="mt-5 gap-3">
                    {focusTask.subtasks.map((s) => (
                      <Pressable key={s.id} onPress={() => toggleSubtask(focusTask.id, s.id)} className="flex-row items-center gap-3">
                        <View className={`w-4 h-4 rounded items-center justify-center border ${s.completed ? "bg-primary-container border-primary-container" : "border-outline-variant"}`}>
                          {s.completed ? <Icon name="check" size={10} color={colors.onPrimary} strokeWidth={3} /> : null}
                        </View>
                        <Text className={`text-sm flex-1 ${s.completed ? "text-outline line-through" : "text-on-surface-variant"}`}>{s.title}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </Animated.View>
            ) : cleared && done.length > 0 ? (
              <Animated.View entering={listEntering} layout={listLayout} className="rounded-2xl bg-surface-low border border-divider p-6 items-center gap-1">
                <Celebration title="All clear!" />
                <Text className="text-outline text-sm text-center">Every task is done. Enjoy the space.</Text>
              </Animated.View>
            ) : (
              <Animated.View entering={listEntering} layout={listLayout} className="rounded-2xl bg-surface-low border border-divider p-8 items-center">
                <Text className="text-outline text-sm">No active tasks. Add one above.</Text>
              </Animated.View>
            )}

            {queue.length > 0 ? (
              <Animated.View entering={listEntering} exiting={listExiting} layout={listLayout}>
                <SectionTitle>Up next</SectionTitle>
                <View className="gap-2">
                  {queue.map((task) => {
                    const p = priorityStyle[task.priority];
                    return (
                      <Animated.View key={task.id} entering={listEntering} exiting={listExiting} layout={listLayout}>
                      <Pressable
                        onPress={() => setSheet({ open: true, task })}
                        onLongPress={() => confirmDelete(task)}
                        className="bg-surface-low border border-divider rounded-xl p-4 active:border-outline-variant"
                      >
                        <View className="flex-row items-center gap-3">
                          <Checkbox checked={settling.has(task.id)} size={18} onPress={() => complete(task.id)} />
                          <Text className="flex-1 text-on-surface-variant text-sm leading-5">{task.title}</Text>
                          <View className="px-2 py-0.5 rounded-full border" style={{ backgroundColor: p.bg, borderColor: p.border }}>
                            <Text className="text-[11px]" style={{ color: p.text }}>{task.priority.toLowerCase()}</Text>
                          </View>
                        </View>
                        {taskDue(task) || calendarConnected ? (
                          <View className="flex-row items-center justify-between mt-2 ml-8">
                            <Text className="text-outline text-xs">{formatDue(taskDue(task))}</Text>
                            {calendarConnected ? <CalendarButton state={calendarState[task.id]} compact onPress={() => addToCalendar(task.id)} /> : null}
                          </View>
                        ) : null}
                      </Pressable>
                      </Animated.View>
                    );
                  })}
                </View>
              </Animated.View>
            ) : null}

            {done.length > 0 ? (
              <Animated.View entering={listEntering} exiting={listExiting} layout={listLayout}>
                <SectionTitle>Completed</SectionTitle>
                <View className="gap-2">
                  {done.map((task) => (
                    <Animated.View
                      key={task.id}
                      entering={listEntering}
                      exiting={listExiting}
                      layout={listLayout}
                      className="bg-surface-low/50 border border-surface-high/50 rounded-xl p-4 flex-row items-center gap-3"
                    >
                      <Pressable
                        onPress={() => uncomplete(task.id)}
                        hitSlop={8}
                        accessibilityLabel="Mark as active"
                        className="w-[18px] h-[18px] rounded-full bg-outline-variant items-center justify-center"
                      >
                        <Icon name="check" size={10} color={colors.bg} strokeWidth={3} />
                      </Pressable>
                      <Text className="text-outline text-sm line-through flex-1">{task.title}</Text>
                      <Pressable onPress={() => confirmDelete(task)} hitSlop={8} accessibilityLabel="Delete task">
                        <Icon name="trash" size={15} color={colors.outline} />
                      </Pressable>
                    </Animated.View>
                  ))}
                </View>
              </Animated.View>
            ) : null}

            <Animated.View layout={listLayout} className="bg-surface-low border border-divider rounded-2xl p-5">
              <SectionTitle>Today</SectionTitle>
              <View className="flex-row items-center justify-between mb-2">
                <Text className="text-on-surface-variant text-sm">Completed</Text>
                <Text className="text-primary text-sm font-medium">{done.length}/{taskList.length}</Text>
              </View>
              <View className="w-full bg-surface-high rounded-full h-1.5">
                <Animated.View layout={listLayout} className="bg-primary-container h-1.5 rounded-full" style={{ width: taskList.length ? `${(done.length / taskList.length) * 100}%` : "0%" }} />
              </View>
            </Animated.View>
          </LayoutAnimationConfig>
        )}
      </ScrollView>

      <TaskSheet
        visible={sheet.open}
        task={sheet.task}
        blocks={blocks}
        calendarConnected={calendarConnected}
        onClose={() => setSheet({ open: false, task: null })}
        onSaved={loadTasks}
      />
    </SafeAreaView>
  );
}
