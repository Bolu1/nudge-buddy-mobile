import type { Priority } from "./theme";

export type { Priority } from "./theme";
export type TaskStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED";

export interface Subtask {
  id: string;
  title: string;
  completed: boolean;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  priority: Priority;
  dueDate?: string;
  dueAt?: string;
  status: TaskStatus;
  subtasks?: Subtask[];
  reminder?: { id: string; message: string; remindAt: string };
  workdayBlockId?: string | null;
}

export const PRIORITY_ORDER: Record<Priority, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: "HIGH", label: "High" },
  { value: "MEDIUM", label: "Medium" },
  { value: "LOW", label: "Low" },
];

export function formatDue(dateStr?: string, withTime = true): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return withTime ? `Today, ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function taskDue(t: Pick<Task, "dueAt" | "dueDate">): string | undefined {
  return t.dueAt ?? t.dueDate;
}
