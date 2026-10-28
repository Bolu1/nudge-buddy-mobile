import { useCallback, useEffect, useState } from "react";
import { Alert, AppState, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "@/components/ui/SafeArea";
import * as WebBrowser from "expo-web-browser";
import { calendar } from "@/lib/api";
import { onChange } from "@/lib/events";
import { colors } from "@/lib/theme";
import { useToast } from "@/lib/toast-context";
import { Button, EmptyState, ErrorBanner, Field, Icon, IconButton, Label, ScreenHeader, Sheet, Spinner } from "@/components/ui";
import { DateTimeField } from "@/components/ui/DateTimeField";

interface GCalDateTime { dateTime?: string; date?: string; timeZone?: string }
interface CalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  start: GCalDateTime;
  end: GCalDateTime;
  colorId?: string;
  location?: string;
}

type ConnectState = "unknown" | "connected" | "disconnected" | "plan_required";

// Google colorId → theme-consistent badge colours (same as the web)
const COLOR_MAP: Record<string, { bg: string; border: string; text: string }> = {
  "1": { bg: "#2d2a4a", border: "#6c6aab", text: "#a8a6dc" },
  "2": { bg: "#1a2e1a", border: "#3d7a3d", text: "#8dbb8d" },
  "3": { bg: "#2e1a2e", border: "#7a3d7a", text: "#bb8dbb" },
  "4": { bg: "#3b2820", border: "#9c4f44", text: "#f7b8a5" },
  "5": { bg: "#2e2a1a", border: "#8a7a30", text: "#d4c470" },
  "6": { bg: "#3b2010", border: "#9c4820", text: "#f7a885" },
  "7": { bg: "#1a2a3b", border: "#307a9c", text: "#70c4e4" },
  "8": { bg: "#2c2927", border: "#434842", text: "#8d928a" },
  "9": { bg: "#1a1e3b", border: "#3040a0", text: "#8090e0" },
  "10": { bg: "#1a2a1a", border: "#306a30", text: "#80c080" },
  "11": { bg: "#3b1a1a", border: "#9c2020", text: "#f78080" },
};
const DEFAULT_COLOR = { bg: "#263926", border: "#8da38a", text: "#b6cdb2" };

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const isSameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const parseEventDate = (dt: GCalDateTime) => (dt.dateTime ? new Date(dt.dateTime) : dt.date ? new Date(`${dt.date}T00:00:00`) : null);
const isAllDay = (e: CalendarEvent) => !!e.start.date && !e.start.dateTime;
const formatTime = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function buildWeek(anchor: Date): Date[] {
  const mon = startOfDay(anchor);
  const day = mon.getDay();
  mon.setDate(mon.getDate() + (day === 0 ? -6 : 1 - day));
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
}

function unwrapEvents(raw: unknown): CalendarEvent[] {
  if (Array.isArray(raw)) return raw as CalendarEvent[];
  const r = raw as { data?: unknown; events?: unknown } | null;
  if (Array.isArray(r?.data)) return r.data as CalendarEvent[];
  if (Array.isArray(r?.events)) return r.events as CalendarEvent[];
  return [];
}

