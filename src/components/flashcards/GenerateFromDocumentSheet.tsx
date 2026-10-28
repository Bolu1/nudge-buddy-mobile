import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { flashcards as flashcardsApi } from "@/lib/api";
import { apiError, unwrap } from "@/lib/boards";
import { DOCUMENT_MAX_PAGES, DOCUMENT_PICKER_TYPES, documentFileError, formatBytes } from "@/lib/flashcards";
import { useOpenKey } from "@/lib/use-open-key";
import { Button, ErrorBanner, Field, Label, Sheet } from "@/components/ui";

export interface GenerateResult {
  cards: { question: string; answer: string }[];
  source: { pages: number; truncated: boolean };
}

/** The picker copies the file into the app's cache; remove that copy once we're done with it. */
function discardLocalCopy(asset: DocumentPicker.DocumentPickerAsset | null) {
  if (!asset) return;
  try {
    const file = new File(asset.uri);
    if (file.exists) file.delete();
  } catch { /* already gone */ }
}

function GenerateFromDocumentForm({
  visible,
  collectionId,
  remaining,
  onClose,
  onGenerated,
}: {
  visible: boolean;
  collectionId: string;
  /** Free slots left in the collection, counting unsaved cards. */
  remaining: number;
  onClose: () => void;
  onGenerated: (result: GenerateResult) => void;
}) {
  const [asset, setAsset] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [countText, setCountText] = useState(String(Math.min(20, remaining)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Read by the unmount cleanup, which can't see later state
  const assetRef = useRef<DocumentPicker.DocumentPickerAsset | null>(null);

  useEffect(() => () => discardLocalCopy(assetRef.current), []);

  function keep(next: DocumentPicker.DocumentPickerAsset | null) {
    if (assetRef.current && assetRef.current.uri !== next?.uri) discardLocalCopy(assetRef.current);
    assetRef.current = next;
    setAsset(next);
  }

  function close() {
    keep(null);
    onClose();
  }

  async function pick() {
    const result = await DocumentPicker.getDocumentAsync({ type: DOCUMENT_PICKER_TYPES, copyToCacheDirectory: true });
    if (result.canceled || !result.assets[0]) return;
    const picked = result.assets[0];
    const problem = documentFileError(picked);
    setError(problem ?? "");
    if (problem) { discardLocalCopy(picked); keep(null); return; }
    keep(picked);
  }

  async function generate() {
    if (!asset || busy) return;
    const count = Math.max(1, Math.min(remaining, Number(countText) || 1));
    setBusy(true);
    setError("");
    const res = await flashcardsApi.generateFromDocument(asset, { count, collectionId });
    setBusy(false);
    const result = res.ok ? unwrap<GenerateResult>(res) : null;
    if (!result) { setError(apiError(res, "We couldn't create cards from this document.")); return; }
    keep(null);
    onGenerated(result);
  }

  return (
    <Sheet
      visible={visible}
      onClose={busy ? () => {} : close}
      title="Generate from a document"
      footer={
        <View className="flex-row justify-end gap-2">
          <Button title="Cancel" variant="ghost" onPress={close} disabled={busy} />
          <Button title={busy ? "Reading document…" : "Generate cards"} onPress={generate} loading={busy} disabled={!asset} />
        </View>
      }
    >
      <Text className="text-outline text-sm leading-5">
        Pick notes or a handout and we&apos;ll write question-and-answer cards from it. You can edit them before saving.
        The file is only read to make the cards — it isn&apos;t stored.
      </Text>
      <View>
        <Label>Document</Label>
        <Button
          title={asset ? asset.name : "Choose a file"}
          icon="file-text"
          variant="outline"
          onPress={pick}
          disabled={busy}
        />
        <Text className="text-outline-variant text-xs mt-1.5">
          {asset?.size != null
            ? `${formatBytes(asset.size)} · tap to change`
            : `PDF, Word (.docx), .txt or .md · up to 10 MB, ${DOCUMENT_MAX_PAGES} pages`}
        </Text>
      </View>
      <View>
        <Label>Number of cards</Label>
        <Field
          value={countText}
          onChangeText={(t) => setCountText(t.replace(/\D/g, "").slice(0, 2))}
          onBlur={() => setCountText(String(Math.max(1, Math.min(remaining, Number(countText) || 1))))}
          keyboardType="number-pad"
          editable={!busy}
          className="w-24"
        />
        <Text className="text-outline-variant text-xs mt-1.5">
          Up to {remaining} more card{remaining === 1 ? "" : "s"} fit in this collection.
        </Text>
      </View>
      <ErrorBanner message={error} />
    </Sheet>
  );
}

/** Upload a document and get draft cards back; the screen adds them to the editor for review. */
export function GenerateFromDocumentSheet(props: Parameters<typeof GenerateFromDocumentForm>[0]) {
  const openKey = useOpenKey(props.visible);
  return <GenerateFromDocumentForm key={openKey} {...props} />;
}
