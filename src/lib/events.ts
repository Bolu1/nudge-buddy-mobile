// Tiny pub/sub so screens can refresh when something changes elsewhere
// (the assistant created a task, a board invite was accepted, …).

export type DataTopic = "tasks" | "notes" | "workday" | "focus" | "boards" | "invites" | "calendar";

const listeners = new Map<DataTopic, Set<() => void>>();

export function emitChange(topic: DataTopic) {
  listeners.get(topic)?.forEach((fn) => {
    try { fn(); } catch { /* ignore */ }
  });
}

export function onChange(topic: DataTopic, fn: () => void): () => void {
  let set = listeners.get(topic);
  if (!set) { set = new Set(); listeners.set(topic, set); }
  set.add(fn);
  return () => { set!.delete(fn); };
}