export default function CalendarScreen() {
  const toast = useToast();
  const [state, setState] = useState<ConnectState>("unknown");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const today = startOfDay(new Date());
  const [anchor, setAnchor] = useState(today);
  const [selected, setSelected] = useState(today);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [start, setStart] = useState<Date | null>(null);
  const [end, setEnd] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);

  const checkConnection = useCallback(async () => {
    try {
      const res = await calendar.status();
      if (!res.ok) { setState(res.status === 402 || res.status === 403 ? "plan_required" : "disconnected"); return; }
      const d = res.data as { connected?: boolean; data?: { connected?: boolean } } | null;
      setState(d?.connected ?? d?.data?.connected ? "connected" : "disconnected");
    } catch {
      setState("disconnected");
    }
  }, []);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await calendar.getEvents();
      if (!res.ok) { setError("Failed to load events."); return; }
      setEvents(unwrapEvents(res.data));
    } catch {
      setError("Failed to load events.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkConnection();
    const off = onChange("calendar", checkConnection);
    // Coming back from the Google consent screen in the browser
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") checkConnection(); });
    return () => { off(); sub.remove(); };
  }, [checkConnection]);

  useEffect(() => {
    if (state === "connected") loadEvents();
  }, [state, loadEvents]);

  async function connect() {
    setConnecting(true);
    try {
      const res = await calendar.connect();
      const d = res.data as { data?: { authorizationUrl?: string }; authorizationUrl?: string } | null;
      const url = d?.data?.authorizationUrl ?? d?.authorizationUrl;
      if (!res.ok || !url) { setError("Could not start Google Calendar connection."); return; }
      await WebBrowser.openBrowserAsync(url);
      await checkConnection();
    } catch {
      setError("Network error.");
    } finally {
      setConnecting(false);
    }
  }

  function disconnect() {
    Alert.alert("Disconnect Google Calendar?", "You can reconnect at any time.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Disconnect",
        style: "destructive",
        onPress: async () => {
          await calendar.disconnect().catch(() => {});
          setState("disconnected");
          setEvents([]);
        },
      },
    ]);
  }

  function openAdd() {
    const s = new Date(selected);
    s.setHours(9, 0, 0, 0);
    const e = new Date(selected);
    e.setHours(10, 0, 0, 0);
    setTitle("");
    setStart(s);
    setEnd(e);
    setAdding(true);
  }

  async function addEvent() {
    if (!title.trim() || !start) return;
    setSaving(true);
    try {
      const res = await calendar.createEvent({
        title: title.trim(),
        start: start.toISOString(),
        ...(end ? { end: end.toISOString() } : {}),
      });
      if (!res.ok) throw new Error();
      // GET /calendar/events may lag behind — show the created event right away
      const d = res.data as { data?: CalendarEvent } | CalendarEvent | null;
      const created = d && "data" in d && d.data ? d.data : (d as CalendarEvent | null);
      if (created?.id) setEvents((prev) => [...prev, created]);
      setAdding(false);
      loadEvents();
    } catch {
      toast.error("Couldn't add the event.");
    } finally {
      setSaving(false);
    }
  }

  const week = buildWeek(anchor);
  const dayEvents = events
    .filter((e) => { const d = parseEventDate(e.start); return d && isSameDay(d, selected); })
    .sort((a, b) => (parseEventDate(a.start)?.getTime() ?? 0) - (parseEventDate(b.start)?.getTime() ?? 0));

  if (state === "unknown") {
    return (
      <SafeAreaView edges={["top"]} className="flex-1 bg-bg">
        <ScreenHeader title="Calendar" />
        <Spinner />
      </SafeAreaView>
    );
  }

  if (state !== "connected") {
    return (
      <SafeAreaView edges={["top"]} className="flex-1 bg-bg">
        <ScreenHeader title="Calendar" />
        <View className="p-6 gap-4">
          <ErrorBanner message={error} />
          <EmptyState
            icon="calendar"
            title={state === "plan_required" ? "Calendar is a Plus feature" : "Connect Google Calendar"}
            body={state === "plan_required"
              ? "Upgrade to see your events and add tasks to your calendar."
              : "See your events here, and let your buddy add things to your calendar."}
          />
          {state === "disconnected" ? (
            <Button title={connecting ? "Opening Google…" : "Connect Google Calendar"} onPress={connect} loading={connecting} />
          ) : null}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-bg">
      <ScreenHeader
        title="Calendar"
        subtitle={selected.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
       
        right={<Button title="Event" icon="plus" variant="tonal" size="sm" onPress={openAdd} />}
      />

      <View className="flex-row items-center px-2 py-3 border-b border-divider">
        <IconButton name="chevron-left" onPress={() => setAnchor(addDays(anchor, -7))} accessibilityLabel="Previous week" />
        <View className="flex-1 flex-row justify-between">
          {week.map((d) => {
            const sel = isSameDay(d, selected);
            const isToday = isSameDay(d, today);
            const has = events.some((e) => { const s = parseEventDate(e.start); return s && isSameDay(s, d); });
            return (
              <Pressable key={d.toISOString()} onPress={() => setSelected(d)} className={`items-center w-10 py-1.5 rounded-xl ${sel ? "bg-on-primary-container" : ""}`}>
                <Text className={`text-[10px] uppercase ${sel ? "text-primary" : "text-outline"}`}>{d.toLocaleDateString([], { weekday: "narrow" })}</Text>
                <Text className={`text-base font-semibold ${sel ? "text-primary" : isToday ? "text-primary-container" : "text-on-surface"}`}>{d.getDate()}</Text>
                <View className={`w-1 h-1 rounded-full mt-0.5 ${has ? "bg-primary-container" : "bg-transparent"}`} />
              </Pressable>
            );
          })}
        </View>
        <IconButton name="chevron-right" onPress={() => setAnchor(addDays(anchor, 7))} accessibilityLabel="Next week" />
      </View>

      <ScrollView
        contentContainerClassName="p-4 gap-2 pb-32"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await loadEvents(); setRefreshing(false); }} tintColor={colors.primaryContainer} />}
      >
        <ErrorBanner message={error} />
        {loading && !events.length ? <Spinner /> : dayEvents.length === 0 ? (
          <EmptyState icon="calendar" title="Nothing scheduled" body="Upcoming events from Google Calendar show here." />
        ) : (
          dayEvents.map((e) => {
            const c = COLOR_MAP[e.colorId ?? ""] ?? DEFAULT_COLOR;
            const s = parseEventDate(e.start);
            const en = parseEventDate(e.end);
            return (
              <View key={e.id} className="rounded-xl p-3.5 border" style={{ backgroundColor: c.bg, borderColor: c.border }}>
                <Text className="text-sm font-medium" style={{ color: c.text }}>{e.summary ?? "(No title)"}</Text>
                <Text className="text-xs mt-1" style={{ color: c.text, opacity: 0.8 }}>
                  {isAllDay(e) ? "All day" : `${s ? formatTime(s) : ""}${en ? ` – ${formatTime(en)}` : ""}`}
                </Text>
                {e.location ? (
                  <View className="flex-row items-center gap-1 mt-1">
                    <Icon name="flag" size={11} color={c.text} />
                    <Text className="text-xs" style={{ color: c.text, opacity: 0.8 }} numberOfLines={1}>{e.location}</Text>
                  </View>
                ) : null}
              </View>
            );
          })
        )}
        <Pressable onPress={disconnect} className="mt-6 self-center">
          <Text className="text-outline text-xs">Disconnect Google Calendar</Text>
        </Pressable>
      </ScrollView>

      <Sheet
        visible={adding}
        onClose={() => setAdding(false)}
        title="New event"
        footer={
          <View className="flex-row justify-end gap-2">
            <Button title="Cancel" variant="ghost" onPress={() => setAdding(false)} />
            <Button title={saving ? "Adding…" : "Add event"} onPress={addEvent} loading={saving} disabled={!title.trim() || !start} />
          </View>
        }
      >
        <Field value={title} onChangeText={setTitle} placeholder="Event title…" autoFocus className="text-base font-medium" />
        <View>
          <Label>Starts</Label>
          <DateTimeField value={start} onChange={setStart} clearable={false} />
        </View>
        <View>
          <Label>Ends</Label>
          <DateTimeField value={end} onChange={setEnd} placeholder="No end time" />
        </View>
      </Sheet>
    </SafeAreaView>
  );
}
