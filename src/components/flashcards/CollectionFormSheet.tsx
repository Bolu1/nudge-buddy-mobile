import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { flashcards as flashcardsApi } from "@/lib/api";
import { apiError, unwrap } from "@/lib/boards";
import { THEMES, type FlashcardTheme } from "@/lib/flashcards";
import { useOpenKey } from "@/lib/use-open-key";
import { Button, ErrorBanner, Field, Label, Sheet } from "@/components/ui";
import { ThemeBackground } from "./ThemeBackground";

/** Five swatches, each a preview of the style seeded with `seed` so the pick matches what cards will look like. */
export function ThemePicker({
  value,
  onChange,
  seed,
}: {
  value: FlashcardTheme;
  onChange: (theme: FlashcardTheme) => void;
  seed: string;
}) {
  return (
    <View className="flex-row gap-2">
      {THEMES.map((t) => {
        const selected = value === t.value;
        return (
          <Pressable
            key={t.value}
            onPress={() => onChange(t.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={t.label}
            className="flex-1 items-center gap-1.5"
          >
            <View
              className={`w-full aspect-square rounded-xl overflow-hidden ${selected ? "border-2 border-primary-container" : "opacity-70"}`}
            >
              <ThemeBackground theme={t.value} seed={seed} />
            </View>
            <Text className={`text-[10px] text-center ${selected ? "text-on-surface" : "text-outline"}`} numberOfLines={1}>
              {t.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function CollectionFormSheetForm({
  visible,
  collection,
  onClose,
  onSaved,
}: {
  visible: boolean;
  collection?: { id: string; title: string; description: string | null; theme: FlashcardTheme } | null;
  onClose: () => void;
  onSaved: (collection: { id: string }) => void;
}) {
  // Fresh on every open (see useOpenKey below) — initialised from the collection
  const [title, setTitle] = useState(collection?.title ?? "");
  const [description, setDescription] = useState(collection?.description ?? "");
  const [theme, setTheme] = useState<FlashcardTheme>(collection?.theme ?? "PATCHWORK");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!title.trim()) return;
    setSaving(true);
    setError("");
    const body = { title: title.trim(), description: description.trim(), theme };
    const res = collection ? await flashcardsApi.update(collection.id, body) : await flashcardsApi.create(body);
    setSaving(false);
    if (!res.ok) { setError(apiError(res)); return; }
    onSaved(unwrap<{ id: string }>(res) ?? { id: collection?.id ?? "" });
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={collection ? "Edit collection" : "New collection"}
      footer={
        <View className="flex-row justify-end gap-2">
          <Button title="Cancel" variant="ghost" onPress={onClose} />
          <Button
            title={saving ? "Saving…" : collection ? "Save changes" : "Create collection"}
            onPress={save}
            loading={saving}
            disabled={!title.trim()}
          />
        </View>
      }
    >
      <View>
        <Label>Title</Label>
        <Field value={title} onChangeText={setTitle} maxLength={80} placeholder="e.g. Spanish verbs, Biology ch. 4…" autoFocus={!collection} className="text-base font-medium" />
      </View>
      <View>
        <Label>Description</Label>
        <Field value={description} onChangeText={setDescription} maxLength={200} placeholder="What's this collection for? (optional)" multiline />
      </View>
      <View>
        <Label>Card theme</Label>
        <ThemePicker value={theme} onChange={setTheme} seed={collection?.id ?? "nudge-buddy"} />
      </View>
      <ErrorBanner message={error} />
    </Sheet>
  );
}

/** Create a collection, or edit its title/description/theme when `collection` is given. */
export function CollectionFormSheet(props: Parameters<typeof CollectionFormSheetForm>[0]) {
  const openKey = useOpenKey(props.visible);
  return <CollectionFormSheetForm key={openKey} {...props} />;
}
