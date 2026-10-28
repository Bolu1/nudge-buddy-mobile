import { File } from "expo-file-system";
import { API_URL } from "./config";
import { getToken, getRefreshToken, setTokens, clearAllTokens } from "./storage";

export { getToken, getRefreshToken, clearAllTokens };

const BASE_URL = API_URL;

// Called when refresh fails — the auth provider routes back to sign-in
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

// ── Refresh mutex ─────────────────────────────────────────────────────────────
let refreshingPromise: Promise<boolean> | null = null;

async function tryRefreshTokens(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    const json = await res.json();
    const tokens = json?.data ?? json;
    if (!tokens?.accessToken) return false;
    await setTokens(tokens.accessToken, tokens.refreshToken);
    return true;
  } catch {
    return false;
  }
}

/** Refresh now if we have a refresh token — used by long-lived connections (WS) after a 401 */
export function refreshSession(): Promise<boolean> {
  if (!refreshingPromise) {
    refreshingPromise = tryRefreshTokens().finally(() => { refreshingPromise = null; });
  }
  return refreshingPromise;
}

function forceLogout() {
  void clearAllTokens();
  onUnauthorized?.();
}

// ── Core fetch ────────────────────────────────────────────────────────────────
export async function apiFetch<T = unknown>(
  path: string,
  options?: RequestInit
): Promise<{ ok: boolean; status: number; data: T }> {
  const makeRequest = (authToken: string | null) => {
    const headers: Record<string, string> = {
      // Uploads let fetch set the multipart boundary
      ...(options?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(options?.headers as Record<string, string> | undefined),
    };
    return fetch(`${BASE_URL}${path}`, { ...options, headers });
  };

  const skipRefresh = path === "/auth/refresh" || path === "/auth/login";

  let res = await makeRequest(getToken());

  if (res.status === 401 && !skipRefresh) {
    const refreshed = await refreshSession();
    if (!refreshed) {
      forceLogout();
      return { ok: false, status: 401, data: null as T };
    }
    res = await makeRequest(getToken());
  }

  let data: T;
  try { data = await res.json(); } catch { data = null as T; }
  return { ok: res.ok, status: res.status, data };
}

export const auth = {
  signup: (body: {
    email: string;
    firstName: string;
    lastName: string;
    password: string;
    confirmPassword: string;
  }) =>
    apiFetch("/auth/signup", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  login: (body: {
    email: string;
    password: string;
    deviceInfo?: string;
    deviceToken?: string;
    platform?: string;
  }) =>
    apiFetch<{
      status: boolean;
      data?: { token?: { accessToken: string; refreshToken: string } };
      errors?: string[];
    }>("/auth/login", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  google: (body: { token: string }) =>
    apiFetch("/auth/google", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  refresh: (body: { refreshToken: string }) =>
    apiFetch<{
      data?: { accessToken: string; refreshToken: string };
      errors?: string[];
    }>("/auth/refresh", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  logout: () => apiFetch("/auth/logout", { method: "DELETE" }),

  me: () => apiFetch("/auth/me"),

  activateAccount: (body: { email: string; otpCode: string }) =>
    apiFetch("/auth/activate-account", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  forgotPassword: (body: { email: string }) =>
    apiFetch("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  verifyOtp: (body: { email: string; otpCode: string }) =>
    apiFetch("/auth/verify-otp", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  resetPassword: (body: { email: string; otpCode: string; newPassword: string }) =>
    apiFetch("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  resendOtp: (body: { email: string }) =>
    apiFetch("/auth/resend-otp", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};

export const account = {
  getProfile: () => apiFetch("/account/profile"),

  /** Permanently delete the account and its data (App Store requirement) */
  deleteAccount: () => apiFetch("/account", { method: "DELETE" }),
  getTokenUsage: () => apiFetch("/account/token-usage"),

  updateProfile: (body: {
    firstName?: string;
    lastName?: string;
    preferredLanguage?: string;
    timezone?: string;
  }) =>
    apiFetch("/account/profile", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    apiFetch("/account/change-password", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  updateDashboardPreference: (body: {
    showTasksPanel?: boolean;
    showNotesPanel?: boolean;
    showCalendarPanel?: boolean;
  }) =>
    apiFetch("/account/dashboard-preference", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
};

export const tasks = {
  create: (body: {
    title: string;
    description?: string;
    dueAt?: string;
    priority?: "LOW" | "MEDIUM" | "HIGH";
    reminder?: { message: string; remindAt: string };
    workdayBlockId?: string;
  }) =>
    apiFetch("/tasks", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  list: (params?: { status?: "PENDING" | "IN_PROGRESS" | "COMPLETED"; workdayBlockId?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.workdayBlockId) qs.set("workdayBlockId", params.workdayBlockId);
    const s = qs.toString();
    return apiFetch(`/tasks${s ? `?${s}` : ""}`);
  },

  getById: (id: string) => apiFetch(`/tasks/${id}`),

  update: (
    id: string,
    body: {
      title?: string;
      description?: string;
      dueDate?: string;
      priority?: "LOW" | "MEDIUM" | "HIGH";
      status?: "PENDING" | "IN_PROGRESS" | "COMPLETED";
      reminderAt?: string;
      /** Move to a block by id, or "" to unassign. Omit to leave unchanged. */
      workdayBlockId?: string;
    }
  ) =>
    apiFetch(`/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  complete: (id: string) =>
    apiFetch(`/tasks/${id}/complete`, { method: "PATCH" }),

  delete: (id: string) => apiFetch(`/tasks/${id}`, { method: "DELETE" }),

  addSubtask: (taskId: string, body: { title: string }) =>
    apiFetch(`/tasks/${taskId}/subtasks`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  toggleSubtask: (taskId: string, subtaskId: string) =>
    apiFetch(`/tasks/${taskId}/subtasks/${subtaskId}/toggle`, {
      method: "PATCH",
    }),

  deleteSubtask: (taskId: string, subtaskId: string) =>
    apiFetch(`/tasks/${taskId}/subtasks/${subtaskId}`, { method: "DELETE" }),
};

export const notes = {
  create: (body: { content: string; lang?: string }) =>
    apiFetch("/notes", {
      method: "POST",
      body: JSON.stringify({ lang: "en", ...body }),
    }),

  list: () => apiFetch("/notes"),

  getById: (id: string) => apiFetch(`/notes/${id}`),

  update: (id: string, body: { content?: string; lang?: string }) =>
    apiFetch(`/notes/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  delete: (id: string) => apiFetch(`/notes/${id}`, { method: "DELETE" }),
};

export const flashcards = {
  list: () => apiFetch("/flashcards/collections"),

  get: (id: string) => apiFetch(`/flashcards/collections/${id}`),

  create: (body: {
    title: string;
    description?: string;
    theme: string;
    cards?: { question: string; answer: string }[];
  }) => apiFetch("/flashcards/collections", { method: "POST", body: JSON.stringify(body) }),

  update: (id: string, body: { title?: string; description?: string; theme?: string }) =>
    apiFetch(`/flashcards/collections/${id}`, { method: "PATCH", body: JSON.stringify(body) }),

  delete: (id: string) => apiFetch(`/flashcards/collections/${id}`, { method: "DELETE" }),

  replaceCards: (id: string, cards: { id?: string; question: string; answer: string }[]) =>
    apiFetch(`/flashcards/collections/${id}/cards`, { method: "PUT", body: JSON.stringify({ cards }) }),

  sessions: (id: string) => apiFetch(`/flashcards/collections/${id}/sessions`),

  saveSession: (
    id: string,
    body: { mode: "ALL" | "MISSED"; durationMs: number; results: { cardId: string; correct: boolean; timeMs: number }[] }
  ) => apiFetch(`/flashcards/collections/${id}/sessions`, { method: "POST", body: JSON.stringify(body) }),

  /** Draft cards from a picked PDF/DOCX/TXT/MD file; nothing is saved until the cards are. */
  generateFromDocument: (
    file: { uri: string; name: string; mimeType?: string },
    opts: { count: number; collectionId?: string }
  ) => {
    const form = new FormData();
    // fetch here is expo/fetch, which rejects React Native's { uri, name, type }
    // descriptor; an expo-file-system File reads its own bytes and type
    form.append("file", new File(file.uri) as unknown as Blob, file.name);
    form.append("count", String(opts.count));
    if (opts.collectionId) form.append("collectionId", opts.collectionId);
    return apiFetch("/flashcards/generate", { method: "POST", body: form });
  },
};

export const reminders = {
  create: (body: { title: string; remindAt: string; taskId?: string }) =>
    apiFetch("/reminders", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  list: () => apiFetch("/reminders"),

  getById: (id: string) => apiFetch(`/reminders/${id}`),

  delete: (id: string) => apiFetch(`/reminders/${id}`, { method: "DELETE" }),
};

export const boards = {
  list: () => apiFetch("/boards"),

  create: (body: { name: string; description?: string; color?: string }) =>
    apiFetch("/boards", { method: "POST", body: JSON.stringify(body) }),

  get: (boardId: string) => apiFetch(`/boards/${boardId}`),

  update: (boardId: string, body: { name?: string; description?: string; color?: string }) =>
    apiFetch(`/boards/${boardId}`, { method: "PATCH", body: JSON.stringify(body) }),

  delete: (boardId: string) => apiFetch(`/boards/${boardId}`, { method: "DELETE" }),

  leave: (boardId: string) => apiFetch(`/boards/${boardId}/leave`, { method: "POST" }),

  removeMember: (boardId: string, memberId: string) =>
    apiFetch(`/boards/${boardId}/members/${memberId}`, { method: "DELETE" }),

  setMemberRole: (boardId: string, memberId: string, role: "EDITOR" | "MEMBER") =>
    apiFetch(`/boards/${boardId}/members/${memberId}`, { method: "PATCH", body: JSON.stringify({ role }) }),

  transferOwnership: (boardId: string, memberId: string) =>
    apiFetch(`/boards/${boardId}/members/${memberId}/transfer-ownership`, { method: "POST" }),

  invite: (boardId: string, body: { emails: string[]; role?: "EDITOR" | "MEMBER" }) =>
    apiFetch(`/boards/${boardId}/invites`, { method: "POST", body: JSON.stringify(body) }),

  revokeInvite: (boardId: string, inviteId: string) =>
    apiFetch(`/boards/${boardId}/invites/${inviteId}`, { method: "DELETE" }),

  myInvites: () => apiFetch("/boards/invites"),

  acceptInvite: (inviteId: string) => apiFetch(`/boards/invites/${inviteId}/accept`, { method: "POST" }),

  declineInvite: (inviteId: string) => apiFetch(`/boards/invites/${inviteId}/decline`, { method: "POST" }),

  tasks: (boardId: string) => apiFetch(`/boards/${boardId}/tasks`),

  createTask: (
    boardId: string,
    body: { title: string; description?: string; priority?: "LOW" | "MEDIUM" | "HIGH"; dueAt?: string; assigneeIds?: string[] },
  ) => apiFetch(`/boards/${boardId}/tasks`, { method: "POST", body: JSON.stringify(body) }),

  updateTask: (
    boardId: string,
    taskId: string,
    body: { title?: string; description?: string; priority?: "LOW" | "MEDIUM" | "HIGH"; dueAt?: string | null },
  ) => apiFetch(`/boards/${boardId}/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify(body) }),

  deleteTask: (boardId: string, taskId: string) =>
    apiFetch(`/boards/${boardId}/tasks/${taskId}`, { method: "DELETE" }),

  completeTask: (boardId: string, taskId: string) =>
    apiFetch(`/boards/${boardId}/tasks/${taskId}/complete`, { method: "POST" }),

  reopenTask: (boardId: string, taskId: string) =>
    apiFetch(`/boards/${boardId}/tasks/${taskId}/reopen`, { method: "POST" }),

  setAssignees: (boardId: string, taskId: string, userIds: string[]) =>
    apiFetch(`/boards/${boardId}/tasks/${taskId}/assignees`, { method: "PATCH", body: JSON.stringify({ userIds }) }),
};

export const pomodoro = {
  start: (body?: {
    pomodoroMinutes?: number;
    shortBreakMinutes?: number;
    longBreakMinutes?: number;
    cycles?: number;
  }) =>
    apiFetch("/pomodoro/start", {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),

  getActive: () => apiFetch("/pomodoro/active"),

  pause: () => apiFetch("/pomodoro/pause", { method: "POST" }),

  resume: () => apiFetch("/pomodoro/resume", { method: "POST" }),

  cancel: () => apiFetch("/pomodoro/cancel", { method: "DELETE" }),

  getHistory: () => apiFetch("/pomodoro/history"),
};

export const sessions = {
  getActive: () => apiFetch("/sessions/active"),

  revoke: (id: string) => apiFetch(`/sessions/${id}`, { method: "DELETE" }),
};

export const subscriptionPlans = {
  getAll: () => apiFetch("/subscription-plans"),

  getById: (id: string) => apiFetch(`/subscription-plans/${id}`),
};

export const payment = {
  subscribe: (body: { planId: string }) =>
    apiFetch("/payment/subscribe", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getSubscription: () => apiFetch("/payment/subscription"),

  cancelSubscription: () =>
    apiFetch("/payment/subscription", { method: "DELETE" }),

  getInvoices: () => apiFetch("/payment/invoices"),
};

export const calendar = {
  connect: () => apiFetch("/calendar/connect"),

  status: () => apiFetch<{ connected: boolean }>("/calendar/status"),

  getEvents: (params?: { date?: string; start?: string; end?: string }) => {
    const qs = params
      ? new URLSearchParams(
          Object.entries(params).filter((e): e is [string, string] => !!e[1])
        ).toString()
      : "";
    return apiFetch(`/calendar/events${qs ? `?${qs}` : ""}`);
  },

  createEvent: (body: {
    title: string;
    start: string;
    end?: string;
    description?: string;
  }) =>
    apiFetch("/calendar/events", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  addTask: (taskId: string) =>
    apiFetch(`/calendar/tasks/${taskId}`, { method: "POST" }),

  disconnect: () => apiFetch("/calendar/disconnect", { method: "DELETE" }),
};

export const insights = {
  ping: () => apiFetch("/insights/ping", { method: "POST" }),

  today: () => apiFetch("/insights/today"),

  weekly: () => apiFetch("/insights/weekly"),
};

export const workday = {
  start: (body: {
    startTime: string;
    endTime: string;
    goals?: string[];
    blocks?: {
      name: string;
      color: string;
      description?: string;
      startTime: string;
      endTime: string;
      notifyOnStart: boolean;
      notifyOnStartMinutesBefore: number;
      notifyOnEnd: boolean;
      sortOrder: number;
    }[];
  }) =>
    apiFetch("/workday/start", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getCurrent: () => apiFetch("/workday/current"),

  getCurrentBlock: () => apiFetch("/workday/current/block"),

  suggest: (body: { startTime: string; endTime: string; preferences?: string }) =>
    apiFetch("/workday/suggest", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateCurrent: (body: { startTime?: string; endTime?: string }) =>
    apiFetch("/workday/current", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  complete: () => apiFetch("/workday/current/complete", { method: "POST" }),

  cancel: () => apiFetch("/workday/current/cancel", { method: "DELETE" }),

  addBlock: (body: {
    name: string;
    color: string;
    description?: string;
    startTime: string;
    endTime: string;
    notifyOnStart?: boolean;
    notifyOnStartMinutesBefore?: number;
    notifyOnEnd?: boolean;
  }) =>
    apiFetch("/workday/current/blocks", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateBlock: (
    id: string,
    body: {
      name?: string;
      color?: string;
      description?: string;
      startTime?: string;
      endTime?: string;
      notifyOnStart?: boolean;
      notifyOnStartMinutesBefore?: number;
      notifyOnEnd?: boolean;
    }
  ) =>
    apiFetch(`/workday/current/blocks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  deleteBlock: (id: string) =>
    apiFetch(`/workday/current/blocks/${id}`, { method: "DELETE" }),

  addGoal: (body: { title: string }) =>
    apiFetch("/workday/current/goals", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateGoal: (id: string, body: { title?: string; completed?: boolean }) =>
    apiFetch(`/workday/current/goals/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  deleteGoal: (id: string) =>
    apiFetch(`/workday/current/goals/${id}`, { method: "DELETE" }),

  getTemplates: () => apiFetch("/workday/templates"),

  saveTemplate: (body: { name: string }) =>
    apiFetch("/workday/templates", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  deleteTemplate: (id: string) =>
    apiFetch(`/workday/templates/${id}`, { method: "DELETE" }),
};

export const push = {
  /** Native push: Expo push token (regular notifications) + iOS VoIP token (calls) */
  registerDevice: (body: {
    platform: "ios" | "android";
    expoPushToken?: string;
    voipToken?: string;
    deviceName?: string;
    callsEnabled?: boolean;
  }) =>
    apiFetch("/push/devices", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  unregisterDevice: (body: { expoPushToken?: string; voipToken?: string }) =>
    apiFetch("/push/devices", {
      method: "DELETE",
      body: JSON.stringify(body),
    }),

  /** iOS Live Activity push token — lets the backend update the Dynamic Island while the app is suspended */
  registerLiveActivity: (body: { activityId: string; kind: string; token: string }) =>
    apiFetch("/push/live-activities", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** The activity ended (finished or dismissed) — its token must not count as delivered any more */
  unregisterLiveActivity: (activityId: string) =>
    apiFetch(`/push/live-activities/${encodeURIComponent(activityId)}`, { method: "DELETE" }),

  /** iOS 17.2+: token that lets the backend *start* a Live Activity (reminder due while the app is closed) */
  registerLiveActivityStartToken: (body: { token: string }) =>
    apiFetch("/push/live-activities/start-token", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** User answered / declined / missed a buddy call */
  callResult: (callId: string, body: { result: "answered" | "declined" | "missed" }) =>
    apiFetch(`/push/calls/${callId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  getVapidKey: () => apiFetch("/push/vapid-key"),

  subscribe: (body: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }) =>
    apiFetch("/push/subscribe", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  unsubscribe: (endpoint: string) =>
    apiFetch(`/push/unsubscribe?endpoint=${encodeURIComponent(endpoint)}`, {
      method: "DELETE",
    }),
};
