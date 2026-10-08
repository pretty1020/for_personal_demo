"use client";

import { useCallback, useEffect, useState } from "react";
import { jsPDF } from "jspdf";
import * as XLSX from "xlsx";
import type { AuditFinding, DashboardPayload } from "@/lib/types/audit";
import { formatPhp } from "@/lib/currency";

type Biz = { id: string; name: string };

export function ReportsClient() {
  const [businesses, setBusinesses] = useState<Biz[]>([]);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [dash, setDash] = useState<DashboardPayload | null>(null);
  const [findings, setFindings] = useState<AuditFinding[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const [dRes, fRes] = await Promise.all([
        fetch(`/api/dashboard?businessId=${businessId}`),
        fetch(`/api/findings?businessId=${businessId}`),
      ]);
      const dJson = await dRes.json();
      if (!dRes.ok) throw new Error(dJson.error || "Failed");
      setDash(dJson.dashboard as DashboardPayload);

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
    } catch {
      setDash(null);
      setFindings([]);
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

  function downloadPdf() {
    if (!dash) return;
    const doc = new jsPDF();
    const k = dash.kpis;
    let y = 16;
    doc.setFontSize(16);
    doc.text("Smart AI Auditor — Executive summary", 14, y);
    y += 10;
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, y);
    y += 8;
    doc.text("Figures below come only from uploaded operational data.", 14, y);
    y += 10;
    doc.setFontSize(12);
    doc.text("KPI snapshot", 14, y);
    y += 7;
    doc.setFontSize(10);
    const lines = [
      `Total sales: ${formatPhp(k.totalSales)}`,
      `Gross profit: ${formatPhp(k.grossProfit)}`,
      `Food cost %: ${k.foodCostPct === null ? "n/a" : `${k.foodCostPct.toFixed(1)}%`}`,
      `Labor cost %: ${k.laborCostPct === null ? "n/a" : `${(k.laborCostPct * 100).toFixed(1)}%`}`,
      `Waste risk: ${k.wasteRiskScore}/100`,
      `Profit leak score: ${k.profitLeakScore}/100`,
      `Dead hours: ${k.deadHoursCount}`,
      `Low-margin items: ${k.lowMarginItemCount}`,
    ];
    for (const line of lines) {
      doc.text(line, 14, y);
      y += 6;
      if (y > 270) {
        doc.addPage();
        y = 16;
      }
    }
    y += 6;
    doc.setFontSize(12);
    doc.text("Top findings", 14, y);
    y += 7;
    doc.setFontSize(10);
    for (const f of findings.slice(0, 12)) {
      const block = `${f.severity} · ${f.category} — ${f.title}\n${f.detail}\nAction: ${f.recommendedAction}`;
      const parts = doc.splitTextToSize(block, 180);
      for (const p of parts) {
        doc.text(p, 14, y);
        y += 5;
        if (y > 270) {
          doc.addPage();
          y = 16;
        }
      }
      y += 2;
    }
    doc.save("smart-ai-auditor-executive.pdf");
  }

  function downloadExcel() {
    if (!dash) return;
    const k = dash.kpis;
    const wb = XLSX.utils.book_new();
    const summary = [
      { metric: "Total sales (PHP)", value: k.totalSales },
      { metric: "Gross profit (PHP)", value: k.grossProfit },
      { metric: "Food cost %", value: k.foodCostPct ?? "" },
      { metric: "Labor cost % (ratio)", value: k.laborCostPct ?? "" },
      { metric: "Waste risk score", value: k.wasteRiskScore },
      { metric: "Profit leak score", value: k.profitLeakScore },
      { metric: "Dead hours", value: k.deadHoursCount },
      { metric: "Low margin items", value: k.lowMarginItemCount },
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "KPIs");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dash.salesByDay), "Sales by day");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dash.salesByHour), "Sales by hour");
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        findings.map((f) => ({
          severity: f.severity,
          category: f.category,
          title: f.title,
          detail: f.detail,
          estimated_impact_php: f.estimatedImpactPhp,
          recommended_action: f.recommendedAction,
          source: f.source,
        }))
      ),
      "Findings"
    );
    XLSX.writeFile(wb, "smart-ai-auditor-summary.xlsx");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="font-display text-3xl text-navy-950 dark:text-cream-50">Downloadable reports</h1>
          <p className="mt-1 text-sm text-navy-900/70 dark:text-cream-200/75">
            PDF for owners and boards; Excel for accountants. Both use the same normalized numbers as the app.
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
      ) : !dash ? (
        <div className="rounded-3xl border border-dashed border-navy-900/20 bg-white p-10 text-center text-sm text-navy-900/70 dark:border-white/15 dark:bg-navy-900/40 dark:text-cream-200/70">
          Nothing to export yet.
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={downloadPdf}
            className="rounded-full bg-navy-900 px-5 py-2.5 text-sm font-semibold text-cream-50 hover:bg-navy-850 dark:bg-gold-400 dark:text-navy-950 dark:hover:bg-gold-300"
          >
            Download PDF executive audit
          </button>
          <button
            type="button"
            onClick={downloadExcel}
            className="rounded-full border border-navy-900/15 bg-white px-5 py-2.5 text-sm font-semibold text-navy-950 hover:bg-cream-100 dark:border-white/10 dark:bg-navy-900 dark:text-cream-50 dark:hover:bg-navy-850"
          >
            Download Excel summary
          </button>
        </div>
      )}
    </div>
  );
}
