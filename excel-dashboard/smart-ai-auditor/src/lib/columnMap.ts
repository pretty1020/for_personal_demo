import type { FileType } from "@/lib/types/audit";

type Role =
  | "date"
  | "hour"
  | "item"
  | "category"
  | "quantity"
  | "unit_price"
  | "line_total"
  | "cost"
  | "sku"
  | "qty_on_hand"
  | "usage"
  | "period_start"
  | "period_end"
  | "vendor"
  | "description"
  | "amount"
  | "employee"
  | "hours_worked"
  | "labor_cost"
  | "shift_sales";

const KEYWORDS: Record<Role, string[]> = {
  date: ["date", "day", "order_date", "txn", "transaction", "sale_date", "work_date", "expense_date"],
  hour: ["hour", "hr", "time_hour", "sales_hour"],
  item: ["item", "product", "menu", "sku_name", "name", "dish", "article"],
  category: ["category", "type", "class", "group", "dept"],
  quantity: ["qty", "quantity", "units", "count", "sold"],
  unit_price: ["unit_price", "price", "rate", "sell_price"],
  line_total: ["total", "amount", "line_total", "gross", "sales", "revenue", "net_sales", "subtotal"],
  cost: ["cost", "cogs", "food_cost", "unit_cost_line", "ingredient_cost"],
  sku: ["sku", "code", "plu"],
  qty_on_hand: ["on_hand", "stock", "qty_on_hand", "quantity_on_hand", "balance"],
  usage: ["usage", "consumed", "used", "movement", "variance"],
  period_start: ["period_start", "from", "start_date"],
  period_end: ["period_end", "to", "end_date"],
  vendor: ["vendor", "supplier", "payee"],
  description: ["description", "memo", "notes", "details"],
  amount: ["amount", "value", "expense", "total", "cost"],
  employee: ["employee", "staff", "crew", "worker", "team_member"],
  hours_worked: ["hours", "hours_worked", "shift_hours", "time"],
  labor_cost: ["labor", "wage", "payroll", "cost"],
  shift_sales: ["shift_sales", "sales_per_shift", "covers_sales"],
};

function norm(h: string) {
  return h
    .toLowerCase()
    .replace(/[^\w]+/g, "_")
    .replace(/^_|_$/g, "");
}

function scoreHeader(header: string, role: Role): number {
  const n = norm(header);
  if (!n) return 0;
  const words = KEYWORDS[role];
  let s = 0;
  for (const w of words) {
    if (n === w) s += 10;
    else if (n.includes(w)) s += 5;
  }
  return s;
}

export function pickBestColumn(
  headers: string[],
  role: Role,
  used: Set<number>
): number | null {
  let bestIdx: number | null = null;
  let bestScore = 0;
  headers.forEach((h, i) => {
    if (used.has(i)) return;
    const s = scoreHeader(h, role);
    if (s > bestScore) {
      bestScore = s;
      bestIdx = i;
    }
  });
  return bestScore >= 5 ? bestIdx : null;
}

export function detectMapping(
  headers: string[],
  fileType: FileType
): Record<string, number | null> {
  const used = new Set<number>();
  const take = (role: Role) => {
    const i = pickBestColumn(headers, role, used);
    if (i !== null) used.add(i);
    return i;
  };

  if (fileType === "sales") {
    let lineTotal = take("line_total");
    if (lineTotal === null) {
      lineTotal = pickBestColumn(headers, "line_total", used);
      if (lineTotal !== null) used.add(lineTotal);
    }
    return {
      date: take("date"),
      hour: take("hour"),
      item: take("item"),
      category: take("category"),
      quantity: take("quantity"),
      unit_price: take("unit_price"),
      line_total: lineTotal,
      cost: take("cost"),
    };
  }
  if (fileType === "inventory") {
    return {
      item: take("item"),
      sku: take("sku"),
      qty_on_hand: take("qty_on_hand"),
      cost: take("cost"),
      usage: take("usage"),
      period_start: take("period_start"),
      period_end: take("period_end"),
    };
  }
  if (fileType === "expense") {
    return {
      date: take("date"),
      category: take("category"),
      vendor: take("vendor"),
      description: take("description"),
      amount: take("amount"),
    };
  }
  return {
    date: take("date"),
    employee: take("employee"),
    hours_worked: take("hours_worked"),
    labor_cost: take("labor_cost"),
    shift_sales: take("shift_sales"),
  };
}
