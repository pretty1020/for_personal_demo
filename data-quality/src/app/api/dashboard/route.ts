import { NextResponse } from "next/server";
import { requireDqAuth } from "@/lib/api-guard";
import {
  buildDashboardPayload,
  filterWorkflowsForDashboard,
  type DashboardFileRow,
  type DashboardWorkflowRow,
} from "@/lib/dashboard-payload";
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

    if (usesJson()) {
      const body = await readStandalone((s) => {
        const allWorkflows: DashboardWorkflowRow[] = s.workflows.map((w) => ({
          id: w.id,
          name: w.name,
          client_name: w.client_name,
          status: w.status,
          pass_rules: w.pass_rules,
        }));

        const scoped = filterWorkflowsForDashboard(allWorkflows, {
          client: filters.client,
          owner: filters.owner,
          workflowId: filters.workflowId,
        });
        const scopedIds = new Set(scoped.map((w) => w.id));
        const hasScope = Boolean(filters.client || filters.owner || filters.workflowId);

        const inScope = (workflowId: string | null) =>
          !hasScope || (Boolean(workflowId) && scopedIds.has(workflowId!));

        const scheduleFiles: DashboardFileRow[] = [...s.files]
          .filter((f) => inScope(f.workflow_id))
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
          .slice(0, 8000)
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
        list.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
        list = list.slice(0, 5000);

        const metricIds = new Set(list.map((f) => f.id));
        const errRows = s.file_errors
          .filter((e) => {
            const run = s.validation_runs.find((r) => r.id === e.validation_run_id);
            return run ? metricIds.has(run.file_id) : false;
          })
          .map((e) => ({ code: e.code, severity: e.severity }));

        const labelByKey = new Map(
          s.checklist_items.map((it) => [`${it.workflow_id}::${it.item_key}`, it] as const),
        );
        const ruleCheckRows = s.checklist_results
          .filter((r) => metricIds.has(r.file_id))
          .slice(0, 2000)
          .map((r) => {
            const file = s.files.find((f) => f.id === r.file_id);
            const wf = file?.workflow_id
              ? s.workflows.find((w) => w.id === file.workflow_id)
              : undefined;
            const def = file?.workflow_id
              ? labelByKey.get(`${file.workflow_id}::${r.item_key}`)
              : undefined;
            return {
              itemKey: r.item_key,
              label: def?.label || r.item_key,
              isCritical: def ? Boolean(def.is_critical) : true,
              workflowId: file?.workflow_id ?? null,
              workflowName: wf?.name ?? null,
              clientName: wf?.client_name?.trim() || null,
              fileId: r.file_id,
              fileName: file?.original_name || "—",
              passed: Boolean(r.passed),
              acknowledged: Boolean(r.acknowledged),
              checkedAt: file?.created_at || r.validation_run_id,
            };
          });

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
          ruleCheckRows,
          workflows: hasScope ? scoped : allWorkflows,
          allWorkflows,
        });
      });
      return NextResponse.json(body);
    }

    const { files, scheduleFiles, dupAudit, errRows, ruleCheckRows, workflows, allWorkflows } =
      await mariadbListFilesForDashboard(filters);

    const body = buildDashboardPayload({
      files,
      scheduleFiles,
      duplicatePreventsFromAudit: dupAudit,
      errRows,
      ruleCheckRows,
      workflows,
      allWorkflows,
    });

    return NextResponse.json(body);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Dashboard failed";
    console.error("[api/dashboard]", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
