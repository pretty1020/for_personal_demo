"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { parseJsonSafe } from "@/lib/api-client";

export default function SettingsPage() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [dataMode, setDataMode] = useState<string | null>(null);
  const [storePath, setStorePath] = useState<string | null>(null);
  const [ephemeral, setEphemeral] = useState(false);
  const [notifications, setNotifications] = useState<Record<string, unknown>[]>([]);

  useEffect(() => {
    void (async () => {
      const cfg = await fetch("/api/config");
      const cj = await parseJsonSafe<{
        dataMode?: string;
        productionReady?: boolean;
        storePath?: string | null;
        ephemeralStorage?: boolean;
      }>(cfg);
      setDataMode(String(cj.dataMode ?? "none"));
      setConfigured(Boolean(cj.productionReady));
      setStorePath(cj.storePath ?? null);
      setEphemeral(Boolean(cj.ephemeralStorage));
      const res = await fetch("/api/notifications");
      if (res.ok) {
        const json = await parseJsonSafe<{ notifications?: Record<string, unknown>[] }>(res);
        setNotifications(json.notifications || []);
      }
    })();
  }, []);

  async function markAllRead() {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markAllRead: true }),
    });
    const res = await fetch("/api/notifications");
    const json = await parseJsonSafe<{ notifications?: Record<string, unknown>[] }>(res);
    setNotifications(json.notifications || []);
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="System configuration and notifications." />
      <Card title="Data connection">
        {configured === null && <p className="text-sm text-slate-500">Checking connection…</p>}
        {configured === false && (
          <p className="text-sm text-rose-700">
            Backend not ready. For local use, data is stored in{" "}
            <code className="rounded bg-[var(--card-header)] px-1.5 py-0.5 text-xs ring-1 ring-[var(--border-subtle)]">
              data/standalone/store.json
            </code>
            .
          </p>
        )}
        {configured === true && (dataMode === "json" || dataMode === "standalone") && (
          <div className="space-y-1 text-sm text-exec-success">
            <div className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-exec-success" />
              Local storage — <code className="text-xs">{storePath ?? "data/standalone/store.json"}</code>
            </div>
            {ephemeral && (
              <p className="text-xs text-amber-700">
                On Vercel, data is stored in temporary server storage and resets between deployments.
              </p>
            )}
          </div>
        )}
        {configured === true && dataMode === "mariadb" && (
          <div className="flex items-center gap-2 text-sm text-exec-success">
            <span className="inline-block h-2 w-2 rounded-full bg-exec-success" />
            Connected — MariaDB (internal database)
          </div>
        )}
      </Card>
      <Card
        title="Notifications"
        actions={
          <Button type="button" variant="secondary" onClick={() => void markAllRead()}>
            Mark all read
          </Button>
        }
      >
        <ul className="space-y-2 text-sm">
          {notifications.map((n) => (
            <li
              key={String(n.id)}
              className={`rounded-lg border px-4 py-3 ${n.read ? "border-[var(--border-subtle)] bg-white" : "border-accent-500/30 bg-brand-50/60"}`}
            >
              <div className="font-medium text-slate-900">{String(n.title)}</div>
              <div className="text-slate-600">{String(n.message)}</div>
              <div className="mt-1 text-xs text-slate-500">{new Date(String(n.created_at)).toLocaleString()}</div>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Exports">
        <p className="text-sm text-slate-600">
          Dashboard CSV:{" "}
          <a className="text-link" href="/api/exports/dashboard">
            Download
          </a>
        </p>
      </Card>
    </div>
  );
}
