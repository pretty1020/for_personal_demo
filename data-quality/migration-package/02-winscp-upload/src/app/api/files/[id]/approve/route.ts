import { NextResponse } from "next/server";
import { requireBackend } from "@/lib/api-guard";
import { approveAndProcessFile } from "@/lib/services/file-process";

export async function POST(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = requireBackend();
  if (blocked) return blocked;
  const { id } = await ctx.params;
  try {
    await approveAndProcessFile(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
