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
  await admin.from("audit_findings").delete().eq("business_id", businessId);
  await admin.from("audit_reports").delete().eq("business_id", businessId);
  await admin.from("sales_data").delete().eq("business_id", businessId);
  await admin.from("inventory_data").delete().eq("business_id", businessId);
  await admin.from("expense_data").delete().eq("business_id", businessId);
  await admin.from("staff_data").delete().eq("business_id", businessId);
  await admin.from("uploads").delete().eq("business_id", businessId);

  return NextResponse.json({ ok: true });
}
