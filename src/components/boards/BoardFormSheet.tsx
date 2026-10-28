import { useState } from "react";
import { Pressable, View } from "react-native";
import { boards as boardsApi } from "@/lib/api";
import { BOARD_COLORS, apiError, unwrap } from "@/lib/boards";
import { useOpenKey } from "@/lib/use-open-key";
import { Button, ErrorBanner, Field, Icon, Label, Sheet } from "@/components/ui";

function BoardFormSheetForm({
  visible,
  board,
  onClose,
  onSaved,
}: {
  visible: boolean;
  board?: { id: string; name: string; description: string | null; color: string | null } | null;
  onClose: () => void;
  onSaved: (board: { id: string }) => void;
}) {
  // Fresh on every open (see useOpenKey below) — initialised from the board
  const [name, setName] = useState(board?.name ?? "");
  const [description, setDescription] = useState(board?.description ?? "");
  const [color, setColor] = useState(board?.color ?? BOARD_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    setError("");
    const body = { name: name.trim(), description: description.trim(), color };
    const res = board ? await boardsApi.update(board.id, body) : await boardsApi.create(body);
    setSaving(false);
    if (!res.ok) { setError(apiError(res)); return; }
    onSaved(unwrap<{ id: string }>(res) ?? { id: board?.id ?? "" });
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={board ? "Edit board" : "New board"}
      footer={
        <View className="flex-row justify-end gap-2">
          <Button title="Cancel" variant="ghost" onPress={onClose} />
          <Button title={saving ? "Saving…" : board ? "Save changes" : "Create board"} onPress={save} loading={saving} disabled={!name.trim()} />
        </View>
      }
    >
      <View>
        <Label>Name</Label>
        <Field value={name} onChangeText={setName} maxLength={80} placeholder="e.g. Marketing, House chores…" autoFocus={!board} className="text-base font-medium" />
      </View>
      <View>
        <Label>Description</Label>
        <Field value={description} onChangeText={setDescription} maxLength={500} placeholder="What's this board for? (optional)" multiline />
      </View>
      <View>
        <Label>Colour</Label>
        <View className="flex-row gap-3">
          {BOARD_COLORS.map((c) => (
            <Pressable
              key={c}
              onPress={() => setColor(c)}
              accessibilityLabel={`Colour ${c}`}
              className={`w-8 h-8 rounded-full items-center justify-center ${color === c ? "border-2 border-on-surface" : "opacity-70"}`}
              style={{ backgroundColor: c }}
            >
              {color === c ? <Icon name="check" size={14} color="#fff" strokeWidth={3} /> : null}
            </Pressable>
          ))}
        </View>
      </View>
      <ErrorBanner message={error} />
    </Sheet>
  );
}

/** Create a board, or edit name/description/colour when `board` is given. */
export function BoardFormSheet(props: Parameters<typeof BoardFormSheetForm>[0]) {
  const openKey = useOpenKey(props.visible);
  return <BoardFormSheetForm key={openKey} {...props} />;
}
