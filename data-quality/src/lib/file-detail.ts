import { usesJson } from "@/lib/db";
import { mariadbGetFileDetailPayload } from "@/lib/mariadb/repository";
import { readStandalone } from "@/lib/standalone/store";

function fromStore(fileId: string) {
  return readStandalone((s) => {
    const file = s.files.find((f) => f.id === fileId);
    if (!file) return null;

    const metaRun = (file.metadata as { last_validation_run_id?: string })?.last_validation_run_id;
    const latestRun = metaRun
      ? (s.validation_runs.find((r) => r.id === metaRun) ?? null)
      : [...s.validation_runs]
          .filter((r) => r.file_id === fileId)
          .sort((a, b) => b.started_at.localeCompare(a.started_at))[0] ?? null;

    const wf = file.workflow_id ? (s.workflows.find((w) => w.id === file.workflow_id) ?? null) : null;
    const errors = latestRun?.id
      ? s.file_errors
          .filter((e) => e.validation_run_id === latestRun.id)
          .sort((a, b) => a.created_at.localeCompare(b.created_at))
      : [];
    const checklist =
      latestRun?.id && file.workflow_id
        ? s.checklist_results.filter((c) => c.file_id === fileId && c.validation_run_id === latestRun.id)
        : [];
    const checklistDefs = file.workflow_id
      ? s.checklist_items
          .filter((c) => c.workflow_id === file.workflow_id)
          .sort((a, b) => a.sort_order - b.sort_order)
      : [];
    const audit = s.audit_logs
      .filter((a) => a.file_id === fileId)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, 100);

    return { file, workflow: wf, validationRun: latestRun, errors, checklist, checklistDefs, audit };
  });
}

export async function getFileDetail(fileId: string) {
  if (usesJson()) return fromStore(fileId);
  return mariadbGetFileDetailPayload(fileId);
}
