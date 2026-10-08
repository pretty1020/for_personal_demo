import { NextResponse } from "next/server";
import { requireBackend } from "@/lib/api-guard";
import { usesJson } from "@/lib/db";
import { mariadbListAuditLogs } from "@/lib/mariadb/repository";
import { readStandalone } from "@/lib/standalone/store";
import type { AuditLogRow } from "@/types/database";

export async function GET(req: Request) {
  const blocked = requireBackend();
  if (blocked) return blocked;

  try {
    const url = new URL(req.url);
    const workflowId = url.searchParams.get("workflowId");
    const limit = Math.min(Number(url.searchParams.get("limit") || "100"), 500);
    if (usesJson()) {
      const logs = await readStandalone((s) => {
        let rows = [...s.audit_logs].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
        if (workflowId) rows = rows.filter((a) => a.workflow_id === workflowId);
        return rows.slice(0, limit);
      });
      return NextResponse.json({ logs });
    }
    let logs: AuditLogRow[] = await mariadbListAuditLogs(limit);
    if (workflowId) logs = logs.filter((a) => a.workflow_id === workflowId);
    return NextResponse.json({ logs });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Audit log failed";
    console.error("[api/audit]", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
