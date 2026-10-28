// Assistant copy and helpers shared with the web workspace page.

export interface ChipTask {
  title: string;
  status: string;
  dueAt?: string;
  dueDate?: string;
}

export const DEFAULT_HEADING = "What are we working on?";

export const HELP_CATEGORIES = [
  {
    label: "Tasks",
    commands: [
      "Add a task to buy groceries",
      "I need to call mom and pick up the kids",
      "What are my pending tasks?",
      "Mark 'Buy groceries' as done",
      "Mark 'Buy groceries' as not done",
      "Change 'Buy groceries' priority to high",
      "Move 'Buy groceries' due date to Friday",
      "Add subtask 'Get milk' to 'Buy groceries'",
      "Complete all my tasks",
      "Delete 'Buy groceries'",
      "Delete all my tasks",
    ],
  },
  {
    label: "Reminders",
    commands: [
      "Remind me to take my medicine at 8pm",
      "Remind me in 30 minutes",
      "Ping me tomorrow morning about the meeting",
      "Remind me when it's time for my dentist appointment",
    ],
  },
  {
    label: "Notes",
    commands: [
      "Note: pick up dry cleaning on the way home",
      "Show my notes",
    ],
  },
  {
    label: "Focus Timer",
    commands: [
      "Start a 25 minute focus session",
      "Pause the timer",
      "Resume my focus session",
      "How much time is left on my timer?",
      "Cancel the timer",
    ],
  },
  {
    label: "Calendar",
    commands: [
      "What's on my calendar today?",
      "Add dentist appointment to my calendar for Friday at 2pm",
      "Connect my Google Calendar",
    ],
  },
  {
    label: "Progress",
    commands: [
      "How many tasks have I completed?",
      "Give me a task summary",
    ],
  },
];

export const TASK_REFRESH_ACTIONS = new Set([
  "task_created", "multiple_tasks_created", "task_completed", "task_reopened", "task_updated",
  "task_deleted", "all_tasks_deleted", "all_tasks_completed", "subtask_added", "subtask_toggled",
]);

export const ACTION_LABELS: Record<string, string> = {
  task_created: "Task created",
  multiple_tasks_created: "Tasks created",
  tasks_listed: "Tasks",
  task_summary: "Summary",
  task_completed: "Task completed",
  task_reopened: "Task reopened",
  task_updated: "Task updated",
  task_deleted: "Task deleted",
  all_tasks_deleted: "All tasks deleted",
  all_tasks_completed: "All tasks completed",
  task_not_found: "Not found",
  subtask_added: "Subtask added",
  subtask_toggled: "Subtask updated",
  subtask_not_found: "Not found",
  note_created: "Note saved",
  notes_listed: "Notes",
  pomodoro_started: "Timer started",
  pomodoro_cancelled: "Timer cancelled",
  pomodoro_status: "Timer status",
  calendar_connect_initiated: "Calendar",
  plan_upgrade_required: "Upgrade required",
  reminder: "Reminder",
  workday_block_reminder: "Workday",
  workday_complete: "Workday complete",
  quota_exceeded: "Limit reached",
  action_error: "Action failed",
};

export const GREETINGS = [
  "Hey, Nudge Buddy here. What are we tackling today?",
  "Nudge Buddy online. Tell me what's on your mind.",
  "Hi! Nudge Buddy is listening. What do you want to get done?",
  "Hey there, it's Nudge Buddy. Ready when you are.",
  "Nudge Buddy here. What's the plan for today?",
  "Hello! Nudge Buddy at your service. What can I help you focus on?",
  "Hey, Nudge Buddy checking in. What's your priority right now?",
  "Hi, it's Nudge Buddy. Let's get something done. What's first?",
  "Nudge Buddy here, fully listening. What do you need?",
  "Hey! Nudge Buddy is ready. What are we working on today?",
];

export const STATIC_CMDS = [
  "Add a task",
  "Start focus timer",
  "Take a note",
  "What tasks do I have?",
  "Start a 25 min focus session",
  "Show me my notes",
  "What's on my calendar today?",
  "Set a reminder for later",
  "How's my progress today?",
  "Summarize my tasks",
];

function shortTitle(title: string) {
  return title.length > 26 ? title.slice(0, 26) + "…" : title;
}

export function buildChips(taskList: ChipTask[]): string[] {
  const pending = taskList.filter((t) => t.status !== "COMPLETED");
  const todayStr = new Date().toDateString();

  const taskChips: string[] = [];

  if (pending[0]) {
    taskChips.push(`Complete "${shortTitle(pending[0].title)}"`);
  }

  const dueToday = pending.filter((t) => {
    const d = t.dueAt ?? t.dueDate;
    return d && new Date(d).toDateString() === todayStr;
  });
  if (dueToday.length > 0) {
    taskChips.push(`What's due today?`);
  }

  if (pending.length > 1) {
    const pick = pending[1 + Math.floor(Math.random() * (pending.length - 1))];
    taskChips.push(`Mark "${shortTitle(pick.title)}" as done`);
  }

  if (pending.length >= 3) {
    taskChips.push("What are my priorities today?");
  }

  // Shuffle task chips, take up to 2
  const shuffledTask = taskChips.sort(() => Math.random() - 0.5).slice(0, 2);

  // Fill the remaining 2 (or 4 if no tasks) from static pool (shuffled copy)
  const staticShuffled = [...STATIC_CMDS].sort(() => Math.random() - 0.5);
  const filler = staticShuffled.filter((c) => !shuffledTask.includes(c)).slice(0, 4 - shuffledTask.length);

  return [...shuffledTask, ...filler];
}

// Task chips quote a task title — they go stale once that task is done or deleted
export function chipsStillValid(chips: string[], taskList: ChipTask[]): boolean {
  const pendingTitles = new Set(
    taskList.filter((t) => t.status !== "COMPLETED").map((t) => shortTitle(t.title)),
  );
  return chips.every((c) => {
    const quoted = c.match(/"(.+)"/)?.[1];
    return !quoted || pendingTitles.has(quoted);
  });
}

