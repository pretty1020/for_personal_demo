"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button, buttonLinkClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { WorkflowStatusBadge } from "@/components/status-badge";
import { useToast } from "@/components/toast";
import { NO_BACKEND, parseJsonSafe } from "@/lib/api-client";

type Wf = {
  id: string;
  name: string;
  status: string;
  updated_at: string;
  stats?: { total: number; failed: number; lastRun: string | null; successRate: number };
};

export default function WorkflowsPage() {
  const toast = useToast();
  const [rows, setRows] = useState<Wf[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/workflows");
      if (res.status === 503) {
        setRows([]);
        toast({ type: "info", message: NO_BACKEND });
        return;
      }
      const json = await parseJsonSafe<{ workflows?: Wf[]; error?: string }>(res);
      if (!res.ok) throw new Error(json.error || "Failed");
      setRows(json.workflows || []);
    } catch (e) {
      toast({ type: "error", message: e instanceof Error ? e.message : "Error" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runScan(id: string) {
    const res = await fetch(`/api/workflows/${id}/run`, { method: "POST" });
    try {
      const json = await parseJsonSafe<{ error?: string; ingested?: number }>(res);
      if (!res.ok) toast({ type: "error", message: json.error || "Run failed" });
      else toast({ type: "success", message: `Ingested ${json.ingested ?? 0} file(s)` });
    } catch (e) {
      toast({ type: "error", message: e instanceof Error ? e.message : "Run failed" });
    }
    void load();
  }

  async function toggle(id: string, next: "active" | "disabled") {
    const res = await fetch(`/api/workflows/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (!res.ok) toast({ type: "error", message: "Update failed" });
    else toast({ type: "success", message: `Workflow ${next}` });
    void load();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workflows"
        description="Define validation rules, checklists, and intake settings for each data source."
        actions={
          <Link href="/workflows/new" className={buttonLinkClass("primary")}>
            New workflow
          </Link>
        }
      />
      {loading && <p className="text-sm text-slate-500">Loading…</p>}
      <Card title="All workflows">
        <div className="overflow-x-auto">
          <table className="data-table min-w-full text-sm">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Last activity</th>
                <th>Files</th>
                <th>Failed</th>
                <th>Success rate</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.id}>
                  <td className="font-medium text-slate-900">{w.name}</td>
                  <td>
                    <WorkflowStatusBadge status={w.status} />
                  </td>
                  <td className="text-slate-600">
                    {w.stats?.lastRun ? new Date(w.stats.lastRun).toLocaleString() : "—"}
                  </td>
                  <td>{w.stats?.total ?? 0}</td>
                  <td>{w.stats?.failed ?? 0}</td>
                  <td>{w.stats?.successRate ?? 0}%</td>
                  <td>
                    <div className="flex flex-wrap gap-2">
                      <Link href={`/workflows/${w.id}`} className={buttonLinkClass("secondary")}>
                        View
                      </Link>
                      <Link href={`/workflows/${w.id}/edit`} className={buttonLinkClass("ghost")}>
                        Edit
                      </Link>
                      <Button variant="secondary" type="button" onClick={() => void runScan(w.id)}>
                        Run / scan
                      </Button>
                      <Button
                        variant="ghost"
                        type="button"
                        onClick={() => void toggle(w.id, w.status === "active" ? "disabled" : "active")}
                      >
                        {w.status === "active" ? "Disable" : "Enable"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
