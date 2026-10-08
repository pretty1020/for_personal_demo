import { NextResponse } from "next/server";
import { requireDqAuth } from "@/lib/api-guard";
import { getFileDetail } from "@/lib/file-detail";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireDqAuth(request);
  if ("error" in auth) return auth.error;

  const { id } = await ctx.params;
  const payload = await getFileDetail(id);
  if (!payload) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(payload);
}
