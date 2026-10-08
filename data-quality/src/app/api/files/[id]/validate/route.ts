import { NextResponse } from "next/server";
import { requireDqAuth } from "@/lib/api-guard";
import { scheduleValidationJob } from "@/lib/jobs/queue";
import { runValidationForFile } from "@/lib/services/validation-service";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireDqAuth(request);
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;
  scheduleValidationJob(id, runValidationForFile);
  return NextResponse.json({ queued: true });
}
