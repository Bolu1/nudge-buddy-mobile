// Workday types and time helpers (shared by the Workday screen and sheets).
// Block times go to the API as local wall-clock "YYYY-MM-DDTHH:mm:00" strings,
// exactly like the web app — the backend applies the user's timezone.

export interface WorkdayGoal {
  id: string;
  title: string;
  completed: boolean;
}

export interface ActiveWorkdayBlockTask {
  id: string;
  title: string;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED";
  priority: "LOW" | "MEDIUM" | "HIGH";
}

export interface ActiveWorkdayBlock {
  id: string;
  name: string;
  color: string;
  description?: string;
  startTime: string;
  endTime: string;
  notifyOnStart: boolean;
  notifyOnStartMinutesBefore: number;
  notifyOnEnd: boolean;
  tasks?: ActiveWorkdayBlockTask[];
}

export interface ActiveWorkday {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  status: "ACTIVE" | "COMPLETED" | "CANCELLED";
  goals: WorkdayGoal[];
  blocks: ActiveWorkdayBlock[];
}

export interface WorkdayTemplateBlock {
  id: string;
  name: string;
  color: string;
  startMinute: number;
  endMinute: number;
  notifyOnStart?: boolean;
  notifyOnStartMinutesBefore?: number;
  notifyOnEnd?: boolean;
}

export interface WorkdayTemplate {
  id: string;
  name: string;
  description?: string;
  isSystem: boolean;
  blocks: WorkdayTemplateBlock[];
}

/** Editable block fields, times as local "HH:mm" */
export interface BlockDraft {
  name: string;
  color: string;
  description?: string;
  start: string;
  end: string;
  notifyOnStartMinutesBefore: number;
}

export interface EndOfDayData {
  unachievedGoals: { id: string; title: string }[];
  completedGoals: number;
  totalGoals: number;
}

export const COLOR_PRESETS = [
  "#8da38a", "#4a7c59", "#b8c9b0", "#d4a853", "#7a9cbf",
  "#9a9a9a", "#c9a87c", "#a07c5c", "#7a5c8d", "#f7b8a5",
];

export function minutesFromHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function minutesToHHMM(mins: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, mins));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

/** Local wall-clock minutes of an ISO timestamp */
export function minutesFromIso(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

/** Local "HH:mm" of an ISO timestamp (never slice the UTC string) */
export function hhmmFromIso(iso: string): string {
  return minutesToHHMM(minutesFromIso(iso));
}

/** Local calendar date "YYYY-MM-DD" */
export function localDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function wallClock(date: string, hhmm: string): string {
  return `${date}T${hhmm}:00`;
}

/** "13:30" → "1:30 PM" */
export function formatHHMM12(hhmm: string): string {
  const mins = minutesFromHHMM(hhmm);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

export function formatBlockTime(iso: string): string {
  return formatHHMM12(hhmmFromIso(iso)).replace(" ", "").toLowerCase();
}

/** 90 → "1h 30m" */
export function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function formatHour(h: number): string {
  const hh = ((h % 24) + 24) % 24;
  if (hh === 0) return "12am";
  if (hh === 12) return "12pm";
  return hh < 12 ? `${hh}am` : `${hh - 12}pm`;
}

/** Every 15 minutes across the day, as {value: "HH:mm", label: "h:mm AM"} */
export const TIME_OPTIONS = Array.from({ length: 96 }, (_, i) => {
  const value = minutesToHHMM(i * 15);
  return { value, label: formatHHMM12(value) };
});

export function timeOptionsWith(value: string) {
  return TIME_OPTIONS.some((o) => o.value === value) || !value
    ? TIME_OPTIONS
    : [...TIME_OPTIONS, { value, label: formatHHMM12(value) }].sort((a, b) => a.value.localeCompare(b.value));
}

export function errorMessage(data: unknown, fallback: string): string {
  return (data as { errors?: string[] } | null)?.errors?.[0] ?? fallback;
}
