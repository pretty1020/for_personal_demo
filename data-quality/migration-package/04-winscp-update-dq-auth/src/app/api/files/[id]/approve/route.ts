import { NextResponse } from "next/server";
import { requireDqAuth } from "@/lib/api-guard";
import { approveAndProcessFile } from "@/lib/services/file-process";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireDqAuth(request);
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;
  try {
    await approveAndProcessFile(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
