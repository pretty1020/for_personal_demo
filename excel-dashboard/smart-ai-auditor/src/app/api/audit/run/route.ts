import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildDashboard } from "@/lib/buildDashboard";
import { runRuleEngine } from "@/lib/rulesEngine";
import { runAiAudit } from "@/lib/openaiAudit";
import type { AuditFinding } from "@/lib/types/audit";

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

  const hourly = dashboard.salesByHour;
  const ruleFindings = runRuleEngine(dashboard, { avgHourlySales, hourly });
  const { aiFindings, actionPlan } = await runAiAudit({ dashboard, ruleFindings });

  const combined: AuditFinding[] = [...ruleFindings, ...aiFindings];

  const admin = createAdminClient();
  await admin.from("audit_findings").delete().eq("business_id", businessId);
  const rows = combined.map((f) => ({
    business_id: businessId,
    severity: f.severity,
    category: f.category,
    title: f.title,
    detail: f.detail,
    estimated_impact_php: f.estimatedImpactPhp,
    recommended_action: f.recommendedAction,
    source: f.source,
  }));
  if (rows.length) {
    const { error } = await admin.from("audit_findings").insert(rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  await admin.from("audit_reports").insert({
    business_id: businessId,
    user_id: user.id,
    report_type: "ai_run",
    payload: { dashboard, actionPlan, findings: combined },
  });

  return NextResponse.json({ findings: combined, actionPlan, dashboard });
}
