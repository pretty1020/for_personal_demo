export type FileType = "sales" | "inventory" | "expense" | "staff";

export type Severity = "High" | "Medium" | "Low";

export type FindingCategory = "Sales" | "Inventory" | "Labor" | "Expense" | "Menu";

export type FindingSource = "rule" | "ai";

export interface AuditFinding {
  id: string;
  severity: Severity;
  category: FindingCategory;
  title: string;
  detail: string;
  estimatedImpactPhp: number | null;
  recommendedAction: string;
  source: FindingSource;
}

export interface KpiSummary {
  totalSales: number;
  totalCogs: number;
  grossProfit: number;
  foodCostPct: number | null;
  totalLaborCost: number;
  laborCostPct: number | null;
  totalExpenses: number;
  expenseRatio: number | null;
  wasteRiskScore: number;
  profitLeakScore: number;
  deadHoursCount: number;
  lowMarginItemCount: number;
  daysWithSales: number;
  missing: {
    sales: boolean;
    inventory: boolean;
    expenses: boolean;
    staff: boolean;
  };
}

export interface DashboardPayload {
  kpis: KpiSummary;
  salesByDay: { date: string; total: number }[];
  salesByHour: { hour: number; total: number }[];
  topItemsRevenue: { item: string; total: number }[];
  topItemsProfit: { item: string; profit: number }[];
  lowMarginItems: { item: string; marginPct: number; revenue: number }[];
  inventoryVsSales: { item: string; usage: number; salesQty: number }[];
  expenseBreakdown: { category: string; total: number }[];
  laborTrend: { date: string; labor: number; hours: number }[];
}

export interface ActionPlanDay {
  day: number;
  focus: string;
  tasks: string[];
}

export interface ActionPlanPayload {
  sevenDayPlan: ActionPlanDay[];
  pricing: string[];
  promos: string[];
  staffing: string[];
  inventory: string[];
  menu: string[];
}
