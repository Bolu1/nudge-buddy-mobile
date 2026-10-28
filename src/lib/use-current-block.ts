import { useCallback, useEffect, useState } from "react";
import { workday as workdayApi } from "./api";
import { onChange } from "./events";

export interface CurrentBlockTask {
  id: string;
  title: string;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED";
  priority: "LOW" | "MEDIUM" | "HIGH";
}

export interface CurrentBlock {
  id: string;
  name: string;
  color: string;
  description?: string;
  startTime: string;
  endTime: string;
  notifyOnStartMinutesBefore: number;
  sortOrder: number;
  workdayId: string;
  tasks: CurrentBlockTask[];
}

const POLL_MS = 30_000;

/** Polls GET /workday/current/block so the UI can show "Currently in: X". */
export function useCurrentBlock() {
  const [currentBlock, setCurrentBlock] = useState<CurrentBlock | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await workdayApi.getCurrentBlock();
      setCurrentBlock((res.data as { data?: CurrentBlock | null } | null)?.data ?? null);
    } catch {
      setCurrentBlock(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    const off = onChange("workday", load);
    return () => { clearInterval(id); off(); };
  }, [load]);

  return { currentBlock, loading, refetchCurrentBlock: load };
}
