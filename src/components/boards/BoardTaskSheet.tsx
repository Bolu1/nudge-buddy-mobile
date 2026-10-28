import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { boards as boardsApi } from "@/lib/api";
import { apiError, fullName, type BoardMemberInfo, type BoardTask, type Priority } from "@/lib/boards";
import { PRIORITY_OPTIONS } from "@/lib/tasks";
import { useOpenKey } from "@/lib/use-open-key";
import { colors } from "@/lib/theme";
import { Avatar } from "@/components/Avatar";
import { Button, ErrorBanner, Field, Icon, Label, SelectField, Sheet } from "@/components/ui";
import { DateTimeField } from "@/components/ui/DateTimeField";

function BoardTaskSheetForm({
  visible,
  boardId,
  task,
  members,
  isOwner,
  onClose,
  onSaved,
}: {
  visible: boolean;
  boardId: string;
  task: BoardTask | null;
  members: BoardMemberInfo[];
  isOwner: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Fresh on every open (see useOpenKey below) — initialised from the task
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [priority, setPriority] = useState<Priority>(task?.priority ?? "MEDIUM");
  const [dueAt, setDueAt] = useState<Date | null>(task?.dueAt ? new Date(task.dueAt) : null);
  const [assignees, setAssignees] = useState<string[]>(() => task?.assignees.map((a) => a.userId) ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const initialAssignees = task?.assignees.map((a) => a.userId) ?? [];

  function toggleAssignee(id: string) {
    setAssignees((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function save() {
    if (!title.trim()) return;
    setSaving(true);
    setError("");
    const fields = { title: title.trim(), description: description.trim(), priority };
    let res;
    if (!task) {
      res = await boardsApi.createTask(boardId, {
        ...fields,
        ...(dueAt ? { dueAt: dueAt.toISOString() } : {}),
        ...(isOwner && assignees.length ? { assigneeIds: assignees } : {}),
      });
    } else {
      res = await boardsApi.updateTask(boardId, task.id, { ...fields, dueAt: dueAt ? dueAt.toISOString() : null });
      const changed = assignees.length !== initialAssignees.length || assignees.some((id) => !initialAssignees.includes(id));
      if (res.ok && isOwner && changed) res = await boardsApi.setAssignees(boardId, task.id, assignees);
    }
    setSaving(false);
    if (!res.ok) { setError(apiError(res)); return; }
    onSaved();
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={task ? "Edit task" : "New task"}
      footer={
        <View className="flex-row justify-end gap-2">
          <Button title="Cancel" variant="ghost" onPress={onClose} />
          <Button title={saving ? "Saving…" : task ? "Save changes" : "Add task"} onPress={save} loading={saving} disabled={!title.trim()} />
        </View>
      }
    >
      <Field value={title} onChangeText={setTitle} placeholder="Task title…" autoFocus={!task} className="text-base font-medium" />
      <Field value={description} onChangeText={setDescription} placeholder="Description… (optional)" multiline />
      <View>
        <Label>Priority</Label>
        <SelectField value={priority} options={PRIORITY_OPTIONS} onChange={setPriority} title="Priority" />
      </View>
      <View>
        <Label>Due date</Label>
        <DateTimeField value={dueAt} onChange={setDueAt} placeholder="No due date" />
      </View>
      {isOwner ? (
        <View>
          <Label>Assign to</Label>
          <View className="gap-1">
            {members.map((m) => {
              const on = assignees.includes(m.id);
              return (
                <Pressable key={m.id} onPress={() => toggleAssignee(m.id)} className={`flex-row items-center gap-3 px-3 py-2 rounded-xl ${on ? "bg-on-primary-container/60" : "active:bg-surface-high"}`}>
                  <Avatar id={m.id} firstName={m.firstName} lastName={m.lastName} size={26} />
                  <Text className="text-on-surface-variant text-sm flex-1">{fullName(m)}</Text>
                  {on ? <Icon name="check" size={16} color={colors.primaryContainer} /> : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
      <ErrorBanner message={error} />
    </Sheet>
  );
}

/**
 * Create or edit a board task. Only the owner sees the assignee picker —
 * the API rejects assignment from anyone else.
 */
export function BoardTaskSheet(props: Parameters<typeof BoardTaskSheetForm>[0]) {
  const openKey = useOpenKey(props.visible);
  return <BoardTaskSheetForm key={openKey} {...props} />;
}
