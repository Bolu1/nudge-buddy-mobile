import { useCallback, useEffect, useMemo, useState } from "react";
import { workday as workdayApi } from "@/lib/api";
import { useWs } from "@/lib/ws-context";
import type { DayBlock, DayView } from "./office/canvas";

interface ApiBlock {
  id: string;
  name: string;
  color: string;
  startTime: string;
  endTime: string;
}

interface ApiWorkday {
  status?: string;
  startTime: string;
  endTime: string;
  blocks?: ApiBlock[];
}

const REFRESH_MS = 5 * 60_000;
const TICK_MS = 15_000;

/**
 * Today's workday for Zen. The current block is worked out locally from the
 * block times so it flips over on the minute; the workday itself is refetched
 * periodically and whenever the server says something workday-related.
 */
export function useZenWorkday(): DayView | null {
  const { addListener } = useWs();
  const [workday, setWorkday] = useState<{ start: number; end: number; blocks: DayBlock[] } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const res = await workdayApi.getCurrent();
      const wd = (res.data as { data?: ApiWorkday | null } | null)?.data;
      if (!wd || wd.status !== "ACTIVE") {
        setWorkday(null);
        return;
      }
      const blocks = (wd.blocks ?? [])
        .map((b) => ({ id: b.id, name: b.name, color: b.color, start: Date.parse(b.startTime), end: Date.parse(b.endTime) }))
        .filter((b) => !Number.isNaN(b.start) && !Number.isNaN(b.end))
        .sort((a, b) => a.start - b.start);
      setWorkday({ start: Date.parse(wd.startTime), end: Date.parse(wd.endTime), blocks });
    } catch {
      setWorkday(null);
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const id = setInterval(load, REFRESH_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(
    () =>
      addListener((msg) => {
        const action = msg.action as string | undefined;
        if (msg.type.startsWith("workday") || action?.startsWith("workday")) load();
      }),
    [addListener, load],
  );

  return useMemo(() => {
    if (!workday) return null;
    const current = workday.blocks.find((b) => now >= b.start && now < b.end) ?? null;
    const next = workday.blocks.find((b) => b.start > now) ?? null;
    return { dayStart: workday.start, dayEnd: workday.end, blocks: workday.blocks, current, next, now };
  }, [workday, now]);
}
