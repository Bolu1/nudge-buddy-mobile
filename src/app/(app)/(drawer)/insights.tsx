import { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "@/components/ui/SafeArea";
import { insights } from "@/lib/api";
import { colors } from "@/lib/theme";
import { Icon, ScreenHeader, Segmented, Spinner, type IconName } from "@/components/ui";
import { Mascot } from "@/components/Mascot";

interface TodayData {
  date: string;
  streak: { currentStreak: number; longestStreak: number };
  focusMinutes: number;
  tasksCreated: number;
  tasksCompleted: number;
  remindersCreated: number;
  notesCreated: number;
  aiInteractions: number;
}

interface WeekDay {
  date: string;
  tasksCompleted: number;
  focusMinutes: number;
  aiInteractions: number;
}

const shortDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString([], { weekday: "short" });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const isActive = (d: WeekDay) => d.focusMinutes > 0 || d.tasksCompleted > 0 || d.aiInteractions > 0;

function formatFocus(mins: number) {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

// The streak "plant" grows with the streak (same stages as the web)
const STAGES = [
  { min: 0, emoji: "🌰", name: "Seed", next: 1 },
  { min: 1, emoji: "🌱", name: "Sprout", next: 3 },
  { min: 3, emoji: "🪴", name: "Growing", next: 7 },
  { min: 7, emoji: "🌳", name: "Thriving", next: 14 },
  { min: 14, emoji: "🔥", name: "On fire", next: null as number | null },
];
const stageFor = (streak: number) => [...STAGES].reverse().find((s) => streak >= s.min) ?? STAGES[0];

type Metric = "focus" | "tasks" | "chats";
const METRICS: Record<Metric, { label: string; value: (d: WeekDay) => number; format: (v: number) => string; empty: string }> = {
  focus: { label: "Focus", value: (d) => d.focusMinutes, format: formatFocus, empty: "No focus sessions yet this week — start one and watch this grow!" },
  tasks: { label: "Tasks", value: (d) => d.tasksCompleted, format: String, empty: "No tasks ticked off yet this week. Your first one is waiting!" },
  chats: { label: "Chats", value: (d) => d.aiInteractions, format: String, empty: "Nudge hasn't heard from you this week — say hi!" },
};

function Tile({ icon, accent, label, value, sub, progress }: { icon: IconName; accent: string; label: string; value: string; sub: string; progress?: number }) {
  return (
    <View className="rounded-3xl p-4 gap-2.5 border border-white/5 flex-1 min-w-[45%]" style={{ backgroundColor: `${accent}1f` }}>
      <View className="flex-row items-center justify-between">
        <View className="w-9 h-9 rounded-2xl items-center justify-center" style={{ backgroundColor: `${accent}26` }}>
          <Icon name={icon} size={18} color={accent} />
        </View>
        <Text className="text-on-surface-variant text-xs font-medium">{label}</Text>
      </View>
      <Text className="text-on-surface text-3xl font-semibold" style={{ fontVariant: ["tabular-nums"] }}>{value}</Text>
      {progress !== undefined ? (
        <View className="h-2 rounded-full bg-black/25 overflow-hidden">
          <View className="h-full rounded-full bg-primary" style={{ width: `${Math.round(Math.min(1, progress) * 100)}%` }} />
        </View>
      ) : null}
      <Text className="text-on-surface-variant text-xs">{sub}</Text>
    </View>
  );
}

export default function InsightsScreen() {
  const [today, setToday] = useState<TodayData | null>(null);
  const [days, setDays] = useState<WeekDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [metric, setMetric] = useState<Metric>("focus");

  const load = useCallback(async () => {
    try {
      const [t, w] = await Promise.all([insights.today(), insights.weekly()]);
      setToday((t.data as { data?: TodayData } | null)?.data ?? null);
      setDays((w.data as { data?: { days?: WeekDay[] } } | null)?.data?.days ?? []);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const streak = today?.streak?.currentStreak ?? 0;
  const stage = stageFor(streak);
  const toNext = stage.next !== null ? stage.next - streak : 0;
  const nextStage = stage.next !== null ? stageFor(stage.next) : null;
  const tasksLeft = Math.max(0, (today?.tasksCreated ?? 0) - (today?.tasksCompleted ?? 0));
  const m = METRICS[metric];
  const values = days.map(m.value);
  const max = Math.max(...values, 0);
  const best = max > 0 ? values.indexOf(max) : -1;
  const bestFocus = days.reduce<WeekDay | null>((b, d) => (d.focusMinutes > (b?.focusMinutes ?? 0) ? d : b), null);
  const activeDays = days.filter(isActive).length;
  const weekTasks = days.reduce((s, d) => s + d.tasksCompleted, 0);

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-bg">
      <ScreenHeader title="Insights" />
      {loading ? <Spinner /> : (
        <ScrollView
          contentContainerClassName="p-4 gap-4 pb-32"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.primaryContainer} />}
        >
          {/* Greeting + streak garden */}
          <View className="bg-surface-low border border-divider rounded-3xl p-5 gap-4">
            <View className="flex-row items-center gap-3">
              <Mascot size={40} />
              <Text className="text-on-surface text-lg font-semibold">{greeting()}</Text>
            </View>
            <View className="flex-row items-center gap-4">
              <Text style={{ fontSize: 44 }}>{stage.emoji}</Text>
              <View className="flex-1">
                <Text className="text-on-surface text-3xl font-semibold">
                  {streak} <Text className="text-base font-normal text-on-surface-variant">day streak</Text>
                </Text>
                <Text className="text-outline text-xs mt-0.5">{stage.name} · best ever {plural(today?.streak?.longestStreak ?? 0, "day")}</Text>
              </View>
            </View>
            {days.length ? (
              <View className="flex-row justify-between">
                {days.map((d) => {
                  const active = isActive(d);
                  const isToday = d.date === today?.date;
                  return (
                    <View key={d.date} className="items-center gap-1.5">
                      <View className={`w-9 h-9 rounded-full items-center justify-center ${active ? "bg-on-primary-container" : "bg-surface-high"} ${isToday ? "border-2 border-primary-container" : ""}`}>
                        {active ? <Icon name="check" size={14} color={colors.primaryContainer} strokeWidth={2.5} /> : null}
                      </View>
                      <Text className={`text-[10px] ${isToday ? "text-on-surface font-semibold" : "text-outline-variant"}`}>{shortDay(d.date)}</Text>
                    </View>
                  );
                })}
              </View>
            ) : null}
            <Text className="text-outline text-xs">
              {nextStage && toNext > 0 ? `${plural(toNext, "more day")} to grow into ${nextStage.name}` : "Your garden is in full bloom — keep it going!"}
            </Text>
          </View>

          {/* Today */}
          {today ? (
            <View className="flex-row flex-wrap gap-3">
              <Tile icon="target" accent="#8da38a" label="Focus" value={formatFocus(today.focusMinutes)} sub="in the zone today" />
              <Tile
                icon="check-square"
                accent="#c3a06e"
                label="Tasks"
                value={`${today.tasksCompleted}/${today.tasksCreated}`}
                sub={today.tasksCreated === 0 ? "nothing planned yet" : tasksLeft === 0 ? "all done — nice!" : `${plural(tasksLeft, "more")} to go`}
                progress={today.tasksCreated ? today.tasksCompleted / today.tasksCreated : 0}
              />
              <Tile icon="message-square" accent="#9fb3c8" label="Chats" value={String(today.aiInteractions)} sub="talks with Nudge" />
              <Tile icon="bell" accent="#f7b8a5" label="Reminders" value={String(today.remindersCreated)} sub="set for later" />
              <Tile icon="file-text" accent="#b9a6d6" label="Notes" value={String(today.notesCreated)} sub="thoughts captured" />
            </View>
          ) : null}

          {/* Week chart */}
          <View className="bg-surface-low border border-divider rounded-3xl p-5">
            <View className="flex-row items-center justify-between mb-5">
              <Text className="text-on-surface text-base font-semibold">Your week</Text>
              <Segmented value={metric} onChange={setMetric} options={(Object.keys(METRICS) as Metric[]).map((k) => ({ value: k, label: METRICS[k].label }))} />
            </View>
            {max === 0 ? (
              <Text className="text-outline text-sm text-center py-10 px-4">{m.empty}</Text>
            ) : (
              <View className="flex-row items-end justify-between" style={{ height: 170 }}>
                {days.map((d, i) => {
                  const v = values[i];
                  const h = Math.max(4, (v / max) * 130);
                  return (
                    <View key={d.date} className="items-center flex-1 gap-1.5">
                      {i === best ? <Text className="text-primary text-[10px] font-semibold">{m.format(v)}</Text> : <Text className="text-[10px]"> </Text>}
                      <View className="w-6 rounded-lg" style={{ height: h, backgroundColor: i === best ? colors.primary : v ? colors.primaryContainer : colors.surfaceHigh, opacity: v ? 1 : 0.6 }} />
                      <Text className={`text-[10px] ${d.date === today?.date ? "text-on-surface font-semibold" : "text-outline-variant"}`}>{shortDay(d.date)}</Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          {/* Highlights */}
          <View className="bg-surface-low border border-divider rounded-3xl p-5 gap-3">
            <Text className="text-on-surface text-base font-semibold mb-1">This week&apos;s highlights</Text>
            {[
              { icon: "zap" as const, accent: "#e8d5a3", label: "Best focus day", value: bestFocus ? `${bestFocus.date === today?.date ? "Today" : shortDay(bestFocus.date)} · ${formatFocus(bestFocus.focusMinutes)}` : "Still to come" },
              { icon: "calendar" as const, accent: "#b9a6d6", label: "Active days", value: `${activeDays} of ${days.length}` },
              { icon: "check-square" as const, accent: "#c3a06e", label: "Tasks completed", value: String(weekTasks) },
            ].map((f) => (
              <View key={f.label} className="flex-row items-center gap-3">
                <View className="w-9 h-9 rounded-xl items-center justify-center" style={{ backgroundColor: `${f.accent}1f` }}>
                  <Icon name={f.icon} size={16} color={f.accent} />
                </View>
                <Text className="text-on-surface-variant text-sm flex-1">{f.label}</Text>
                <Text className="text-on-surface text-sm font-medium">{f.value}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
