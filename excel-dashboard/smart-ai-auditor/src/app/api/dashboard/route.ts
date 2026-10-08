import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildDashboard } from "@/lib/buildDashboard";

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const businessId = url.searchParams.get("businessId");
  if (!businessId) return NextResponse.json({ error: "businessId required" }, { status: 400 });

  const { data: biz, error: bErr } = await supabase
    .from("businesses")
    .select("id")
    .eq("id", businessId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (bErr || !biz) return NextResponse.json({ error: "Business not found" }, { status: 404 });

  const lim = 25000;
  const { dashboard, avgHourlySales } = await buildDashboard({
    sales: async () => {
      const { data } = await supabase
        .from("sales_data")
        .select("sale_date,sale_hour,item_name,category,quantity,line_total,cost")
        .eq("business_id", businessId)
        .limit(lim);
      return data || [];
    },
    inventory: async () => {
      const { data } = await supabase
        .from("inventory_data")
        .select("item_name,usage_quantity,quantity_on_hand")
        .eq("business_id", businessId)
        .limit(lim);
      return data || [];
    },
    expenses: async () => {
      const { data } = await supabase
        .from("expense_data")
        .select("expense_date,category,amount")
        .eq("business_id", businessId)
        .limit(lim);
      return data || [];
    },
    staff: async () => {
      const { data } = await supabase
        .from("staff_data")
        .select("work_date,hours_worked,labor_cost")
        .eq("business_id", businessId)
        .limit(lim);
      return data || [];
    },
  });

  return NextResponse.json({ dashboard, avgHourlySales });
}
