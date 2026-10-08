import { NextResponse } from "next/server";
import { requireBackend } from "@/lib/api-guard";
import { getFileDetail } from "@/lib/file-detail";

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = requireBackend();
  if (blocked) return blocked;

  const { id } = await ctx.params;
  const payload = await getFileDetail(id);
  if (!payload) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(payload);
}
