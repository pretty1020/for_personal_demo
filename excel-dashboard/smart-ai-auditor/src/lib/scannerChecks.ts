import type { KpiSummary } from "@/lib/types/audit";

export interface ScannerRow {
  id: string;
  label: string;
  status: "fail" | "warn" | "pass" | "na";
  detail: string;
}

export function buildScannerRows(k: KpiSummary): ScannerRow[] {
  const rows: ScannerRow[] = [
    {
      id: "food_cost",
      label: "Food cost too high",
      status:
        k.foodCostPct === null ? "na" : k.foodCostPct > 38 ? "fail" : k.foodCostPct > 34 ? "warn" : "pass",
      detail:
        k.foodCostPct === null
          ? "Upload sales with COGS/food cost columns to score this."
          : `${k.foodCostPct.toFixed(1)}% of sales`,
    },
    {
      id: "expense_ratio",
      label: "Expenses vs sales",
      status:
        k.expenseRatio === null ? "na" : k.expenseRatio > 0.25 ? "fail" : k.expenseRatio > 0.2 ? "warn" : "pass",
      detail:
        k.expenseRatio === null
          ? "Upload expenses to compare against sales."
          : `${(k.expenseRatio * 100).toFixed(1)}% of sales`,
    },
    {
      id: "labor_ratio",
      label: "Labor vs sales",
      status:
        k.laborCostPct === null ? "na" : k.laborCostPct > 0.42 ? "fail" : k.laborCostPct > 0.34 ? "warn" : "pass",
      detail:
        k.laborCostPct === null
          ? "Upload staff cost and sales to score labor efficiency."
          : `${(k.laborCostPct * 100).toFixed(1)}% of sales`,
    },
    {
      id: "dead_hours",
      label: "Dead hours",
      status: k.deadHoursCount > 4 ? "fail" : k.deadHoursCount > 0 ? "warn" : "pass",
      detail: `${k.deadHoursCount} weak hour buckets vs your average`,
    },
    {
      id: "low_margin",
      label: "Low-margin best sellers",
      status: k.lowMarginItemCount > 3 ? "warn" : k.lowMarginItemCount > 0 ? "warn" : "pass",
      detail: `${k.lowMarginItemCount} items flagged with margin under 42%`,
    },
    {
      id: "waste_risk",
      label: "Waste / variance risk",
      status: k.wasteRiskScore >= 70 ? "fail" : k.wasteRiskScore >= 45 ? "warn" : "pass",
      detail: `Composite waste risk score: ${k.wasteRiskScore}/100`,
    },
    {
      id: "sales_per_employee",
      label: "Sales coverage vs labor hours",
      status:
        k.totalSales <= 0 || k.totalLaborCost <= 0
          ? "na"
          : k.totalSales / (k.totalLaborCost || 1) < 2.5
            ? "warn"
            : "pass",
      detail:
        k.totalSales <= 0
          ? "Needs sales + labor uploads."
          : `Sales ₱${Math.round(k.totalSales)} vs labor ₱${Math.round(k.totalLaborCost)}`,
    },
  ];
  return rows;
}
