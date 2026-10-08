"use client";

import { useCallback, useEffect, useState } from "react";
import { buildScannerRows, type ScannerRow } from "@/lib/scannerChecks";
import type { DashboardPayload } from "@/lib/types/audit";

type Biz = { id: string; name: string };

export function ScannerClient() {
  const [businesses, setBusinesses] = useState<Biz[]>([]);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [rows, setRows] = useState<ScannerRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/dashboard?businessId=${businessId}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      const dash = json.dashboard as DashboardPayload;
      setRows(buildScannerRows(dash.kpis));
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    fetch("/api/business")
      .then((r) => r.json())
      .then((j) => {
        const list = (j.businesses || []) as Biz[];
        setBusinesses(list);
        setBusinessId((cur) => cur || list[0]?.id || null);
      });
  }, []);

  useEffect(() => {
    load().catch(() => setRows([]));
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="font-display text-3xl text-navy-950 dark:text-cream-50">Profit leak scanner</h1>
          <p className="mt-1 text-sm text-navy-900/70 dark:text-cream-200/75">
            Rule-based checks plus AI explanations on the dashboard. This page is your quick traffic-light view.
          </p>
        </div>
        <label className="text-xs font-semibold uppercase tracking-wide text-navy-900/60 dark:text-cream-200/60">
          Business
          <select
            className="ml-2 rounded-xl border border-navy-900/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-navy-900"
            value={businessId || ""}
            onChange={(e) => setBusinessId(e.target.value)}
          >
            {businesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <p className="text-sm text-navy-900/70 dark:text-cream-200/70">Scanning…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-navy-900/20 bg-white p-10 text-center text-sm text-navy-900/70 dark:border-white/15 dark:bg-navy-900/40 dark:text-cream-200/70">
          No business selected.
        </div>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-navy-900/10 bg-white shadow-sm dark:border-white/10 dark:bg-navy-900/50">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-navy-900 text-xs font-semibold uppercase tracking-wide text-cream-100">
              <tr>
                <th className="px-4 py-3">Check</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-navy-900/10 dark:border-white/10">
                  <td className="px-4 py-3 font-semibold text-navy-950 dark:text-cream-50">{r.label}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={r.status} />
                  </td>
                  <td className="px-4 py-3 text-navy-900/75 dark:text-cream-200/80">{r.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: ScannerRow["status"] }) {
  const map: Record<ScannerRow["status"], string> = {
    pass: "bg-emerald-600 text-white",
    warn: "bg-amber-500 text-navy-950",
    fail: "bg-red-600 text-white",
    na: "bg-navy-900/10 text-navy-900/60 dark:bg-white/10 dark:text-cream-200/70",
  };
  const label = status === "na" ? "Needs data" : status.toUpperCase();
  return <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${map[status]}`}>{label}</span>;
}
