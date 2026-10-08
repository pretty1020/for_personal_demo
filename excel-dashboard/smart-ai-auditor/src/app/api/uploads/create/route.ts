import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  businessId: z.string().uuid(),
  fileType: z.enum(["sales", "inventory", "expense", "staff"]),
  storagePath: z.string().min(3),
  originalName: z.string().optional(),
});

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
  const { businessId, fileType, storagePath, originalName } = parsed.data;

  const { data: biz, error: bErr } = await supabase
    .from("businesses")
    .select("id")
    .eq("id", businessId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (bErr || !biz) return NextResponse.json({ error: "Business not found" }, { status: 404 });

  const { data, error } = await supabase
    .from("uploads")
    .insert({
      business_id: businessId,
      user_id: user.id,
      file_type: fileType,
      storage_path: storagePath,
      original_name: originalName || null,
      status: "pending",
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ upload: data });
}
