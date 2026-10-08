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
  Pie,
  PieChart,
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
import { NO_BACKEND, parseJsonSafe } from "@/lib/api-client";

type ScheduleRow = {
  workflowId: string;
  workflowName: string;
  clientName: string | null;
  fileNamePattern: string | null;
  latestFileName: string | null;
  latestFileId: string | null;
  frequency: string;
  frequencyLabel: string;
  owners: string[];
  status: "done" | "not_done" | "delayed";
  statusLabel: string;
  periodLabel: string;
  lastUploadAt: string | null;
};

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
  rulePerformance?: {
    itemKey: string;
    label: string;
    isCritical: boolean;
    passed: number;
    failed: number;
    total: number;
    passRate: number;
  }[];
  ruleChart?: {
    name: string;
    itemKey: string;
    passed: number;
    failed: number;
    passRate: number;
  }[];
  scheduleReports?: ScheduleRow[];
  scheduleChart?: { name: string; value: number; fill: string }[];
  alerts?: Array<{
    severity: "danger" | "warning";
    workflowId: string;
    title: string;
    message: string;
  }>;
  filterOptions?: {
    clients: string[];
    owners: string[];
    workflows: { id: string; name: string; clientName: string | null }[];
  };
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
    ruleChecks?: Array<{
      itemKey: string;
      label: string;
      isCritical: boolean;
      workflowId: string | null;
      workflowName: string | null;
      clientName: string | null;
      fileId: string;
      fileName: string;
      passed: boolean;
      acknowledged: boolean;
      checkedAt: string;
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

function ScheduleBadge({ status }: { status: ScheduleRow["status"] }) {
  const styles =
    status === "done"
      ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
      : status === "delayed"
        ? "bg-rose-50 text-rose-800 ring-rose-200"
        : "bg-amber-50 text-amber-900 ring-amber-200";
  const label = status === "done" ? "Done" : status === "delayed" ? "Delayed" : "Not Done";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${styles}`}>
      {label}
    </span>
  );
}

export default function DashboardPage() {
  const toast = useToast();
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [workflowId, setWorkflowId] = useState("");
  const [client, setClient] = useState("");
  const [owner, setOwner] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState(format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [dismissedAlerts, setDismissedAlerts] = useState(false);
  const [ruleFilter, setRuleFilter] = useState<"all" | "failed" | "passed">("all");
  const [ruleKeyFilter, setRuleKeyFilter] = useState("");
  const [filterOptions, setFilterOptions] = useState<NonNullable<DashboardPayload["filterOptions"]>>({
    clients: [],
    owners: [],
    workflows: [],
  });

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (workflowId) p.set("workflowId", workflowId);
    if (client) p.set("client", client);
    if (owner) p.set("owner", owner);
    if (status) p.set("status", status);
    if (from) p.set("from", `${from}T00:00:00.000Z`);
    if (to) p.set("to", `${to}T23:59:59.999Z`);
    return p.toString();
  }, [workflowId, client, owner, status, from, to]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/dashboard?${qs}`);
      if (res.status === 503) {
        setData(null);
        toast({ type: "info", message: NO_BACKEND });
        return;
      }
      const json = await parseJsonSafe<DashboardPayload & { error?: string }>(res);
      if (!res.ok) throw new Error(json.error || "Failed to load dashboard");
      setData(json);
      if (json.filterOptions) setFilterOptions(json.filterOptions);
      setDismissedAlerts(false);
    } catch (e) {
      setData(null);
      toast({ type: "error", message: e instanceof Error ? e.message : "Error" });
    } finally {
      setLoading(false);
    }
  }, [qs, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const m = data?.metrics;
  const delayedCount = m?.scheduleDelayed ?? 0;
  const notDoneCount = m?.scheduleNotDone ?? 0;

  const primaryMetrics = m
    ? [
        { label: "Total files", value: m.total, accent: "border-l-brand-600" },
        { label: "Passed", value: m.passed, accent: "border-l-exec-success" },
        { label: "Schedule done", value: m.scheduleDone ?? 0, accent: "border-l-exec-success" },
        { label: "Delayed", value: delayedCount, accent: "border-l-exec-danger" },
      ]
    : [];

  const secondaryMetrics = m
    ? [
        { label: "Not done", value: notDoneCount },
        { label: "Failed files", value: m.failed },
        { label: "Rule checks failed", value: m.ruleChecksFailed ?? 0 },
        { label: "Duplicate attempts", value: m.duplicateAttempts },
      ]
    : [];

  const workflowChartData =
    data?.workflowPerformance.map((w) => ({
      ...w,
      label: w.clientName ? `${w.name} (${w.clientName})` : w.name,
    })) || [];

  const ruleTableRows = useMemo(() => {
    const rows = data?.tables.ruleChecks || [];
    return rows.filter((r) => {
      if (ruleFilter === "failed" && r.passed) return false;
      if (ruleFilter === "passed" && !r.passed) return false;
      if (ruleKeyFilter && r.itemKey !== ruleKeyFilter) return false;
      return true;
    });
  }, [data?.tables.ruleChecks, ruleFilter, ruleKeyFilter]);

  const ruleKeyOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of data?.tables.ruleChecks || []) {
      map.set(r.itemKey, r.label);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data?.tables.ruleChecks]);

  const showAlertBanner =
    !dismissedAlerts && ((data?.alerts?.length ?? 0) > 0) && (delayedCount > 0 || notDoneCount > 0);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        description="Schedule health, workflow performance, and interactive audit-rule check results."
      />

      {showAlertBanner && (
        <div className="overflow-hidden rounded-xl border border-rose-200/80 bg-gradient-to-r from-rose-50 via-white to-amber-50 shadow-card">
          <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
            <div>
              <p className="text-sm font-semibold text-rose-900">
                {delayedCount > 0
                  ? `${delayedCount} delayed upload${delayedCount === 1 ? "" : "s"}`
                  : "Uploads awaiting completion"}
              </p>
              <ul className="mt-2 space-y-1 text-sm text-slate-700">
                {(data?.alerts || []).slice(0, 4).map((a) => (
                  <li key={`${a.workflowId}-${a.title}`}>
                    <span className={a.severity === "danger" ? "text-rose-700" : "text-amber-800"}>
                      {a.message}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <Button type="button" variant="ghost" onClick={() => setDismissedAlerts(true)}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      <Card title="Date range & filters" subtitle="Client and Data owner scope schedule + file metrics. Date/status apply to file charts only.">
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
            Client
            <select value={client} onChange={(e) => setClient(e.target.value)} className="form-input mt-1 min-w-[160px]">
              <option value="">All clients</option>
              {filterOptions.clients.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-slate-600">
            Data owner
            <select value={owner} onChange={(e) => setOwner(e.target.value)} className="form-input mt-1 min-w-[160px]">
              <option value="">All owners</option>
              {filterOptions.owners.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-slate-600">
            Workflow
            <select
              value={workflowId}
              onChange={(e) => setWorkflowId(e.target.value)}
              className="form-input mt-1 min-w-[180px]"
            >
              <option value="">All workflows</option>
              {filterOptions.workflows.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.clientName ? `${w.name} · ${w.clientName}` : w.name}
                </option>
              ))}
            </select>
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
        <div className="grid gap-6 lg:grid-cols-3">
          <Card title="Schedule health" subtitle="Done / Not Done / Delayed by frequency">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.scheduleChart || []}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={56}
                    outerRadius={88}
                    paddingAngle={4}
                    stroke="#fff"
                    strokeWidth={2}
                    isAnimationActive
                    animationDuration={800}
                    animationBegin={80}
                  >
                    {(data.scheduleChart || []).map((entry, i) => (
                      <Cell key={i} fill={entry.fill} className="transition-opacity hover:opacity-90" />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={chartTooltipStyle}
                    formatter={(value: number, name: string) => [`${value} workflow(s)`, name]}
                  />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card title="Status trend (14 days)" subtitle="Passed vs failed">
            <div className="h-64">
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
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#64748b" }} tickFormatter={(v) => String(v).slice(5)} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={chartTooltipStyle} />
                  <Area type="monotone" dataKey="processed" name="Passed" stroke={chartColors.success} strokeWidth={2.5} fill="url(#passedFill)" activeDot={{ r: 5 }} isAnimationActive animationDuration={900} />
                  <Area type="monotone" dataKey="failed" name="Failed" stroke={chartColors.danger} strokeWidth={2.5} fill="url(#failedFill)" activeDot={{ r: 5 }} isAnimationActive animationDuration={900} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card title="Top failure codes">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.topFailures} margin={{ top: 8, right: 8, left: 0, bottom: 28 }} barCategoryGap="28%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#e8eef4" vertical={false} />
                  <XAxis dataKey="code" tick={{ fontSize: 9, fill: "#64748b" }} interval={0} angle={-16} textAnchor="end" height={48} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={chartTooltipStyle} cursor={{ fill: "rgba(26,51,82,0.04)" }} />
                  <Bar dataKey="count" name="Count" radius={[8, 8, 0, 0]} maxBarSize={40} isAnimationActive animationDuration={850}>
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
        <Card
          title="Upload schedule report"
          subtitle="Client, expected filename, frequency, and period status (Done / Not Done / Delayed)."
        >
          <div className="overflow-auto rounded-xl border border-[var(--border-subtle)] shadow-sm">
            <table className="data-table w-full min-w-[720px] text-sm">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Workflow</th>
                  <th>Filename</th>
                  <th>Frequency</th>
                  <th>Period</th>
                  <th>Last upload</th>
                  <th>Owners</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(data.scheduleReports || []).length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-slate-500">
                      No active workflows yet. Create a workflow with a frequency to track completion.
                    </td>
                  </tr>
                ) : (
                  (data.scheduleReports || []).map((r) => (
                    <tr key={r.workflowId} className={r.status === "delayed" ? "bg-rose-50/40" : undefined}>
                      <td className="font-medium text-slate-900">{r.clientName || "—"}</td>
                      <td>
                        <Link className="text-link" href={`/workflows/${r.workflowId}`}>
                          {r.workflowName}
                        </Link>
                      </td>
                      <td className="max-w-[220px]">
                        {r.latestFileId ? (
                          <Link className="text-link truncate block" href={`/files/${r.latestFileId}`} title={r.latestFileName || ""}>
                            {r.latestFileName}
                          </Link>
                        ) : (
                          <span className="font-mono text-xs text-slate-500" title={r.fileNamePattern || ""}>
                            {r.fileNamePattern || "—"}
                          </span>
                        )}
                      </td>
                      <td>{r.frequencyLabel}</td>
                      <td className="text-slate-600">{r.periodLabel}</td>
                      <td className="whitespace-nowrap text-slate-600">
                        {r.lastUploadAt ? new Date(r.lastUploadAt).toLocaleString() : "—"}
                      </td>
                      <td className="max-w-[160px] truncate text-slate-600" title={r.owners.join(", ")}>
                        {r.owners.length ? r.owners.join(", ") : "—"}
                      </td>
                      <td>
                        <ScheduleBadge status={r.status} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {data && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card
            title="Audit rule performance"
            subtitle="Pass vs fail for active workflow rules in the selected range (removed rules are not counted)."
          >
            <div className="h-80">
              {(data.ruleChart || []).length === 0 ? (
                <p className="flex h-full items-center justify-center text-sm text-slate-500">
                  No rule-check results in this range yet.
                </p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.ruleChart || []} margin={{ top: 8, right: 8, left: 0, bottom: 56 }} barGap={6}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e8eef4" vertical={false} />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 10, fill: "#64748b" }}
                      interval={0}
                      angle={-18}
                      textAnchor="end"
                      height={72}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={chartTooltipStyle}
                      cursor={{ fill: "rgba(26,51,82,0.04)" }}
                      formatter={(value: number, name: string, props) => {
                        const rate = (props?.payload as { passRate?: number } | undefined)?.passRate;
                        if (name === "Passed" && rate != null) return [`${value} (${rate}% pass)`, name];
                        return [value, name];
                      }}
                    />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="passed" name="Passed" fill={chartColors.success} radius={[6, 6, 0, 0]} maxBarSize={32} isAnimationActive animationDuration={900} />
                    <Bar dataKey="failed" name="Failed" fill={chartColors.danger} radius={[6, 6, 0, 0]} maxBarSize={32} isAnimationActive animationDuration={900} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>
          <Card title="Rule pass rates" subtitle="Click a rule in the table filters to explore">
            <div className="h-80 overflow-auto">
              <table className="data-table w-full text-sm">
                <thead>
                  <tr>
                    <th>Rule</th>
                    <th>Critical</th>
                    <th>Passed</th>
                    <th>Failed</th>
                    <th>Pass %</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.rulePerformance || []).length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-slate-500">
                        No checklist results yet.
                      </td>
                    </tr>
                  ) : (
                    (data.rulePerformance || []).map((r) => (
                      <tr
                        key={r.itemKey}
                        className="cursor-pointer hover:bg-slate-50"
                        onClick={() => setRuleKeyFilter(r.itemKey)}
                      >
                        <td className="font-medium text-slate-900">{r.label}</td>
                        <td>{r.isCritical ? "Yes" : "No"}</td>
                        <td className="tabular-nums text-emerald-700">{r.passed}</td>
                        <td className="tabular-nums text-rose-700">{r.failed}</td>
                        <td className="tabular-nums">{r.passRate}%</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {data && (
        <Card
          title="Rule-check results"
          subtitle="Interactive detail for each audit rule evaluation on files in range."
        >
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <label className="block text-xs font-medium text-slate-600">
              Outcome
              <select
                value={ruleFilter}
                onChange={(e) => setRuleFilter(e.target.value as "all" | "failed" | "passed")}
                className="form-input mt-1"
              >
                <option value="all">All</option>
                <option value="failed">Failed only</option>
                <option value="passed">Passed only</option>
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-600">
              Rule
              <select
                value={ruleKeyFilter}
                onChange={(e) => setRuleKeyFilter(e.target.value)}
                className="form-input mt-1 min-w-[200px]"
              >
                <option value="">All rules</option>
                {ruleKeyOptions.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {(ruleFilter !== "all" || ruleKeyFilter) && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setRuleFilter("all");
                  setRuleKeyFilter("");
                }}
              >
                Clear filters
              </Button>
            )}
            <p className="ml-auto text-xs text-slate-500">
              Showing {ruleTableRows.length} of {(data.tables.ruleChecks || []).length} checks
            </p>
          </div>
          <div className="overflow-auto rounded-xl border border-[var(--border-subtle)] shadow-sm">
            <table className="data-table w-full min-w-[880px] text-sm">
              <thead>
                <tr>
                  <th>Checked</th>
                  <th>File</th>
                  <th>Client</th>
                  <th>Workflow</th>
                  <th>Rule</th>
                  <th>Critical</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {ruleTableRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-slate-500">
                      No rule checks match these filters.
                    </td>
                  </tr>
                ) : (
                  ruleTableRows.map((r, idx) => (
                    <tr key={`${r.fileId}-${r.itemKey}-${idx}`}>
                      <td className="whitespace-nowrap text-slate-600">
                        {r.checkedAt ? new Date(r.checkedAt).toLocaleString() : "—"}
                      </td>
                      <td>
                        <Link className="text-link" href={`/files/${r.fileId}`}>
                          {r.fileName}
                        </Link>
                      </td>
                      <td>{r.clientName || "—"}</td>
                      <td>
                        {r.workflowId ? (
                          <Link className="text-link" href={`/workflows/${r.workflowId}`}>
                            {r.workflowName || r.workflowId}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="font-medium text-slate-900">{r.label}</td>
                      <td>{r.isCritical ? "Yes" : "No"}</td>
                      <td>
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${
                            r.passed
                              ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                              : "bg-rose-50 text-rose-800 ring-rose-200"
                          }`}
                        >
                          {r.passed ? "Passed" : "Failed"}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {data && (
        <Card title="Workflow performance" subtitle="Passed vs failed by workflow">
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={workflowChartData} margin={{ top: 8, right: 8, left: 0, bottom: 48 }} barGap={6}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e8eef4" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#64748b" }} interval={0} angle={-14} textAnchor="end" height={70} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={chartTooltipStyle} cursor={{ fill: "rgba(26,51,82,0.04)" }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="processed" name="Passed" fill={chartColors.success} radius={[6, 6, 0, 0]} maxBarSize={36} isAnimationActive animationDuration={900} />
                <Bar dataKey="failed" name="Failed" fill={chartColors.danger} radius={[6, 6, 0, 0]} maxBarSize={36} isAnimationActive animationDuration={900} />
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
