export type BoardRole = "OWNER" | "EDITOR" | "MEMBER";
export type Priority = "LOW" | "MEDIUM" | "HIGH";

export interface Person {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
}

export interface BoardSummary {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  role: BoardRole;
  memberCount: number;
  /** First few members (by join date) for the avatar row */
  memberPreview: Person[];
  openTaskCount: number;
  createdAt: string;
}

export interface BoardMemberInfo extends Person {
  role: BoardRole;
  joinedAt: string;
}

export interface PendingInvite {
  id: string;
  email: string;
  role: BoardRole;
  expiresAt: string;
  createdAt: string;
}

export interface BoardDetail {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  ownerId: string;
  createdAt: string;
  role: BoardRole;
  viewerId: string;
  members: BoardMemberInfo[];
  invites: PendingInvite[];
}

export interface BoardTask {
  id: string;
  boardId: string;
  title: string;
  description: string | null;
  priority: Priority;
  dueAt: string | null;
  completedAt: string | null;
  createdAt: string;
  createdBy: Person | null;
  completedBy: Person | null;
  assignees: { userId: string; account: Person }[];
  canComplete: boolean;
}

export interface MyInvite {
  id: string;
  role: BoardRole;
  expiresAt: string;
  createdAt: string;
  board: { id: string; name: string; description: string | null; color: string | null };
  invitedBy: Person;
}

export const ROLE_LABEL: Record<BoardRole, string> = {
  OWNER: "Owner",
  EDITOR: "Editor",
  MEMBER: "Member",
};

export const ROLE_HINT: Record<BoardRole, string> = {
  OWNER: "Full control",
  EDITOR: "Can add, edit and delete tasks",
  MEMBER: "Can view and complete tasks assigned to them",
};

export const BOARD_COLORS = ["#8da38a", "#7a6b8a", "#8a7a5a", "#5a7a8a", "#a3708d", "#c9824a"];

export function canEditTasks(role: BoardRole | undefined): boolean {
  return role === "OWNER" || role === "EDITOR";
}

export function fullName(p: Pick<Person, "firstName" | "lastName"> | null | undefined): string {
  if (!p) return "Someone";
  return `${p.firstName} ${p.lastName}`.trim() || "Someone";
}

/** Pulls the human message out of an API error response. */
export function apiError(res: { data: unknown }, fallback = "Something went wrong. Please try again."): string {
  const d = res.data as { errors?: unknown[]; message?: unknown } | null;
  const first = Array.isArray(d?.errors) ? d?.errors[0] : undefined;
  if (typeof first === "string") return first;
  if (typeof d?.message === "string" && d.message) return d.message;
  const nested = (d?.message as { message?: unknown } | undefined)?.message;
  return typeof nested === "string" ? nested : fallback;
}

/** Unwraps the `{ data }` envelope the API wraps every success response in. */
export function unwrap<T>(res: { data: unknown }): T | null {
  return ((res.data as { data?: T })?.data ?? null) as T | null;
}
