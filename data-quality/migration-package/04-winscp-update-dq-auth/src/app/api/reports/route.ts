import { NextResponse } from "next/server";
import { requireDqAuth } from "@/lib/api-guard";
import { usesJson } from "@/lib/db";
import { summarizeChecklistResults } from "@/lib/checklist-eval";
import { mariadbGetReportsPayload } from "@/lib/mariadb/repository";
import { readStandalone } from "@/lib/standalone/store";
import { formatFileStatus } from "@/components/status-badge";
import { summarizeBlockingReasons } from "@/lib/reports/failure-reasons";

const FAILED_STATUSES = ["blocked", "rejected", "duplicate_blocked"] as const;

function mapRunsFromStore(
  s: {
    validation_runs: { id: string; file_id: string; passed: boolean; started_at: string }[];
    files: {
      id: string;
      original_name: string;
      workflow_id: string | null;
      status: string;
      metadata?: Record<string, unknown>;
      processed_at: string | null;
      created_at: string;
    }[];
    file_errors: {
      validation_run_id: string;
      code: string;
      message: string;
      severity: string;
    }[];
    checklist_items: { workflow_id: string; item_key: string; label: string; is_critical: boolean }[];
    checklist_results: {
      file_id: string;
      validation_run_id: string;
      item_key: string;
      passed: boolean;
      acknowledged: boolean;
    }[];
  },
  workflowId: string | null,
  limit: number,
) {
  const list = [...s.validation_runs]
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
    .slice(0, limit)
    .map((r) => {
      const f = s.files.find((x) => x.id === r.file_id);
      const errors = s.file_errors.filter((e) => e.validation_run_id === r.id);

      let checklistSummary: string | null = null;
      if (f?.workflow_id) {
        const defs = s.checklist_items.filter((d) => d.workflow_id === f.workflow_id);
        const results = s.checklist_results.filter(
          (cr) => cr.file_id === r.file_id && cr.validation_run_id === r.id,
        );
        checklistSummary = summarizeChecklistResults(defs, results);
      }

      const failure_reasons = summarizeBlockingReasons(
        r.id,
        r.passed,
        errors,
        f ?? null,
        checklistSummary,
      );
      return {
        ...r,
        failure_reasons,
        checklist_summary: checklistSummary,
        files: f
          ? {
              id: f.id,
              original_name: f.original_name,
              workflow_id: f.workflow_id,
              status: f.status,
              status_display: formatFileStatus(f.status),
            }
          : null,
      };
    });
  return workflowId ? list.filter((r) => r.files?.workflow_id === workflowId) : list;
}

export async function GET(req: Request) {
  const auth = await requireDqAuth(req);
  if ("error" in auth) return auth.error;

  try {
    const url = new URL(req.url);
    const workflowId = url.searchParams.get("workflowId");
    const limit = Math.min(Number(url.searchParams.get("limit") || "80"), 300);

    if (usesJson()) {
      const body = await readStandalone((s) => {
        const runs = mapRunsFromStore(s, workflowId, limit);

        let fileRows = [...s.files].sort((a, b) => b.created_at.localeCompare(a.created_at));
        if (workflowId) fileRows = fileRows.filter((f) => f.workflow_id === workflowId);

        const processedFiles = fileRows
          .filter((f) => f.status === "processed")
          .slice(0, 150)
          .map((f) => ({
            id: f.id,
            original_name: f.original_name,
            workflow_id: f.workflow_id,
            processed_at: f.processed_at,
          }));

        const failedFiles = fileRows
          .filter((f) => FAILED_STATUSES.includes(f.status as (typeof FAILED_STATUSES)[number]))
          .slice(0, 200)
          .map((f) => {
            const meta = typeof f.metadata === "object" && f.metadata ? f.metadata : {};
            const reason = typeof meta.rejection_reason === "string" ? meta.rejection_reason : null;
            return {
              id: f.id,
              original_name: f.original_name,
              workflow_id: f.workflow_id,
              status: f.status,
              status_display: formatFileStatus(f.status),
              detail: reason,
            };
          });

        return { runs, processedFiles, failedFiles };
      });
      return NextResponse.json(body);
    }

    const body = await mariadbGetReportsPayload({ workflowId, limit });
    return NextResponse.json(body);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Reports failed";
    console.error("[api/reports]", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
