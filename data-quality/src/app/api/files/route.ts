import { NextResponse } from "next/server";
import { requireDqAuth } from "@/lib/api-guard";
import { usesJson } from "@/lib/db";
import { mariadbListFiles } from "@/lib/mariadb/repository";
import { readStandalone, standaloneListFilesWithWorkflowName } from "@/lib/standalone/store";

export async function GET(req: Request) {
  const auth = await requireDqAuth(req);
  if ("error" in auth) return auth.error;
  const url = new URL(req.url);
  const workflowId = url.searchParams.get("workflowId");
  const status = url.searchParams.get("status");
  const limit = Math.min(Number(url.searchParams.get("limit") || "50"), 200);
  if (usesJson()) {
    const files = await readStandalone((s) =>
      standaloneListFilesWithWorkflowName(s, { workflowId, status, limit }),
    );
    return NextResponse.json({ files });
  }
  const files = await mariadbListFiles({ workflowId, status, limit });
  return NextResponse.json({ files });
}
