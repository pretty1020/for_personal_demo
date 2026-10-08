"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import type { ActionPlanPayload, AuditFinding, DashboardPayload } from "@/lib/types/audit";
import { formatPhp, formatPhpCompact } from "@/lib/currency";

type Biz = { id: string; name: string };

export function DashboardClient() {
  const [businesses, setBusinesses] = useState<Biz[]>([]);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [findings, setFindings] = useState<AuditFinding[]>([]);
  const [actionPlan, setActionPlan] = useState<ActionPlanPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [auditLoading, setAuditLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshBusinesses = useCallback(async () => {
    const res = await fetch("/api/business");
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Could not load businesses");
    const list = (json.businesses || []) as Biz[];
    setBusinesses(list);
    if (!businessId && list[0]) setBusinessId(list[0].id);
  }, [businessId]);

  const loadDashboard = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    try {
      const [dRes, fRes, rRes] = await Promise.all([
        fetch(`/api/dashboard?businessId=${businessId}`),
        fetch(`/api/findings?businessId=${businessId}`),
        fetch(`/api/audit/latest?businessId=${businessId}`),
      ]);
      const dJson = await dRes.json();
      if (!dRes.ok) throw new Error(dJson.error || "Dashboard failed");
      setDashboard(dJson.dashboard as DashboardPayload);

      const fJson = await fRes.json();
      if (fRes.ok) {
        const rows = (fJson.findings || []).map(
          (x: {
            id: string;
            severity: AuditFinding["severity"];
            category: AuditFinding["category"];
            title: string;
            detail: string;
            estimated_impact_php: number | null;
            recommended_action: string;
            source: AuditFinding["source"];
          }) => ({
            id: x.id,
            severity: x.severity,
            category: x.category,
            title: x.title,
            detail: x.detail,
            estimatedImpactPhp: x.estimated_impact_php,
            recommendedAction: x.recommended_action,
            source: x.source,
          })
        );
        setFindings(rows);
      }

      const rJson = await rRes.json();
      if (rRes.ok && rJson.report?.payload?.actionPlan) {
        setActionPlan(rJson.report.payload.actionPlan as ActionPlanPayload);
      } else {
        setActionPlan(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    refreshBusinesses().catch((e) => setError(e instanceof Error ? e.message : "Error"));
  }, [refreshBusinesses]);

  useEffect(() => {
    loadDashboard().catch((e) => setError(e instanceof Error ? e.message : "Error"));
  }, [loadDashboard]);

  const kpis = dashboard?.kpis;

  const missingCopy = useMemo(() => {
    if (!kpis) return null;
    const m = kpis.missing;
    const parts: string[] = [];
    if (m.sales) parts.push("sales");
    if (m.inventory) parts.push("inventory");
    if (m.expenses) parts.push("expenses");
    if (m.staff) parts.push("staff");
    if (!parts.length) return null;
    return `Missing uploads: ${parts.join(", ")}. Some KPIs and charts stay empty until you add them.`;
  }, [kpis]);

  async function ensureBusiness() {
    const name = prompt("Business name", "My Cafe");
    if (!name) return;
    const res = await fetch("/api/business", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const json = await res.json();
    if (!res.ok) {
      alert(json.error || "Could not create");
      return;
    }
    setBusinessId(json.business.id);
    await refreshBusinesses();
  }

  async function runAudit() {
    if (!businessId) return;
    setAuditLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/audit/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Audit failed");
      setFindings(json.findings || []);
      setActionPlan(json.actionPlan || null);
      setDashboard(json.dashboard as DashboardPayload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Audit error");
    } finally {
      setAuditLoading(false);
    }
  }

  if (!businesses.length) {
    return (
      <div className="rounded-3xl border border-dashed border-navy-900/20 bg-white p-10 text-center dark:border-white/15 dark:bg-navy-900/40">
        <h1 className="font-display text-2xl">Create your first business</h1>
        <p className="mt-2 text-sm text-navy-900/70 dark:text-cream-200/75">
          A business profile keeps uploads, KPIs, and audit history together.
        </p>
        <button
          type="button"
          onClick={ensureBusiness}
          className="mt-6 rounded-full bg-navy-900 px-5 py-2.5 text-sm font-semibold text-cream-50 hover:bg-navy-850 dark:bg-gold-400 dark:text-navy-950"
        >
          Create business
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="font-display text-3xl text-navy-950 dark:text-cream-50">AI audit dashboard</h1>
          <p className="mt-1 text-sm text-navy-900/70 dark:text-cream-200/75">
            KPIs, charts, and findings use only normalized data from your uploads.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
          <button
            type="button"
            onClick={runAudit}
            disabled={auditLoading}
            className="rounded-full bg-gold-400 px-4 py-2 text-sm font-semibold text-navy-950 hover:bg-gold-300 disabled:opacity-50"
          >
            {auditLoading ? "Running…" : "Refresh AI audit"}
          </button>
        </div>
      </div>

      {missingCopy && (
        <div className="rounded-2xl border border-amber-300/60 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-50">
          {missingCopy}
        </div>
      )}
      {error && (
        <div className="rounded-2xl border border-red-300/60 bg-red-50 p-4 text-sm text-red-900 dark:border-red-400/40 dark:bg-red-500/10 dark:text-red-50">
          {error}
        </div>
      )}

      {loading || !kpis ? (
        <p className="text-sm text-navy-900/70 dark:text-cream-200/70">Loading dashboard…</p>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi title="Total sales" value={formatPhp(kpis.totalSales)} hint="Uploaded period" />
            <Kpi title="Gross profit" value={formatPhp(kpis.grossProfit)} hint="Sales − COGS" />
            <Kpi
              title="Est. food cost %"
              value={kpis.foodCostPct === null ? "—" : `${kpis.foodCostPct.toFixed(1)}%`}
              hint="From line-level COGS"
            />
            <Kpi
              title="Labor cost %"
              value={kpis.laborCostPct === null ? "—" : `${(kpis.laborCostPct * 100).toFixed(1)}%`}
              hint="Labor ÷ sales"
            />
            <Kpi title="Waste risk" value={`${kpis.wasteRiskScore}/100`} hint="Composite" />
            <Kpi title="Profit leak score" value={`${kpis.profitLeakScore}/100`} hint="Higher = more risk" />
            <Kpi title="Dead hours" value={String(kpis.deadHoursCount)} hint="Weak hourly buckets" />
            <Kpi title="Low-margin items" value={String(kpis.lowMarginItemCount)} hint="Under 42% margin" />
          </section>

          <section className="grid gap-6 lg:grid-cols-2">
            <ChartCard title="Sales by day">
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={dashboard!.salesByDay}>
                  <defs>
                    <linearGradient id="gSales" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#d4af37" stopOpacity={0.9} />
                      <stop offset="95%" stopColor="#d4af37" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatPhpCompact(Number(v))} />
                  <Tooltip formatter={(value) => formatPhp(Number(value))} />
                  <Area type="monotone" dataKey="total" stroke="#d4af37" fillOpacity={1} fill="url(#gSales)" />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Sales by hour">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={dashboard!.salesByHour}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatPhpCompact(Number(v))} />
                  <Tooltip formatter={(value) => formatPhp(Number(value))} />
                  <Bar dataKey="total" fill="#121f35" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Top items by revenue">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart layout="vertical" data={dashboard!.topItemsRevenue.slice(0, 6)}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => formatPhpCompact(Number(v))} />
                  <YAxis type="category" dataKey="item" width={120} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value) => formatPhp(Number(value))} />
                  <Bar dataKey="total" fill="#2f9e6a" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Top items by profit">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart layout="vertical" data={dashboard!.topItemsProfit.slice(0, 6)}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => formatPhpCompact(Number(v))} />
                  <YAxis type="category" dataKey="item" width={120} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value) => formatPhp(Number(value))} />
                  <Bar dataKey="profit" fill="#d4af37" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Low-margin items">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={dashboard!.lowMarginItems.slice(0, 6)}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="item" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                  <Tooltip />
                  <Bar dataKey="marginPct" fill="#e5484d" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Inventory usage vs sales qty">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={dashboard!.inventoryVsSales.slice(0, 6)}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="item" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="usage" name="Usage" fill="#121f35" />
                  <Bar dataKey="salesQty" name="Sales qty" fill="#d4af37" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Expense breakdown">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={dashboard!.expenseBreakdown}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="category" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatPhpCompact(Number(v))} />
                  <Tooltip formatter={(value) => formatPhp(Number(value))} />
                  <Bar dataKey="total" fill="#121f35" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Labor cost trend">
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={dashboard!.laborTrend}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatPhpCompact(Number(v))} />
                  <Tooltip formatter={(value) => formatPhp(Number(value))} />
                  <Area type="monotone" dataKey="labor" stroke="#e5484d" fill="#e5484d33" />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
          </section>

          <section className="rounded-3xl border border-navy-900/10 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-navy-900/50">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-2xl">AI & rule findings</h2>
              <span className="rounded-full bg-navy-900/5 px-3 py-1 text-xs font-semibold text-navy-900/70 dark:bg-white/5 dark:text-cream-200/80">
                Severity · Category · Impact
              </span>
            </div>
            {findings.length === 0 ? (
              <p className="mt-4 text-sm text-navy-900/70 dark:text-cream-200/70">
                No findings yet. Tap “Refresh AI audit” after uploading data.
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {findings.map((f) => (
                  <li
                    key={f.id}
                    className="rounded-2xl border border-navy-900/10 bg-cream-50/60 p-4 dark:border-white/10 dark:bg-navy-950/40"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityBadge severity={f.severity} />
                      <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-navy-900/70 dark:bg-navy-900 dark:text-cream-200/80">
                        {f.category}
                      </span>
                      <span className="rounded-full bg-navy-900/5 px-2 py-0.5 text-[11px] font-semibold text-navy-900/60 dark:bg-white/5 dark:text-cream-200/70">
                        {f.source}
                      </span>
                      {f.estimatedImpactPhp !== null && (
                        <span className="text-xs font-semibold text-gold-700 dark:text-gold-300">
                          Est. impact {formatPhp(f.estimatedImpactPhp)}
                        </span>
                      )}
                    </div>
                    <p className="mt-2 font-semibold text-navy-950 dark:text-cream-50">{f.title}</p>
                    <p className="mt-1 text-sm text-navy-900/75 dark:text-cream-200/80">{f.detail}</p>
                    <p className="mt-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
                      Action: {f.recommendedAction}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {actionPlan && (
            <section className="rounded-3xl border border-navy-900/10 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-navy-900/50">
              <h2 className="font-display text-2xl">Latest 7-day action plan</h2>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {actionPlan.sevenDayPlan.map((d) => (
                  <div
                    key={d.day}
                    className="rounded-2xl border border-navy-900/10 bg-cream-50/60 p-4 dark:border-white/10 dark:bg-navy-950/40"
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide text-gold-700 dark:text-gold-300">
                      Day {d.day}
                    </p>
                    <p className="mt-1 font-semibold">{d.focus}</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-navy-900/80 dark:text-cream-200/80">
                      {d.tasks.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Kpi({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-navy-900/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-navy-900/50">
      <p className="text-xs font-semibold uppercase tracking-wide text-navy-900/50 dark:text-cream-200/60">
        {title}
      </p>
      <p className="mt-2 text-2xl font-semibold text-navy-950 dark:text-cream-50">{value}</p>
      <p className="mt-1 text-xs text-navy-900/60 dark:text-cream-200/60">{hint}</p>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-3xl border border-navy-900/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-navy-900/50">
      <p className="text-sm font-semibold text-navy-950 dark:text-cream-50">{title}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: AuditFinding["severity"] }) {
  const cls =
    severity === "High"
      ? "bg-red-600 text-white"
      : severity === "Medium"
        ? "bg-amber-500 text-navy-950"
        : "bg-emerald-700 text-white";
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${cls}`}>{severity}</span>;
}
