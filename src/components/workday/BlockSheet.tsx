import { useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { getPref, setPref } from "@/lib/storage";
import { useOpenKey } from "@/lib/use-open-key";
import { colors } from "@/lib/theme";
import { COLOR_PRESETS, minutesFromHHMM, minutesToHHMM, timeOptionsWith, type BlockDraft } from "@/lib/workday";
import { Button, ErrorBanner, Field, Icon, Label, SelectField, Sheet } from "@/components/ui";

const LAST_REMINDER_KEY = "nudge:lastBlockReminderMinutesBefore";
const REMINDER_OPTIONS = [0, 5, 10, 15, 30, 60].map((m) => ({
  value: String(m),
  label: m === 0 ? "At start" : `${m} min before`,
}));

function BlockSheetForm({
  visible,
  initial,
  defaultStart,
  onSave,
  onDelete,
  onClose,
}: {
  visible: boolean;
  /** Existing block to edit, or null for a new one */
  initial: BlockDraft | null;
  defaultStart?: string;
  onSave: (draft: BlockDraft) => Promise<void> | void;
  onDelete?: () => Promise<void> | void;
  onClose: () => void;
}) {
  // Fresh on every open (see useOpenKey below) — initialised from the block
  const firstStart = initial?.start ?? defaultStart ?? "09:00";
  const [name, setName] = useState(initial?.name ?? "");
  const [color, setColor] = useState(initial?.color ?? COLOR_PRESETS[0]);
  const [description, setDescription] = useState(initial?.description ?? "");
  const [start, setStart] = useState(firstStart);
  const [end, setEnd] = useState(initial?.end ?? minutesToHHMM(minutesFromHHMM(firstStart) + 60));
  // New blocks reuse the reminder lead time the user picked last
  const [reminder, setReminder] = useState(() => String(initial?.notifyOnStartMinutesBefore ?? (Number(getPref(LAST_REMINDER_KEY)) || 0)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!name.trim()) { setError("Block name required."); return; }
    if (minutesFromHHMM(end) <= minutesFromHHMM(start)) { setError("End must be after start."); return; }
    setSaving(true);
    setError("");
    setPref(LAST_REMINDER_KEY, reminder);
    try {
      await onSave({
        name: name.trim(),
        color,
        description: description.trim() || undefined,
        start,
        end,
        notifyOnStartMinutesBefore: Number(reminder),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save block.");
      setSaving(false);
    }
  }

  function confirmDelete() {
    if (!onDelete) return;
    Alert.alert("Delete block?", name, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try { await onDelete(); } catch { setError("Failed to delete block."); }
        },
      },
    ]);
  }

  // Keep a picked custom colour visible as a swatch
  const swatches = COLOR_PRESETS.includes(color) ? COLOR_PRESETS : [...COLOR_PRESETS.slice(1), color];

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={initial ? "Edit block" : "New block"}
      footer={
        <View className="flex-row items-center gap-2">
          {onDelete ? (
            <Pressable onPress={confirmDelete} hitSlop={8} className="p-2 mr-auto">
              <Icon name="trash" size={18} color={colors.secondary} />
            </Pressable>
          ) : <View className="mr-auto" />}
          <Button title="Cancel" variant="ghost" onPress={onClose} />
          <Button title={saving ? "Saving…" : "Save block"} onPress={save} loading={saving} />
        </View>
      }
    >
      <ErrorBanner message={error} />
      <View>
        <Label>Name</Label>
        <Field value={name} onChangeText={setName} placeholder="Deep Work" autoFocus={!initial} />
      </View>
      <View>
        <Label>Color</Label>
        <View className="flex-row flex-wrap gap-2.5">
          {swatches.map((c) => (
            <Pressable
              key={c}
              onPress={() => setColor(c)}
              accessibilityLabel={`Color ${c}`}
              className={`w-8 h-8 rounded-full items-center justify-center ${color === c ? "border-2 border-on-surface" : ""}`}
              style={{ backgroundColor: c }}
            >
              {color === c ? <Icon name="check" size={14} color="#fff" strokeWidth={3} /> : null}
            </Pressable>
          ))}
        </View>
      </View>
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Label>Start</Label>
          <SelectField value={start} options={timeOptionsWith(start)} onChange={setStart} title="Start time" />
        </View>
        <View className="flex-1">
          <Label>End</Label>
          <SelectField value={end} options={timeOptionsWith(end)} onChange={setEnd} title="End time" />
        </View>
      </View>
      <View>
        <Label>Description</Label>
        <Field value={description} onChangeText={setDescription} placeholder="What's this block for? (optional)" multiline />
      </View>
      <View>
        <Label>Reminder</Label>
        <SelectField value={reminder} options={REMINDER_OPTIONS} onChange={setReminder} title="Notify me" />
      </View>
    </Sheet>
  );
}

/** Add or edit a time block — used by the live workday and the start-day planner */
export function BlockSheet(props: Parameters<typeof BlockSheetForm>[0]) {
  const openKey = useOpenKey(props.visible);
  return <BlockSheetForm key={openKey} {...props} />;
}
