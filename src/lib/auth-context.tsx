import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { auth as authApi, setUnauthorizedHandler } from "./api";
import { clearAllTokens, loadPrefs, loadTokens, setTokens } from "./storage";
import { PREF_KEYS } from "./prefs";

type Status = "loading" | "signedOut" | "signedIn";

interface AuthCtx {
  status: Status;
  signIn: (accessToken: string, refreshToken?: string | null) => Promise<void>;
  /** Clears the session. `beforeSignOut` hooks (push unregistration…) run first. */
  signOut: () => Promise<void>;
  registerBeforeSignOut: (fn: () => Promise<void> | void) => () => void;
}

const AuthContext = createContext<AuthCtx>({
  status: "loading",
  signIn: async () => {},
  signOut: async () => {},
  registerBeforeSignOut: () => () => {},
});

export const useAuth = () => useContext(AuthContext);

const beforeSignOut = new Set<() => Promise<void> | void>();

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [token] = await Promise.all([loadTokens(), loadPrefs(PREF_KEYS)]);
      if (!cancelled) setStatus(token ? "signedIn" : "signedOut");
    })();
    // Refresh failed somewhere — back to sign-in
    setUnauthorizedHandler(() => setStatus("signedOut"));
    return () => {
      cancelled = true;
      setUnauthorizedHandler(null);
    };
  }, []);

  const signIn = useCallback(async (access: string, refresh?: string | null) => {
    await setTokens(access, refresh);
    setStatus("signedIn");
  }, []);

  const signOut = useCallback(async () => {
    for (const fn of beforeSignOut) {
      try { await fn(); } catch { /* ignore */ }
    }
    await authApi.logout().catch(() => {});
    await clearAllTokens();
    setStatus("signedOut");
  }, []);

  const registerBeforeSignOut = useCallback((fn: () => Promise<void> | void) => {
    beforeSignOut.add(fn);
    return () => { beforeSignOut.delete(fn); };
  }, []);

  const value = useMemo(() => ({ status, signIn, signOut, registerBeforeSignOut }), [status, signIn, signOut, registerBeforeSignOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Pull access/refresh tokens out of the backend's login / google responses */
export function extractTokens(data: unknown): { accessToken?: string; refreshToken?: string } {
  const inner = (data as { data?: Record<string, unknown> } | null)?.data;
  const tok =
    (inner?.token as { accessToken?: string; refreshToken?: string } | undefined) ??
    (inner?.authToken as { accessToken?: string; refreshToken?: string } | undefined);
  return { accessToken: tok?.accessToken, refreshToken: tok?.refreshToken };
}

export function firstError(data: unknown, fallback: string): string {
  const errs = (data as { errors?: string[] } | null)?.errors;
  return errs?.[0] ?? fallback;
}
