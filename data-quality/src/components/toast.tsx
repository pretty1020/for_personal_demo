"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type Toast = { id: string; type: "success" | "error" | "info"; message: string };

const ToastCtx = createContext<(t: Omit<Toast, "id">) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);

  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = crypto.randomUUID();
    setItems((s) => [...s, { ...t, id }]);
    setTimeout(() => {
      setItems((s) => s.filter((x) => x.id !== id));
    }, 4500);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-lg border px-4 py-3 text-sm shadow-elevated ${
              t.type === "success"
                ? "border-exec-success/20 bg-emerald-50/90 text-exec-success"
                : t.type === "error"
                  ? "border-exec-danger/20 bg-rose-50/90 text-exec-danger"
                  : "border-[var(--border)] bg-white text-[var(--foreground)]"
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}
