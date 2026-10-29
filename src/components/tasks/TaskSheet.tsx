import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { tasks as tasksApi, calendar as calendarApi } from "@/lib/api";
import { emitChange } from "@/lib/events";
import { PRIORITY_OPTIONS, taskDue, type Priority, type Subtask, type Task } from "@/lib/tasks";
import { colors } from "@/lib/theme";
import type { WorkdayBlockOption } from "@/lib/use-workday-blocks";
import { Button, Checkbox, Field, Icon, Label, SelectField, Sheet } from "@/components/ui";
import { DateTimeField } from "@/components/ui/DateTimeField";
import { useToast } from "@/lib/toast-context";
import { useOpenKey } from "@/lib/use-open-key";

type DraftSubtask = Subtask & { isNew?: boolean };

function TaskSheetForm({
  visible,
  task,
  blocks,
  calendarConnected,
  onClose,
  onSaved,
}: {
  visible: boolean;
  task: Task | null;
  blocks: WorkdayBlockOption[];
  calendarConnected?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const editing = !!task;
  // Fresh on every open (see useOpenKey below) — initialised from the task
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [priority, setPriority] = useState<Priority>(task?.priority ?? "MEDIUM");
  const [dueAt, setDueAt] = useState<Date | null>(() => {
    const due = task ? taskDue(task) : undefined;
    return due ? new Date(due) : null;
  });
  const [blockId, setBlockId] = useState(task?.workdayBlockId ?? "");
  const [showReminder, setShowReminder] = useState(!!task?.reminder);
  const [reminderMsg, setReminderMsg] = useState(task?.reminder?.message ?? "");
  const [reminderAt, setReminderAt] = useState<Date | null>(task?.reminder?.remindAt ? new Date(task.reminder.remindAt) : null);
  const [addToCalendar, setAddToCalendar] = useState(false);
  const [subtasks, setSubtasks] = useState<DraftSubtask[]>(() => (task?.subtasks ?? []).map((s) => ({ ...s })));
  const [newSubtask, setNewSubtask] = useState("");
  const [saving, setSaving] = useState(false);

  function addSubtaskDraft() {
    const t = newSubtask.trim();
    if (!t) return;
    setSubtasks((prev) => [...prev, { id: `new-${Date.now()}-${Math.random().toString(36).slice(2)}`, title: t, completed: false, isNew: true }]);
    setNewSubtask("");
  }

  async function save() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      if (task) {
        const res = await tasksApi.update(task.id, {
          title: title.trim(),
          description: description.trim() || undefined,
          priority,
          dueDate: dueAt ? dueAt.toISOString() : undefined,
          ...(reminderAt ? { reminderAt: reminderAt.toISOString() } : {}),
          // "" explicitly unassigns — omit the field entirely when nothing changed
          ...(blockId !== (task.workdayBlockId ?? "") ? { workdayBlockId: blockId } : {}),
        });
        if (!res.ok) throw new Error();
        const original = task.subtasks ?? [];
        const additions = subtasks.filter((s) => s.isNew);
        const removals = original.filter((o) => !subtasks.some((d) => d.id === o.id));
        const toggled = subtasks.filter((d) => !d.isNew && original.find((o) => o.id === d.id)?.completed !== d.completed);
        await Promise.all([
          ...additions.map((s) => tasksApi.addSubtask(task.id, { title: s.title })),
          ...removals.map((s) => tasksApi.deleteSubtask(task.id, s.id)),
          ...toggled.map((s) => tasksApi.toggleSubtask(task.id, s.id)),
        ]);
      } else {
        const res = await tasksApi.create({
          title: title.trim(),
          priority,
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(dueAt ? { dueAt: dueAt.toISOString() } : {}),
          ...(blockId ? { workdayBlockId: blockId } : {}),
          ...(showReminder && reminderMsg.trim() && reminderAt
            ? { reminder: { message: reminderMsg.trim(), remindAt: reminderAt.toISOString() } }
            : {}),
        });
        if (!res.ok) throw new Error();
        const data = res.data as { data?: { id?: string }; id?: string } | null;
        const taskId = data?.data?.id ?? data?.id;
        if (addToCalendar && taskId) calendarApi.addTask(taskId).catch(() => {});
      }
      emitChange("tasks");
      emitChange("workday");
      onSaved();
      onClose();
    } catch {
      toast.error(editing ? "Couldn't save the task." : "Couldn't add the task.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={editing ? "Edit task" : "New task"}
      footer={
        <View className="flex-row justify-end gap-2">
          <Button title="Cancel" variant="ghost" onPress={onClose} />
          <Button
            title={saving ? (editing ? "Saving…" : "Adding…") : editing ? "Save changes" : "Add task"}
            onPress={save}
            loading={saving}
            disabled={!title.trim()}
          />
        </View>
      }
    >
      <Field value={title} onChangeText={setTitle} placeholder="Task title…" autoFocus={!editing} className="text-base font-medium" />
      <Field value={description} onChangeText={setDescription} placeholder="Add a description… (optional)" multiline />

      <View className="flex-row gap-3">
        <View className="flex-1">
          <Label>Priority</Label>
          <SelectField value={priority} options={PRIORITY_OPTIONS} onChange={setPriority} title="Priority" />
        </View>
      </View>
      <View>
        <Label>Due date</Label>
        <DateTimeField value={dueAt} onChange={setDueAt} placeholder="No due date" />
      </View>

      {blocks.length > 0 ? (
        <View>
          <Label>Block</Label>
          <SelectField
            value={blockId}
            options={[{ value: "", label: "No block" }, ...blocks.map((b) => ({ value: b.id, label: b.name, color: b.color }))]}
            onChange={setBlockId}
            placeholder="No block"
            title="Workday block"
          />
        </View>
      ) : null}

      {editing ? (
        <View className="gap-3">
          <Label className="mb-0">Reminder</Label>
          <Field value={reminderMsg} onChangeText={setReminderMsg} placeholder="e.g. Don't forget to…" />
          <DateTimeField value={reminderAt} onChange={setReminderAt} placeholder="Remind at" />
        </View>
      ) : (
        <View>
          <Pressable onPress={() => setShowReminder((s) => !s)} className="flex-row items-center gap-2 py-1">
            <Icon name="bell" size={14} color={colors.outline} />
            <Text className="text-outline text-sm">{showReminder ? "Remove reminder" : "Add reminder"}</Text>
          </Pressable>
          {showReminder ? (
            <View className="gap-3 mt-3">
              <Field value={reminderMsg} onChangeText={setReminderMsg} placeholder="Reminder message, e.g. Don't forget to…" />
              <DateTimeField value={reminderAt} onChange={setReminderAt} placeholder="Remind at" minimumDate={new Date()} />
            </View>
          ) : null}
        </View>
      )}

      {editing ? (
        <View className="gap-2">
          <Label className="mb-1">Subtasks</Label>
          {subtasks.map((s) => (
            <View key={s.id} className="flex-row items-center gap-3">
              <Checkbox
                checked={s.completed}
                size={18}
                onPress={() => setSubtasks((prev) => prev.map((x) => (x.id === s.id ? { ...x, completed: !x.completed } : x)))}
              />
              <Text className={`flex-1 text-sm ${s.completed ? "text-outline line-through" : "text-on-surface-variant"}`}>{s.title}</Text>
              <Pressable onPress={() => setSubtasks((prev) => prev.filter((x) => x.id !== s.id))} hitSlop={8}>
                <Icon name="x" size={14} color={colors.outline} />
              </Pressable>
            </View>
          ))}
          {subtasks.length === 0 ? <Text className="text-outline text-xs">No subtasks yet.</Text> : null}
          <View className="flex-row items-center gap-2 mt-1">
            <Field
              value={newSubtask}
              onChangeText={setNewSubtask}
              placeholder="Add a subtask…"
              className="flex-1 py-2"
              returnKeyType="done"
              onSubmitEditing={addSubtaskDraft}
              blurOnSubmit={false}
            />
            <Button title="Add" variant="tonal" size="sm" onPress={addSubtaskDraft} disabled={!newSubtask.trim()} />
          </View>
          <Text className="text-outline text-xs mt-2">
            Set priority to <Text className="text-primary font-semibold">High</Text> to promote this task to the focus card.
          </Text>
        </View>
      ) : null}

      {!editing && calendarConnected ? (
        <Pressable onPress={() => setAddToCalendar((v) => !v)} className="flex-row items-center gap-3">
          <Checkbox checked={addToCalendar} size={18} onPress={() => setAddToCalendar((v) => !v)} />
          <Icon name="calendar" size={14} color={colors.outline} />
          <Text className="text-outline text-sm">Add to Google Calendar</Text>
        </Pressable>
      ) : null}
    </Sheet>
  );
}

/**
 * Add (task = null) or edit a task. Like the web modal, subtask changes are
 * staged locally and only committed on Save, so Cancel really cancels.
 */
export function TaskSheet(props: Parameters<typeof TaskSheetForm>[0]) {
  const openKey = useOpenKey(props.visible);
  return <TaskSheetForm key={openKey} {...props} />;
}
