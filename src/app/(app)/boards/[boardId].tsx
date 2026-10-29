import { useCallback, useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "@/components/ui/SafeArea";
import { router, useLocalSearchParams } from "expo-router";
import { boards as boardsApi } from "@/lib/api";
import { ROLE_LABEL, apiError, canEditTasks, fullName, unwrap, type BoardDetail, type BoardTask } from "@/lib/boards";
import { emitChange } from "@/lib/events";
import { playTaskCompleteSound } from "@/lib/sounds";
import { PRIORITY_ORDER, formatDue } from "@/lib/tasks";
import { colors, priorityStyle } from "@/lib/theme";
import { useWs } from "@/lib/ws-context";
import { Avatar } from "@/components/Avatar";
import { BoardFormSheet } from "@/components/boards/BoardFormSheet";
import { BoardTaskSheet } from "@/components/boards/BoardTaskSheet";
import { MembersSection } from "@/components/boards/MembersSection";
import { Button, Icon, IconButton, Segmented, SectionTitle, Spinner } from "@/components/ui";

function completeHint(task: BoardTask): string {
  if (task.canComplete) return task.completedAt ? "Mark as open" : "Mark as done";
  return task.assignees.length
    ? "Only people assigned to this task can mark it done"
    : "Only editors or the owner can mark unassigned tasks done";
}

function Assignees({ task }: { task: BoardTask }) {
  if (!task.assignees.length) return null;
  return (
    <View className="flex-row">
      {task.assignees.slice(0, 3).map((a, i) => (
        <View key={a.userId} style={{ marginLeft: i ? -6 : 0 }}>
          <Avatar id={a.userId} firstName={a.account.firstName} lastName={a.account.lastName} size={22} ring={colors.surfaceLow} />
        </View>
      ))}
      {task.assignees.length > 3 ? (
        <View className="w-[22px] h-[22px] rounded-full bg-surface-high items-center justify-center" style={{ marginLeft: -6 }}>
          <Text className="text-outline text-[9px]">+{task.assignees.length - 3}</Text>
        </View>
      ) : null}
    </View>
  );
}

export default function BoardScreen() {
  const { boardId } = useLocalSearchParams<{ boardId: string }>();
  const { addListener } = useWs();
  const [board, setBoard] = useState<BoardDetail | null>(null);
  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [filter, setFilter] = useState<"all" | "mine">("all");
  const [error, setError] = useState("");
  const [editingBoard, setEditingBoard] = useState(false);
  const [taskSheet, setTaskSheet] = useState<{ open: boolean; task: BoardTask | null }>({ open: false, task: null });

  const goBack = useCallback(() => (router.canGoBack() ? router.back() : router.replace("/boards")), []);

  const load = useCallback(async () => {
    const [b, t] = await Promise.all([boardsApi.get(boardId), boardsApi.tasks(boardId)]);
    if (!b.ok) { setNotFound(true); setLoading(false); return; }
    setBoard(unwrap<BoardDetail>(b));
    if (t.ok) setTasks(unwrap<BoardTask[]>(t) ?? []);
    setLoading(false);
  }, [boardId]);

  useEffect(() => { load(); }, [load]);

  // Live updates from other members
  useEffect(() => addListener((msg) => {
    if (msg.type !== "board_updated" || msg.boardId !== boardId) return;
    if (msg.change === "deleted" || msg.change === "removed") router.replace("/boards");
    else load();
  }), [addListener, boardId, load]);

  async function toggleComplete(task: BoardTask) {
    if (!task.canComplete) { Alert.alert(completeHint(task)); return; }
    const completing = !task.completedAt;
    if (completing) playTaskCompleteSound();
    setError("");
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, completedAt: completing ? new Date().toISOString() : null } : t)));
    const res = completing ? await boardsApi.completeTask(boardId, task.id) : await boardsApi.reopenTask(boardId, task.id);
    if (!res.ok) setError(apiError(res));
    load();
  }

  function deleteTask(task: BoardTask) {
    Alert.alert("Delete task?", `Delete "${task.title}"? This can't be undone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setError("");
          setTasks((prev) => prev.filter((t) => t.id !== task.id));
          const res = await boardsApi.deleteTask(boardId, task.id);
          if (!res.ok) setError(apiError(res));
          load();
        },
      },
    ]);
  }

  if (notFound) {
    return (
      <SafeAreaView className="flex-1 bg-bg items-center justify-center gap-3 p-8">
        <Text className="text-on-surface-variant text-sm text-center">This board doesn&apos;t exist or you&apos;re no longer a member.</Text>
        <Button title="Back to boards" variant="tonal" onPress={() => router.replace("/boards")} />
      </SafeAreaView>
    );
  }

  const editor = canEditTasks(board?.role);
  const isOwner = board?.role === "OWNER";
  const scoped = filter === "mine" ? tasks.filter((t) => t.assignees.some((a) => a.userId === board?.viewerId)) : tasks;
  const open = scoped.filter((t) => !t.completedAt).sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  const done = scoped.filter((t) => t.completedAt);

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-bg">
      <View className="px-2 pt-1 pb-3 border-b border-divider">
        <View className="flex-row items-center justify-between">
          <IconButton name="chevron-left" onPress={goBack} accessibilityLabel="Back to boards" />
          <View className="flex-row items-center gap-1">
            {isOwner ? <IconButton name="edit" onPress={() => setEditingBoard(true)} accessibilityLabel="Edit board" /> : null}
            {editor ? <Button title="Add task" icon="plus" variant="tonal" size="sm" onPress={() => setTaskSheet({ open: true, task: null })} /> : null}
          </View>
        </View>
        <View className="px-2">
          <View className="flex-row items-center gap-2 mt-1">
            {board ? <View className="w-3 h-3 rounded-full" style={{ backgroundColor: board.color ?? "#8da38a" }} /> : null}
            <Text className="text-on-surface text-2xl font-semibold tracking-tight flex-1" numberOfLines={1}>{board?.name ?? "Loading…"}</Text>
          </View>
          {board?.description ? <Text className="text-outline text-sm mt-1">{board.description}</Text> : null}
          {board ? (
            <Text className="text-outline-variant text-xs mt-2">
              {open.length} open · {done.length} done · You&apos;re {ROLE_LABEL[board.role].toLowerCase()}
            </Text>
          ) : null}
        </View>
      </View>

      {loading ? <Spinner /> : (
        <KeyboardAvoidingView behavior="padding" className="flex-1">
        <ScrollView
          contentContainerClassName="p-4 gap-6 pb-32"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.primaryContainer} />}
        >
          <View className="flex-row justify-end">
            <Segmented value={filter} onChange={setFilter} options={[{ value: "all", label: "All" }, { value: "mine", label: "Assigned to me" }]} />
          </View>
          {error ? <Text className="text-secondary text-xs bg-secondary-container/30 border border-secondary-container rounded-lg px-3 py-2">{error}</Text> : null}

          <View>
            <SectionTitle>To do</SectionTitle>
            {open.length === 0 ? (
              <View className="rounded-2xl bg-surface-low border border-divider p-8 items-center">
                <Text className="text-outline-variant text-sm">
                  {filter === "mine" ? "Nothing assigned to you here." : editor ? "No open tasks. Add one above." : "No open tasks."}
                </Text>
              </View>
            ) : (
              <View className="gap-2">
                {open.map((task) => {
                  const p = priorityStyle[task.priority];
                  return (
                    <Pressable
                      key={task.id}
                      onPress={editor ? () => setTaskSheet({ open: true, task }) : undefined}
                      onLongPress={editor ? () => deleteTask(task) : undefined}
                      className="bg-surface-low border border-divider rounded-xl p-4"
                    >
                      <View className="flex-row items-center gap-3">
                        <Pressable
                          onPress={() => toggleComplete(task)}
                          hitSlop={8}
                          accessibilityLabel={completeHint(task)}
                          className={`w-[18px] h-[18px] rounded-full border border-outline-variant ${task.canComplete ? "" : "opacity-30"}`}
                        />
                        <Text className="flex-1 text-on-surface-variant text-sm leading-5">{task.title}</Text>
                        <Assignees task={task} />
                        <View className="px-2 py-0.5 rounded-full border" style={{ backgroundColor: p.bg, borderColor: p.border }}>
                          <Text className="text-[11px]" style={{ color: p.text }}>{task.priority.toLowerCase()}</Text>
                        </View>
                      </View>
                      {task.description || task.dueAt ? (
                        <View className="ml-8 mt-2 gap-1">
                          {task.description ? <Text className="text-outline text-xs leading-5" numberOfLines={2}>{task.description}</Text> : null}
                          {task.dueAt ? <Text className="text-outline-variant text-xs">{formatDue(task.dueAt)}</Text> : null}
                        </View>
                      ) : null}
                    </Pressable>
                  );
                })}
                {editor ? <Text className="text-outline-variant text-[11px] text-center mt-1">Tap to edit · hold to delete</Text> : null}
              </View>
            )}
          </View>

          {done.length > 0 ? (
            <View>
              <SectionTitle>Completed</SectionTitle>
              <View className="gap-2">
                {done.map((task) => (
                  <Pressable
                    key={task.id}
                    onLongPress={editor ? () => deleteTask(task) : undefined}
                    className="bg-surface-low/50 border border-surface-high/50 rounded-xl p-4 flex-row items-center gap-3"
                  >
                    <Pressable
                      onPress={() => toggleComplete(task)}
                      hitSlop={8}
                      accessibilityLabel={completeHint(task)}
                      className="w-[18px] h-[18px] rounded-full bg-outline-variant items-center justify-center"
                    >
                      <Icon name="check" size={10} color={colors.bg} strokeWidth={3} />
                    </Pressable>
                    <Text className="text-outline-variant text-sm line-through flex-1">{task.title}</Text>
                    {task.completedBy ? (
                      <Text className="text-outline-variant text-xs">
                        by {task.completedBy.id === board?.viewerId ? "you" : fullName(task.completedBy)}
                      </Text>
                    ) : null}
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {board ? (
            <MembersSection board={board} onChanged={load} onGone={() => { emitChange("boards"); router.replace("/boards"); }} />
          ) : null}
        </ScrollView>
        </KeyboardAvoidingView>
      )}

      {board ? (
        <>
          <BoardFormSheet
            visible={editingBoard}
            board={board}
            onClose={() => setEditingBoard(false)}
            onSaved={() => { setEditingBoard(false); load(); emitChange("boards"); }}
          />
          <BoardTaskSheet
            visible={taskSheet.open}
            boardId={board.id}
            task={taskSheet.task}
            members={board.members}
            isOwner={isOwner}
            onClose={() => setTaskSheet({ open: false, task: null })}
            onSaved={() => { setTaskSheet({ open: false, task: null }); load(); }}
          />
        </>
      ) : null}
    </SafeAreaView>
  );
}
