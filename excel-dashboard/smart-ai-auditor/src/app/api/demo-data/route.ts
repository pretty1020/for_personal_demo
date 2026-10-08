import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({ businessId: z.string().uuid() });

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { businessId } = parsed.data;

  const { data: biz, error: bErr } = await supabase
    .from("businesses")
    .select("id")
    .eq("id", businessId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (bErr || !biz) return NextResponse.json({ error: "Business not found" }, { status: 404 });

  const admin = createAdminClient();
  const bid = businessId;

  await admin.from("sales_data").delete().eq("business_id", bid);
  await admin.from("inventory_data").delete().eq("business_id", bid);
  await admin.from("expense_data").delete().eq("business_id", bid);
  await admin.from("staff_data").delete().eq("business_id", bid);

  const days = ["2026-04-28", "2026-04-29", "2026-04-30", "2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04"];
  const items = [
    { name: "Latte", cat: "Beverage", price: 150, cost: 48, q: 40 },
    { name: "Americano", cat: "Beverage", price: 120, cost: 28, q: 55 },
    { name: "Croissant", cat: "Pastry", price: 95, cost: 42, q: 30 },
    { name: "Breakfast Plate", cat: "Food", price: 280, cost: 135, q: 18 },
    { name: "Iced Matcha", cat: "Beverage", price: 165, cost: 55, q: 22 },
  ];

  const salesRows: Record<string, unknown>[] = [];
  for (const d of days) {
    for (let h = 8; h <= 20; h++) {
      const dow = new Date(d + "T12:00:00Z").getUTCDay();
      const slow = dow === 2 && h >= 14 && h <= 17;
      const base = slow ? 0.45 : 1;
      for (const it of items) {
        const qty = Math.max(1, Math.round(it.q * base * (0.7 + Math.random() * 0.6)));
        const line = Math.round(it.price * qty);
        const cost = Math.round(it.cost * qty * (h >= 18 ? 1.08 : 1));
        salesRows.push({
          business_id: bid,
          upload_id: null,
          sale_date: d,
          sale_hour: h,
          item_name: it.name,
          category: it.cat,
          quantity: qty,
          unit_price: it.price,
          line_total: line,
          cost,
        });
      }
    }
  }

  const invRows: Record<string, unknown>[] = items.map((it) => ({
    business_id: bid,
    upload_id: null,
    item_name: it.name,
    sku: null as string | null,
    quantity_on_hand: 80 + Math.round(Math.random() * 40),
    unit_cost: it.cost,
    usage_quantity: 55 + Math.round(Math.random() * 25),
    period_start: days[0],
    period_end: days[days.length - 1],
  }));

  invRows.push({
    business_id: bid,
    upload_id: null,
    item_name: "syrup vanilla",
    sku: "SYR-VAN",
    quantity_on_hand: 24,
    unit_cost: 120,
    usage_quantity: 40,
    period_start: days[0],
    period_end: days[days.length - 1],
  });

  const expRows = [
    { business_id: bid, upload_id: null, expense_date: days[2], category: "Utilities", vendor: "Meralco", description: "Electricity", amount: 18500 },
    { business_id: bid, upload_id: null, expense_date: days[3], category: "Rent", vendor: "Landlord", description: "Monthly rent", amount: 65000 },
    { business_id: bid, upload_id: null, expense_date: days[4], category: "Supplies", vendor: "Metro", description: "Packaging", amount: 4200 },
    { business_id: bid, upload_id: null, expense_date: days[5], category: "Marketing", vendor: "Meta", description: "Ads", amount: 3500 },
  ];

  const staffRows: Record<string, unknown>[] = [];
  for (const d of days) {
    staffRows.push(
      {
        business_id: bid,
        upload_id: null,
        work_date: d,
        employee_name: "A. Cruz",
        hours_worked: 8,
        labor_cost: 960,
        shift_sales: 12000 + Math.round(Math.random() * 4000),
      },
      {
        business_id: bid,
        upload_id: null,
        work_date: d,
        employee_name: "B. Santos",
        hours_worked: 6,
        labor_cost: 720,
        shift_sales: 8000 + Math.round(Math.random() * 2500),
      }
    );
  }

  const ins = async (table: string, rows: Record<string, unknown>[]) => {
    const chunk = 300;
    for (let i = 0; i < rows.length; i += chunk) {
      const { error } = await admin.from(table).insert(rows.slice(i, i + chunk));
      if (error) throw new Error(error.message);
    }
  };

  try {
    await ins("sales_data", salesRows);
    await ins("inventory_data", invRows);
    await ins("expense_data", expRows);
    await ins("staff_data", staffRows);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Demo insert failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
