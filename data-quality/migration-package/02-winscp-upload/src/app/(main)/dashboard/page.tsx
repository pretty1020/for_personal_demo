"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { FileStatusBadge } from "@/components/status-badge";
import { useToast } from "@/components/toast";
import { subDays, format } from "date-fns";
import { chartColors } from "@/lib/theme";
import { emptyDashboardPayload } from "@/lib/dashboard-payload";
import { NO_BACKEND, parseJsonSafe } from "@/lib/api-client";

type DashboardPayload = {
  metrics: Record<string, number>;
  trend: { date: string; processed: number; failed: number }[];
  topFailures: { code: string; count: number }[];
  workflowPerformance: { workflowId: string; name: string; processed: number; failed: number }[];
  tables: {
    recent: Array<{
      id: string;
      original_name: string;
      status: string;
      workflow_id: string | null;
      created_at: string;
    }>;
    failedFiles: Array<{ id: string; original_name: string; status: string; workflow_id: string | null }>;
  };
};

export default function DashboardPage() {
  const toast = useToast();
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [workflowId, setWorkflowId] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState(format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(new Date(), "yyyy-MM-dd"));

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (workflowId) p.set("workflowId", workflowId);
    if (status) p.set("status", status);
    if (from) p.set("from", `${from}T00:00:00.000Z`);
    if (to) p.set("to", `${to}T23:59:59.999Z`);
    return p.toString();
  }, [workflowId, status, from, to]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/dashboard?${qs}`);
      if (res.status === 503) {
        setData(emptyDashboardPayload());
        toast({ type: "info", message: NO_BACKEND });
        return;
      }
      const json = await parseJsonSafe<DashboardPayload & { error?: string }>(res);
      if (!res.ok) throw new Error(json.error || "Failed to load dashboard");
      setData(json);
    } catch (e) {
      toast({ type: "error", message: e instanceof Error ? e.message : "Error" });
    } finally {
      setLoading(false);
    }
  }, [qs, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const m = data?.metrics;

  const primaryMetrics = m
    ? [
        { label: "Total files", value: m.total, accent: "border-l-brand-600" },
        { label: "Passed", value: m.passed, accent: "border-l-exec-success" },
        { label: "Failed", value: m.failed, accent: "border-l-exec-danger" },
        { label: "Completed today", value: m.completedToday, accent: "border-l-accent-500" },
      ]
    : [];

  const secondaryMetrics = m
    ? [
        { label: "Duplicate attempts", value: m.duplicateAttempts },
        { label: "Missing columns", value: m.missingColumnsIncidents },
        { label: "Invalid format", value: m.invalidFormatIncidents },
      ]
    : [];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        description="Overview of file quality, validation outcomes, and workflow performance."
      />

      <Card title="Date range & filters" subtitle="Adjust the window for all metrics and charts below.">
        <div className="flex flex-wrap items-end gap-4">
          <label className="block text-xs font-medium text-slate-600">
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="form-input mt-1" />
          </label>
          <label className="block text-xs font-medium text-slate-600">
            To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="form-input mt-1" />
          </label>
          <label className="block text-xs font-medium text-slate-600">
            Workflow
            <input
              value={workflowId}
              onChange={(e) => setWorkflowId(e.target.value)}
              placeholder="All workflows"
              className="form-input mt-1 w-44"
            />
          </label>
          <label className="block text-xs font-medium text-slate-600">
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="form-input mt-1">
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="validating">Validating</option>
              <option value="blocked">Blocked</option>
              <option value="processed">Processed</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>
          <Button variant="secondary" type="button" onClick={() => void load()} disabled={loading}>
            Apply filters
          </Button>
          <a href={`/api/exports/dashboard?${qs}`}>
            <Button variant="ghost" type="button">
              Export CSV
            </Button>
          </a>
        </div>
      </Card>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--border)] border-t-brand-600" />
          Loading metrics…
        </div>
      )}

      {m && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {primaryMetrics.map(({ label, value, accent }) => (
              <div key={label} className={`metric-card border-l-4 ${accent}`}>
                <p className="metric-label">{label}</p>
                <p className="metric-value">{value}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {secondaryMetrics.map(({ label, value }) => (
              <div
                key={label}
                className="stat-pill"
              >
                <span className="text-slate-500">{label}</span>
                <span className="ml-2 font-semibold tabular-nums text-slate-900">{value}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {data && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Status trend (14 days)">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.trend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Area type="monotone" dataKey="processed" stackId="1" stroke={chartColors.navy} fill={chartColors.navyLight} />
                  <Area type="monotone" dataKey="failed" stackId="2" stroke={chartColors.danger} fill={chartColors.dangerLight} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card title="Top failure codes">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.topFailures}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="code" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill={chartColors.navy} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card title="Workflow performance" subtitle="Processed vs failed in current filter">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.workflowPerformance}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-12} textAnchor="end" height={70} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="processed" fill={chartColors.success} />
                  <Bar dataKey="failed" fill={chartColors.danger} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      )}

      {data && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Recent files" subtitle="Completed and settled files in the selected period.">
            <div className="overflow-auto rounded-lg border border-[var(--border-subtle)]">
              <table className="data-table w-full text-sm">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.tables.recent.length === 0 ? (
                    <tr>
                      <td colSpan={2} className="py-8 text-center text-slate-500">
                        No files in this view yet.
                      </td>
                    </tr>
                  ) : (
                    data.tables.recent.map((f) => (
                      <tr key={f.id}>
                        <td>
                          <Link className="text-link" href={`/files/${f.id}`}>
                            {f.original_name}
                          </Link>
                        </td>
                        <td>
                          <FileStatusBadge status={f.status} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="Failed files" subtitle="Blocked or rejected files requiring attention.">
            <div className="overflow-auto rounded-lg border border-[var(--border-subtle)]">
              <table className="data-table w-full text-sm">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.tables.failedFiles.length === 0 ? (
                    <tr>
                      <td colSpan={2} className="py-8 text-center text-slate-500">
                        No failures in this view.
                      </td>
                    </tr>
                  ) : (
                    data.tables.failedFiles.map((f) => (
                      <tr key={f.id}>
                        <td>
                          <Link className="text-link" href={`/files/${f.id}`}>
                            {f.original_name}
                          </Link>
                        </td>
                        <td>
                          <FileStatusBadge status={f.status} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
