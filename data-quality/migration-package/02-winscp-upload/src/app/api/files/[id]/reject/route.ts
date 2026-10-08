import { NextResponse } from "next/server";
import { requireBackend } from "@/lib/api-guard";
import { rejectFile } from "@/lib/services/file-process";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = requireBackend();
  if (blocked) return blocked;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason : undefined;
  try {
    await rejectFile(id, reason);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
