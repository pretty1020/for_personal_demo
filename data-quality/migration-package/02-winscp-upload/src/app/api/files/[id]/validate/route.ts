import { NextResponse } from "next/server";
import { requireBackend } from "@/lib/api-guard";
import { scheduleValidationJob } from "@/lib/jobs/queue";
import { runValidationForFile } from "@/lib/services/validation-service";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = requireBackend();
  if (blocked) return blocked;
  const { id } = await ctx.params;
  scheduleValidationJob(id, runValidationForFile);
  return NextResponse.json({ queued: true });
}
