import type { AuditFinding, DashboardPayload, KpiSummary } from "@/lib/types/audit";
import { newId } from "@/lib/newId";

function money(n: number) {
  return Math.round(n * 100) / 100;
}

export function runRuleEngine(
  dash: DashboardPayload,
  extras: { avgHourlySales: number; hourly: { hour: number; total: number }[] }
): AuditFinding[] {
  const { kpis } = dash;
  const out: AuditFinding[] = [];

  if (kpis.missing.sales) {
    out.push({
      id: newId("f"),
      severity: "High",
      category: "Sales",
      title: "No sales data uploaded",
      detail:
        "Profit and menu insights need at least one sales report. Upload a CSV or XLSX export from your POS.",
      estimatedImpactPhp: null,
      recommendedAction: "Upload a sales report covering the same period as expenses and labor.",
      source: "rule",
    });
  }

  if (kpis.totalSales > 0 && kpis.foodCostPct !== null && kpis.foodCostPct > 38) {
    const est = money(kpis.totalSales * ((kpis.foodCostPct - 32) / 100));
    out.push({
      id: newId("f"),
      severity: "High",
      category: "Menu",
      title: "Food cost percentage looks elevated",
      detail: `Estimated food cost is ${kpis.foodCostPct.toFixed(1)}% of sales. Many cafes aim near 28–35% depending on concept.`,
      estimatedImpactPhp: est > 0 ? est : null,
      recommendedAction:
        "Review recipes, trim waste, rebalance modifiers, and verify supplier pricing against yields.",
      source: "rule",
    });
  }

  if (kpis.totalSales > 0 && kpis.expenseRatio !== null && kpis.expenseRatio > 0.22) {
    const est = money(kpis.totalSales * (kpis.expenseRatio - 0.18));
    out.push({
      id: newId("f"),
      severity: "Medium",
      category: "Expense",
      title: "Operating expenses are high versus sales",
      detail: `Expenses are about ${(kpis.expenseRatio * 100).toFixed(1)}% of sales in the uploaded window.`,
      estimatedImpactPhp: est > 0 ? est : null,
      recommendedAction:
        "List top five vendors by spend, cancel unused subscriptions, and renegotiate utilities or rent where possible.",
      source: "rule",
    });
  }

  if (kpis.totalSales > 0 && kpis.laborCostPct !== null && kpis.laborCostPct > 0.38) {
    out.push({
      id: newId("f"),
      severity: "Medium",
      category: "Labor",
      title: "Labor cost is elevated relative to sales",
      detail: `Labor is about ${(kpis.laborCostPct * 100).toFixed(1)}% of sales based on uploaded staff and sales files.`,
      estimatedImpactPhp: money(kpis.totalSales * (kpis.laborCostPct - 0.32)),
      recommendedAction:
        "Match schedules to hourly sales, cut overlapping roles during dead hours, and track sales per labor hour weekly.",
      source: "rule",
    });
  }

  if (extras.avgHourlySales > 0 && kpis.deadHoursCount > 0) {
    out.push({
      id: newId("f"),
      severity: "Low",
      category: "Sales",
      title: "Dead hours detected",
      detail: `${kpis.deadHoursCount} hour buckets are materially below your average hourly sales.`,
      estimatedImpactPhp: null,
      recommendedAction:
        "Bundle promos, shift prep, or training into slow blocks; consider closing a half-day if fixed costs allow.",
      source: "rule",
    });
  }

  if (dash.lowMarginItems.length > 0) {
    const top = dash.lowMarginItems[0];
    out.push({
      id: newId("f"),
      severity: "Medium",
      category: "Menu",
      title: "Low-margin menu items identified",
      detail: `Example: ${top.item} shows about ${top.marginPct.toFixed(1)}% margin on uploaded COGS.`,
      estimatedImpactPhp: money(top.revenue * 0.05),
      recommendedAction:
        "Increase price slightly, reduce garnish cost, or pair with a high-margin drink.",
      source: "rule",
    });
  }

  if (dash.inventoryVsSales.length > 0) {
    const gap = dash.inventoryVsSales.find((r) => r.usage > r.salesQty * 1.25 && r.usage > 5);
    if (gap) {
      out.push({
        id: newId("f"),
        severity: "High",
        category: "Inventory",
        title: "Ingredient usage higher than sales volume suggests",
        detail: `For ${gap.item}, usage is ${gap.usage} versus sales quantity ${gap.salesQty} in the matched window.`,
        estimatedImpactPhp: null,
        recommendedAction:
          "Check spoilage, over-portioning, unrecorded comps, and theft; tighten issuing and nightly counts.",
        source: "rule",
      });
    }
  }

  if (kpis.wasteRiskScore >= 65) {
    out.push({
      id: newId("f"),
      severity: "Medium",
      category: "Inventory",
      title: "Waste risk score is high",
      detail: "Variance between inventory movement and sales patterns increased the composite waste risk.",
      estimatedImpactPhp: money(kpis.totalSales * 0.03),
      recommendedAction: "Implement FIFO labels, prep sheets, and a simple spoilage log for two weeks.",
      source: "rule",
    });
  }

  if (dash.topItemsRevenue[0] && dash.topItemsProfit[0]) {
    const bestRev = dash.topItemsRevenue[0].item;
    const bestProfit = dash.topItemsProfit[0].item;
    if (bestRev !== bestProfit) {
      out.push({
        id: newId("f"),
        severity: "Low",
        category: "Menu",
        title: "Best seller is not the most profitable item",
        detail: `Top by revenue: ${bestRev}. Top by gross profit: ${bestProfit}.`,
        estimatedImpactPhp: null,
        recommendedAction:
          "Train upsells toward the profitable item and test a combo that lifts attach rate.",
        source: "rule",
      });
    }
  }

  return out;
}

export function computeProfitLeakScore(kpis: KpiSummary, deadHours: number): number {
  let score = 20;
  if (kpis.foodCostPct !== null) score += Math.min(30, Math.max(0, kpis.foodCostPct - 28));
  if (kpis.expenseRatio !== null) score += Math.min(25, Math.max(0, (kpis.expenseRatio - 0.15) * 100));
  if (kpis.laborCostPct !== null) score += Math.min(25, Math.max(0, (kpis.laborCostPct - 0.28) * 80));
  score += Math.min(15, deadHours * 2);
  return Math.max(0, Math.min(100, Math.round(score)));
}
