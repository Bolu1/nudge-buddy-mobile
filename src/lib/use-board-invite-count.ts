import { useCallback, useEffect, useState } from "react";
import { boards as boardsApi } from "./api";
import { onChange } from "./events";

/** Pending board invites for the signed-in user, kept live for nav badges. */
export function useBoardInviteCount(): number {
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    const res = await boardsApi.myInvites();
    if (!res.ok) return;
    const list = (res.data as { data?: unknown[] } | null)?.data;
    setCount(Array.isArray(list) ? list.length : 0);
  }, []);

  useEffect(() => {
    load();
    // Accepted/declined here, or a new invite pushed over the socket
    return onChange("invites", load);
  }, [load]);

  return count;
}
