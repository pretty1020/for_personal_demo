import type { FileType } from "@/lib/types/audit";
import { cellNum, col, parseDate, type ParsedTable } from "@/lib/parseUpload";

export function rowsForSales(parsed: ParsedTable, businessId: string, uploadId: string) {
  const { headers, rows, mapping } = parsed;
  const m = mapping as Record<string, number | null>;
  return rows
    .map((row) => {
      const qty = cellNum(col(row, headers, m.quantity));
      const price = cellNum(col(row, headers, m.unit_price));
      let total = cellNum(col(row, headers, m.line_total));
      if (total === null && qty !== null && price !== null) total = qty * price;
      const cost = cellNum(col(row, headers, m.cost));
      const d = parseDate(col(row, headers, m.date));
      const hourRaw = col(row, headers, m.hour);
      let saleHour: number | null = null;
      if (hourRaw !== null && hourRaw !== undefined && hourRaw !== "") {
        const n = cellNum(hourRaw);
        if (n !== null) saleHour = Math.max(0, Math.min(23, Math.floor(n)));
        else {
          const s = String(hourRaw);
          const mt = s.match(/(\d{1,2}):?(\d{2})?/);
          if (mt) saleHour = Math.min(23, parseInt(mt[1], 10));
        }
      }
      const item = col(row, headers, m.item);
      const cat = col(row, headers, m.category);
      return {
        business_id: businessId,
        upload_id: uploadId,
        sale_date: d,
        sale_hour: saleHour,
        item_name: item ? String(item) : null,
        category: cat ? String(cat) : null,
        quantity: qty,
        unit_price: price,
        line_total: total,
        cost,
        metadata: {},
      };
    })
    .filter((r) => r.sale_date || r.line_total !== null || r.item_name);
}

export function rowsForInventory(parsed: ParsedTable, businessId: string, uploadId: string) {
  const { headers, rows, mapping } = parsed;
  const m = mapping as Record<string, number | null>;
  return rows.map((row) => ({
    business_id: businessId,
    upload_id: uploadId,
    item_name: col(row, headers, m.item) ? String(col(row, headers, m.item)) : null,
    sku: col(row, headers, m.sku) ? String(col(row, headers, m.sku)) : null,
    quantity_on_hand: cellNum(col(row, headers, m.qty_on_hand)),
    unit_cost: cellNum(col(row, headers, m.cost)),
    usage_quantity: cellNum(col(row, headers, m.usage)),
    period_start: parseDate(col(row, headers, m.period_start)),
    period_end: parseDate(col(row, headers, m.period_end)),
    metadata: {},
  }));
}

export function rowsForExpense(parsed: ParsedTable, businessId: string, uploadId: string) {
  const { headers, rows, mapping } = parsed;
  const m = mapping as Record<string, number | null>;
  return rows
    .map((row) => ({
      business_id: businessId,
      upload_id: uploadId,
      expense_date: parseDate(col(row, headers, m.date)),
      category: col(row, headers, m.category) ? String(col(row, headers, m.category)) : null,
      vendor: col(row, headers, m.vendor) ? String(col(row, headers, m.vendor)) : null,
      description: col(row, headers, m.description)
        ? String(col(row, headers, m.description))
        : null,
      amount: cellNum(col(row, headers, m.amount)),
      metadata: {},
    }))
    .filter((r) => r.amount !== null || r.expense_date);
}

export function rowsForStaff(parsed: ParsedTable, businessId: string, uploadId: string) {
  const { headers, rows, mapping } = parsed;
  const m = mapping as Record<string, number | null>;
  return rows
    .map((row) => ({
      business_id: businessId,
      upload_id: uploadId,
      work_date: parseDate(col(row, headers, m.date)),
      employee_name: col(row, headers, m.employee) ? String(col(row, headers, m.employee)) : null,
      hours_worked: cellNum(col(row, headers, m.hours_worked)),
      labor_cost: cellNum(col(row, headers, m.labor_cost)),
      shift_sales: cellNum(col(row, headers, m.shift_sales)),
      metadata: {},
    }))
    .filter((r) => r.work_date || r.hours_worked !== null || r.labor_cost !== null);
}

export function assertRequiredColumns(fileType: FileType, mapping: Record<string, number | null>) {
  if (fileType === "sales") {
    if (mapping.date === null && mapping.item === null)
      throw new Error("Sales file needs at least a recognizable date or item column.");
  }
  if (fileType === "expense") {
    if (mapping.amount === null)
      throw new Error("Expense file needs an amount column (e.g. Amount, Total).");
  }
}
