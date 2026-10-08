import { NextResponse } from "next/server";
import { requireDqAuth } from "@/lib/api-guard";
import { scanWorkflowSources } from "@/lib/services/workflow-scan";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireDqAuth(request);
  if ("error" in auth) return auth.error;
  const { id: workflowId } = await ctx.params;
  try {
    const result = await scanWorkflowSources(workflowId);
    return NextResponse.json({ ran: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Run failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
