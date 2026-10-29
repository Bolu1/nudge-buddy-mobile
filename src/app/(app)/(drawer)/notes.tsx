import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Modal, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "@/components/ui/SafeArea";
import { notes as notesApi } from "@/lib/api";
import { onChange } from "@/lib/events";
import { htmlToText, splitNotePreview } from "@/lib/notes";
import { colors } from "@/lib/theme";
import { Button, Icon, IconButton, ScreenHeader } from "@/components/ui";
import { RichTextEditor } from "@/components/notes/RichTextEditor";

interface Note {
  id: string;
  content: string;
  createdAt: string;
}

function relativeTime(dateStr: string): string {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString([], { month: "short", day: "numeric" });
}

function extractNote(raw: unknown, content: string): Note | null {
  const obj = raw as { data?: Partial<Note> } | Partial<Note> | null | undefined;
  if (!obj) return null;
  const n: Partial<Note> = "data" in obj && obj.data ? obj.data : (obj as Partial<Note>);
  if (!n.id) return null;
  return { id: n.id, content: n.content ?? content, createdAt: n.createdAt ?? new Date().toISOString() };
}

type SaveStatus = "idle" | "saving" | "saved";

// The backend rejects empty notes, so a new note lives client-side until the
// user types something (same flow as the web app).
const DRAFT_ID = "__draft__";

export default function NotesScreen() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Note | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  // Bumped each time a note is opened; a draft promoted to a real note keeps the same editor
  const [session, setSession] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openIdRef = useRef<string | null>(null);
  useEffect(() => { openIdRef.current = openId; }, [openId]);

  const load = useCallback(async () => {
    try {
      const res = await notesApi.list();
      setNotes((res.data as { data?: Note[] } | null)?.data ?? []);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const off = onChange("notes", load);
    return () => {
      off();
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (draftTimer.current) clearTimeout(draftTimer.current);
    };
  }, [load]);

  const sorted = [...notes].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const openNote = openId === DRAFT_ID ? draft : notes.find((n) => n.id === openId) ?? null;

  function newNote() {
    setDraft({ id: DRAFT_ID, content: "", createdAt: new Date().toISOString() });
    setSaveStatus("idle");
    setSession((n) => n + 1);
    setOpenId(DRAFT_ID);
  }

  function close() {
    // An untouched new note is discarded
    if (openId === DRAFT_ID && (!draft || !htmlToText(draft.content))) setDraft(null);
    setOpenId(null);
  }

  function handleChange(html: string) {
    const id = openIdRef.current;
    if (!id) return;
    if (id === DRAFT_ID) {
      setDraft((prev) => (prev ? { ...prev, content: html } : prev));
      if (!htmlToText(html)) return;
      setSaveStatus("saving");
      if (draftTimer.current) clearTimeout(draftTimer.current);
      draftTimer.current = setTimeout(async () => {
        draftTimer.current = null;
        try {
          const res = await notesApi.create({ content: html });
          const created = extractNote(res.data, html);
          if (!created) { setSaveStatus("idle"); return; }
          setNotes((prev) => [created, ...prev]);
          setDraft(null);
          // Keep editing the same note — later saves go to its real id
          setOpenId((prev) => (prev === DRAFT_ID ? created.id : prev));
          setSaveStatus("saved");
        } catch { setSaveStatus("idle"); }
      }, 700);
      return;
    }
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, content: html } : n)));
    setSaveStatus("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await notesApi.update(id, { content: html });
        setSaveStatus("saved");
      } catch { setSaveStatus("idle"); }
    }, 700);
  }

  function deleteNote(id: string) {
    const doDelete = async () => {
      if (id === DRAFT_ID) {
        if (draftTimer.current) { clearTimeout(draftTimer.current); draftTimer.current = null; }
        setDraft(null);
        setOpenId(null);
        return;
      }
      if (openId === id) {
        if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
        setOpenId(null);
      }
      setNotes((prev) => prev.filter((n) => n.id !== id));
      try { await notesApi.delete(id); } catch { load(); }
    };
    Alert.alert("Delete note?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: doDelete },
    ]);
  }

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-bg">
      <ScreenHeader
        title="Brain Dump"
        subtitle={loading ? "Loading…" : `${notes.length} note${notes.length === 1 ? "" : "s"}`}
        right={<Button title="New" icon="plus" variant="tonal" size="sm" onPress={newNote} />}
      />
      <ScrollView
        contentContainerClassName="p-3 gap-1 pb-32"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.primaryContainer} />}
      >
        {loading ? (
          [1, 2, 3].map((i) => <View key={i} className="h-16 mx-1 mb-2 bg-surface-low border border-divider rounded-xl" />)
        ) : sorted.length === 0 ? (
          <Text className="text-outline text-sm px-3 py-4">No notes yet. Tap New to write one, or ask your buddy to take a note.</Text>
        ) : (
          sorted.map((note) => {
            const preview = splitNotePreview(note.content);
            return (
              <Pressable
                key={note.id}
                onPress={() => { setSaveStatus("idle"); setSession((n) => n + 1); setOpenId(note.id); }}
                onLongPress={() => deleteNote(note.id)}
                className="px-3 py-3 rounded-xl active:bg-surface"
              >
                <Text className="text-on-surface text-sm font-medium" numberOfLines={1}>{preview.title}</Text>
                {preview.body ? <Text className="text-outline text-xs mt-0.5 leading-5" numberOfLines={2}>{preview.body}</Text> : null}
                <Text className="text-outline text-[11px] mt-1.5">{relativeTime(note.createdAt)}</Text>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      <Modal visible={!!openNote} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
        <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
          <KeyboardAvoidingView behavior="padding" className="flex-1">
            <View className="flex-row items-center justify-between px-3 py-2 border-b border-divider">
              <Pressable onPress={close} className="flex-row items-center gap-1 px-2 py-1.5" hitSlop={8}>
                <Icon name="chevron-left" size={16} color={colors.outline} />
                <Text className="text-outline text-sm">Notes</Text>
              </Pressable>
              <View className="flex-row items-center gap-3">
                <Text className="text-outline text-xs">
                  {saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "Saved" : openNote ? relativeTime(openNote.createdAt) : ""}
                </Text>
                {openNote ? <IconButton name="trash" onPress={() => deleteNote(openNote.id)} accessibilityLabel="Delete note" /> : null}
              </View>
            </View>
            {openNote ? (
              <RichTextEditor key={session} content={openNote.content} onChange={handleChange} />
            ) : null}
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
