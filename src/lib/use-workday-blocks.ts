import { useCallback, useEffect, useState } from "react";
import { workday as workdayApi } from "./api";
import { onChange } from "./events";

export interface WorkdayBlockTask {
  id: string;
  title: string;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED";
  priority: "LOW" | "MEDIUM" | "HIGH";
}

export interface WorkdayBlockOption {
  id: string;
  name: string;
  color: string;
  tasks?: WorkdayBlockTask[];
}

/** Every block on today's active workday (with assigned tasks), for pickers and filtering. */
export function useWorkdayBlocks() {
  const [blocks, setBlocks] = useState<WorkdayBlockOption[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await workdayApi.getCurrent();
      const wd = (res.data as { data?: { status?: string; blocks?: WorkdayBlockOption[] } } | null)?.data;
      setBlocks(wd && wd.status === "ACTIVE" ? (wd.blocks ?? []) : []);
    } catch {
      setBlocks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    return onChange("workday", load);
  }, [load]);

  return { blocks, loading, refetchWorkdayBlocks: load };
}
