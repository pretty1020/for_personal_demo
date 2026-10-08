"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { parseJsonSafe } from "@/lib/api-client";

export type DqAuthUser = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "user";
};

type DqAuthState = {
  loading: boolean;
  authRequired: boolean;
  user: DqAuthUser | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const DqAuthContext = createContext<DqAuthState | null>(null);

export function useDqAuth() {
  const ctx = useContext(DqAuthContext);
  if (!ctx) throw new Error("useDqAuth must be used within DqAuthProvider");
  return ctx;
}

export function DqAuthProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [user, setUser] = useState<DqAuthUser | null>(null);

  const isCapacity = pathname === "/capacity" || pathname.startsWith("/capacity/");
  const isLogin = pathname === "/login";

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/dq-auth/me", { credentials: "include" });
      const json = await parseJsonSafe<{
        authRequired?: boolean;
        user?: DqAuthUser | null;
        error?: string;
        code?: string;
      }>(res);

      const required = Boolean(json.authRequired ?? true);
      setAuthRequired(required);

      if (!required) {
        setUser(null);
        return;
      }

      if (res.status === 503 && json.code === "dq_auth_schema_missing") {
        setUser(null);
        return;
      }

      if (!res.ok || !json.user) {
        setUser(null);
        return;
      }

      setUser(json.user);
    } catch {
      setUser(null);
      setAuthRequired(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/dq-auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
    router.replace("/login");
    router.refresh();
  }, [router]);

  useEffect(() => {
    void refresh();
  }, [refresh, pathname]);

  useEffect(() => {
    if (loading || isCapacity || isLogin) return;
    if (authRequired && !user) {
      router.replace(`/login?next=${encodeURIComponent(pathname || "/dashboard")}`);
    }
  }, [loading, authRequired, user, isCapacity, isLogin, pathname, router]);

  const value = useMemo(
    () => ({ loading, authRequired, user, refresh, logout }),
    [loading, authRequired, user, refresh, logout],
  );

  return <DqAuthContext.Provider value={value}>{children}</DqAuthContext.Provider>;
}
