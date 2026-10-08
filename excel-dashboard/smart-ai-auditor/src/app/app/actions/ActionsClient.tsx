"use client";

import { useCallback, useEffect, useState } from "react";
import type { ActionPlanPayload } from "@/lib/types/audit";

type Biz = { id: string; name: string };

export function ActionsClient() {
  const [businesses, setBusinesses] = useState<Biz[]>([]);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [plan, setPlan] = useState<ActionPlanPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/audit/latest?businessId=${businessId}`);
      const json = await res.json();
      if (res.ok && json.report?.payload?.actionPlan) {
        setPlan(json.report.payload.actionPlan as ActionPlanPayload);
      } else {
        setPlan(null);
      }
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
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="font-display text-3xl text-navy-950 dark:text-cream-50">Action plan generator</h1>
          <p className="mt-1 text-sm text-navy-900/70 dark:text-cream-200/75">
            Generated after each AI audit run. Practical levers: pricing, promos, staffing, inventory, and menu.
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
        <p className="text-sm text-navy-900/70 dark:text-cream-200/70">Loading…</p>
      ) : !plan ? (
        <div className="rounded-3xl border border-dashed border-navy-900/20 bg-white p-10 text-center dark:border-white/15 dark:bg-navy-900/40">
          <p className="text-sm text-navy-900/75 dark:text-cream-200/80">
            No AI plan yet. Upload data, then tap <span className="font-semibold">Refresh AI audit</span> on the
            dashboard.
          </p>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-3xl border border-navy-900/10 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-navy-900/50">
            <h2 className="font-display text-xl">7-day plan</h2>
            <div className="mt-4 space-y-3">
              {plan.sevenDayPlan.map((d) => (
                <div key={d.day} className="rounded-2xl border border-navy-900/10 bg-cream-50/60 p-4 dark:border-white/10 dark:bg-navy-950/40">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gold-700 dark:text-gold-300">
                    Day {d.day} · {d.focus}
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-navy-900/80 dark:text-cream-200/80">
                    {d.tasks.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          <div className="space-y-4">
            <PlanBlock title="Pricing" items={plan.pricing} />
            <PlanBlock title="Promos" items={plan.promos} />
            <PlanBlock title="Staffing" items={plan.staffing} />
            <PlanBlock title="Inventory control" items={plan.inventory} />
            <PlanBlock title="Menu" items={plan.menu} />
          </div>
        </div>
      )}
    </div>
  );
}

function PlanBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="rounded-3xl border border-navy-900/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-navy-900/50">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-navy-900/60 dark:text-cream-200/60">
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-navy-900/60 dark:text-cream-200/60">No items in the last run.</p>
      ) : (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-navy-900/80 dark:text-cream-200/80">
          {items.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
