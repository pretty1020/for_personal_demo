import { NextResponse } from "next/server";
import { requireDqAuth } from "@/lib/api-guard";
import { buildDashboardPayload } from "@/lib/dashboard-payload";
import { usesJson } from "@/lib/db";
import { mariadbListFilesForDashboard } from "@/lib/mariadb/repository";
import { readStandalone } from "@/lib/standalone/store";

export async function GET(req: Request) {
  const auth = await requireDqAuth(req);
  if ("error" in auth) return auth.error;

  try {
    const url = new URL(req.url);
    const workflowId = url.searchParams.get("workflowId");
    const status = url.searchParams.get("status");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    if (usesJson()) {
      const body = await readStandalone((s) => {
        let list = [...s.files];
        if (workflowId) list = list.filter((f) => f.workflow_id === workflowId);
        if (status) list = list.filter((f) => f.status === status);
        if (from) list = list.filter((f) => f.created_at >= from);
        if (to) list = list.filter((f) => f.created_at <= to);
        list.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
        list = list.slice(0, 5000);
        const dupAudit = s.audit_logs.filter((a) => a.action === "duplicate_prevented").length;
        const errRows = s.file_errors.map((e) => ({ code: e.code, severity: e.severity }));
        const wfs = s.workflows.map((w) => ({ id: w.id, name: w.name }));
        return buildDashboardPayload({
          files: list,
          duplicatePreventsFromAudit: dupAudit,
          errRows,
          workflows: wfs,
        });
      });
      return NextResponse.json(body);
    }

    const { files, dupAudit, errRows, workflows } = await mariadbListFilesForDashboard({
      workflowId,
      status,
      from,
      to,
    });

    const body = buildDashboardPayload({
      files,
      duplicatePreventsFromAudit: dupAudit,
      errRows,
      workflows,
    });

    return NextResponse.json(body);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Dashboard failed";
    console.error("[api/dashboard]", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
