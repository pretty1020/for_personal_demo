import { NextResponse } from "next/server";
import { requireBackend } from "@/lib/api-guard";
import { scanWorkflowSources } from "@/lib/services/workflow-scan";

export async function POST(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = requireBackend();
  if (blocked) return blocked;
  const { id: workflowId } = await ctx.params;
  try {
    const result = await scanWorkflowSources(workflowId);
    return NextResponse.json({ ran: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Run failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
