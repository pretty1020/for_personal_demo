"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
  workflowPerformance: {
    workflowId: string;
    name: string;
    clientName?: string | null;
    processed: number;
    failed: number;
  }[];
  tables: {
    recent: Array<{
      id: string;
      original_name: string;
      status: string;
      workflow_id: string | null;
      workflow_name?: string | null;
      client_name?: string | null;
      created_at: string;
    }>;
    failedFiles: Array<{
      id: string;
      original_name: string;
      status: string;
      workflow_id: string | null;
      workflow_name?: string | null;
      client_name?: string | null;
    }>;
  };
};

const FAILURE_PALETTE = [
  chartColors.navy,
  chartColors.gold,
  chartColors.danger,
  chartColors.warning,
  chartColors.success,
  "#5b7c99",
  "#c4a484",
  "#6b8f71",
];

const chartTooltipStyle = {
  backgroundColor: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: 10,
  boxShadow: "0 8px 24px rgba(26, 51, 82, 0.12)",
  fontSize: 12,
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

  const workflowChartData =
    data?.workflowPerformance.map((w) => ({
      ...w,
      label: w.clientName ? `${w.name} (${w.clientName})` : w.name,
    })) || [];

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
              <div key={label} className="stat-pill">
                <span className="text-slate-500">{label}</span>
                <span className="ml-2 font-semibold tabular-nums text-slate-900">{value}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {data && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Status trend (14 days)" subtitle="Passed vs failed files by day">
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="passedFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={chartColors.success} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={chartColors.success} stopOpacity={0.04} />
                    </linearGradient>
                    <linearGradient id="failedFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={chartColors.danger} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={chartColors.danger} stopOpacity={0.04} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e8eef4" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: "#64748b" }}
                    tickFormatter={(v) => String(v).slice(5)}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={chartTooltipStyle} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  <Area
                    type="monotone"
                    dataKey="processed"
                    name="Passed"
                    stroke={chartColors.success}
                    strokeWidth={2.5}
                    fill="url(#passedFill)"
                    activeDot={{ r: 5 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="failed"
                    name="Failed"
                    stroke={chartColors.danger}
                    strokeWidth={2.5}
                    fill="url(#failedFill)"
                    activeDot={{ r: 5 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card title="Top failure codes" subtitle="Most frequent validation issues">
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.topFailures} margin={{ top: 8, right: 8, left: 0, bottom: 24 }} barCategoryGap="28%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#e8eef4" vertical={false} />
                  <XAxis
                    dataKey="code"
                    tick={{ fontSize: 10, fill: "#64748b" }}
                    interval={0}
                    angle={-18}
                    textAnchor="end"
                    height={56}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={chartTooltipStyle} cursor={{ fill: "rgba(26,51,82,0.04)" }} />
                  <Bar dataKey="count" name="Count" radius={[8, 8, 0, 0]} maxBarSize={48}>
                    {data.topFailures.map((_, i) => (
                      <Cell key={i} fill={FAILURE_PALETTE[i % FAILURE_PALETTE.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      )}

      {data && (
        <Card title="Workflow performance" subtitle="Passed vs failed by workflow (client name when set)">
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={workflowChartData} margin={{ top: 8, right: 8, left: 0, bottom: 48 }} barGap={6}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e8eef4" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  interval={0}
                  angle={-14}
                  textAnchor="end"
                  height={70}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={chartTooltipStyle} cursor={{ fill: "rgba(26,51,82,0.04)" }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="processed" name="Passed" fill={chartColors.success} radius={[6, 6, 0, 0]} maxBarSize={36} />
                <Bar dataKey="failed" name="Failed" fill={chartColors.danger} radius={[6, 6, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {data && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Recent files" subtitle="Completed and settled files in the selected period.">
            <div className="overflow-auto rounded-lg border border-[var(--border-subtle)]">
              <table className="data-table w-full text-sm">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Client</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.tables.recent.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="py-8 text-center text-slate-500">
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
                        <td className="text-slate-600">{f.client_name || "—"}</td>
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
                    <th>Client</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.tables.failedFiles.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="py-8 text-center text-slate-500">
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
                        <td className="text-slate-600">{f.client_name || "—"}</td>
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
