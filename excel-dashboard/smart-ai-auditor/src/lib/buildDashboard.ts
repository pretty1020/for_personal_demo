import type { DashboardPayload, KpiSummary } from "@/lib/types/audit";
import { computeProfitLeakScore } from "@/lib/rulesEngine";

type SaleRow = {
  sale_date: string | null;
  sale_hour: number | null;
  item_name: string | null;
  category: string | null;
  quantity: number | null;
  line_total: number | null;
  cost: number | null;
};

type InvRow = {
  item_name: string | null;
  usage_quantity: number | null;
  quantity_on_hand: number | null;
};

type ExpRow = { expense_date: string | null; category: string | null; amount: number | null };

type StaffRow = {
  work_date: string | null;
  hours_worked: number | null;
  labor_cost: number | null;
};

function sum(nums: number[]) {
  return nums.reduce((a, b) => a + b, 0);
}

function normItem(s: string | null | undefined) {
  return (s || "").trim().toLowerCase();
}

export async function buildDashboard(
  fetchers: {
    sales: () => Promise<SaleRow[]>;
    inventory: () => Promise<InvRow[]>;
    expenses: () => Promise<ExpRow[]>;
    staff: () => Promise<StaffRow[]>;
  }
): Promise<{
  dashboard: DashboardPayload;
  avgHourlySales: number;
}> {
  const [sales, inventory, expenses, staff] = await Promise.all([
    fetchers.sales(),
    fetchers.inventory(),
    fetchers.expenses(),
    fetchers.staff(),
  ]);

  const missing = {
    sales: sales.length === 0,
    inventory: inventory.length === 0,
    expenses: expenses.length === 0,
    staff: staff.length === 0,
  };

  const totalSales = sum(
    sales.map((s) => Number(s.line_total) || 0).filter((n) => Number.isFinite(n))
  );
  const totalCogs = sum(
    sales.map((s) => Number(s.cost) || 0).filter((n) => Number.isFinite(n))
  );
  const grossProfit = totalSales - totalCogs;
  const foodCostPct = totalSales > 0 ? (totalCogs / totalSales) * 100 : null;

  const totalLaborCost = sum(
    staff.map((s) => Number(s.labor_cost) || 0).filter((n) => Number.isFinite(n))
  );
  const laborCostPct = totalSales > 0 ? totalLaborCost / totalSales : null;

  const totalExpenses = sum(
    expenses.map((e) => Number(e.amount) || 0).filter((n) => Number.isFinite(n))
  );
  const expenseRatio = totalSales > 0 ? totalExpenses / totalSales : null;

  const byDay = new Map<string, number>();
  for (const s of sales) {
    const d = s.sale_date;
    if (!d) continue;
    byDay.set(d, (byDay.get(d) || 0) + (Number(s.line_total) || 0));
  }
  const salesByDay = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, total]) => ({ date, total }));

  const byHour = new Map<number, number>();
  for (const s of sales) {
    const h = s.sale_hour;
    if (h === null || h === undefined) continue;
    byHour.set(h, (byHour.get(h) || 0) + (Number(s.line_total) || 0));
  }
  const salesByHour = [...byHour.entries()]
    .sort(([a], [b]) => a - b)
    .map(([hour, total]) => ({ hour, total }));

  const hourTotals = salesByHour.map((x) => x.total);
  const avgHourlySales =
    hourTotals.length > 0 ? hourTotals.reduce((a, b) => a + b, 0) / hourTotals.length : 0;
  const deadHoursCount = salesByHour.filter(
    (x) => avgHourlySales > 0 && x.total < avgHourlySales * 0.45
  ).length;

  const itemRev = new Map<string, { rev: number; cost: number; qty: number }>();
  for (const s of sales) {
    const key = normItem(s.item_name) || "unknown";
    const cur = itemRev.get(key) || { rev: 0, cost: 0, qty: 0 };
    cur.rev += Number(s.line_total) || 0;
    cur.cost += Number(s.cost) || 0;
    cur.qty += Number(s.quantity) || 0;
    itemRev.set(key, cur);
  }
  const topItemsRevenue = [...itemRev.entries()]
    .map(([item, v]) => ({ item, total: v.rev }))
    .filter((x) => x.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)
    .map(({ item, total }) => ({ item, total }));

  const topItemsProfit = [...itemRev.entries()]
    .map(([item, v]) => ({ item, profit: v.rev - v.cost }))
    .filter((x) => x.profit !== 0)
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 8);

  const lowMarginItems = [...itemRev.entries()]
    .map(([item, v]) => {
      const marginPct = v.rev > 0 ? ((v.rev - v.cost) / v.rev) * 100 : 0;
      return { item, marginPct, revenue: v.rev };
    })
    .filter((x) => x.revenue > 0 && x.marginPct < 42)
    .sort((a, b) => a.marginPct - b.marginPct)
    .slice(0, 8);

  const usageByItem = new Map<string, number>();
  for (const inv of inventory) {
    const k = normItem(inv.item_name);
    if (!k) continue;
    usageByItem.set(k, (usageByItem.get(k) || 0) + (Number(inv.usage_quantity) || 0));
  }
  const inventoryVsSales = [...usageByItem.entries()]
    .map(([item, usage]) => ({
      item,
      usage,
      salesQty: itemRev.get(item)?.qty || 0,
    }))
    .filter((x) => x.usage > 0 || x.salesQty > 0)
    .sort((a, b) => b.usage - a.usage)
    .slice(0, 10);

  const expByCat = new Map<string, number>();
  for (const e of expenses) {
    const c = normItem(e.category) || "general";
    expByCat.set(c, (expByCat.get(c) || 0) + (Number(e.amount) || 0));
  }
  const expenseBreakdown = [...expByCat.entries()]
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  const laborByDay = new Map<string, { labor: number; hours: number }>();
  for (const st of staff) {
    const d = st.work_date;
    if (!d) continue;
    const cur = laborByDay.get(d) || { labor: 0, hours: 0 };
    cur.labor += Number(st.labor_cost) || 0;
    cur.hours += Number(st.hours_worked) || 0;
    laborByDay.set(d, cur);
  }
  const laborTrend = [...laborByDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, labor: v.labor, hours: v.hours }));

  const invOnHand = inventory.reduce((a, i) => a + (Number(i.quantity_on_hand) || 0), 0);
  const invUsage = inventory.reduce((a, i) => a + (Number(i.usage_quantity) || 0), 0);
  const wasteRiskScore = Math.min(
    100,
    Math.round(
      (invOnHand > 0 && invUsage > 0 ? (invOnHand / invUsage) * 18 : 0) +
        (foodCostPct !== null && foodCostPct > 34 ? foodCostPct - 34 : 0) * 1.2
    )
  );

  const kpis: KpiSummary = {
    totalSales,
    totalCogs,
    grossProfit,
    foodCostPct,
    totalLaborCost,
    laborCostPct,
    totalExpenses,
    expenseRatio,
    wasteRiskScore,
    profitLeakScore: 0,
    deadHoursCount,
    lowMarginItemCount: lowMarginItems.length,
    daysWithSales: byDay.size,
    missing,
  };
  kpis.profitLeakScore = computeProfitLeakScore(kpis, deadHoursCount);

  const dashboard: DashboardPayload = {
    kpis,
    salesByDay,
    salesByHour,
    topItemsRevenue,
    topItemsProfit,
    lowMarginItems,
    inventoryVsSales,
    expenseBreakdown,
    laborTrend,
  };

  return { dashboard, avgHourlySales };
}
