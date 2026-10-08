import { NextResponse } from "next/server";
import { requireDqAuth } from "@/lib/api-guard";
import { buildDashboardPayload, filterWorkflowsForDashboard } from "@/lib/dashboard-payload";
import { usesJson } from "@/lib/db";
import { mariadbListFilesForDashboard } from "@/lib/mariadb/repository";
import { readStandalone } from "@/lib/standalone/store";

export async function GET(req: Request) {
  const auth = await requireDqAuth(req);
  if ("error" in auth) return auth.error;

  try {
    const url = new URL(req.url);
    const filters = {
      workflowId: url.searchParams.get("workflowId"),
      status: url.searchParams.get("status"),
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
      client: url.searchParams.get("client"),
      owner: url.searchParams.get("owner"),
    };

    let payload;
    if (usesJson()) {
      payload = await readStandalone((s) => {
        const allWorkflows = s.workflows.map((w) => ({
          id: w.id,
          name: w.name,
          client_name: w.client_name,
          status: w.status,
          pass_rules: w.pass_rules,
        }));
        const scoped = filterWorkflowsForDashboard(allWorkflows, filters);
        const scopedIds = new Set(scoped.map((w) => w.id));
        const hasScope = Boolean(filters.client || filters.owner || filters.workflowId);
        const inScope = (workflowId: string | null) =>
          !hasScope || (Boolean(workflowId) && scopedIds.has(workflowId!));

        const scheduleFiles = [...s.files]
          .filter((f) => inScope(f.workflow_id))
          .map((f) => ({
            id: f.id,
            original_name: f.original_name,
            status: f.status,
            workflow_id: f.workflow_id,
            created_at: f.created_at,
            processed_at: f.processed_at,
            intake_source: f.intake_source,
            metadata: f.metadata,
          }));

        let list = [...s.files].filter((f) => inScope(f.workflow_id));
        if (filters.status) list = list.filter((f) => f.status === filters.status);
        if (filters.from) list = list.filter((f) => f.created_at >= filters.from!);
        if (filters.to) list = list.filter((f) => f.created_at <= filters.to!);

        const metricIds = new Set(list.map((f) => f.id));
        const errRows = s.file_errors
          .filter((e) => {
            const run = s.validation_runs.find((r) => r.id === e.validation_run_id);
            return run ? metricIds.has(run.file_id) : false;
          })
          .map((e) => ({ code: e.code, severity: e.severity }));

        const dupAudit = s.audit_logs.filter(
          (a) =>
            a.action === "duplicate_prevented" &&
            (!hasScope || (a.workflow_id != null && scopedIds.has(a.workflow_id))),
        ).length;

        return buildDashboardPayload({
          files: list,
          scheduleFiles,
          duplicatePreventsFromAudit: dupAudit,
          errRows,
          workflows: hasScope ? scoped : allWorkflows,
          allWorkflows,
        });
      });
    } else {
      const data = await mariadbListFilesForDashboard(filters);
      payload = buildDashboardPayload({
        files: data.files,
        scheduleFiles: data.scheduleFiles,
        duplicatePreventsFromAudit: data.dupAudit,
        errRows: data.errRows,
        workflows: data.workflows,
        allWorkflows: data.allWorkflows,
      });
    }

    const lines = [
      "metric,value",
      `total_files,${payload.metrics.total}`,
      `passed,${payload.metrics.passed}`,
      `failed,${payload.metrics.failed}`,
      `completed_today,${payload.metrics.completedToday}`,
      `schedule_done,${payload.metrics.scheduleDone}`,
      `schedule_not_done,${payload.metrics.scheduleNotDone}`,
      `schedule_delayed,${payload.metrics.scheduleDelayed}`,
      `duplicate_attempts,${payload.metrics.duplicateAttempts}`,
    ];
    return new NextResponse(lines.join("\n"), {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": 'attachment; filename="dashboard-export.csv"',
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Export failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
