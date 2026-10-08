import { usesJson } from "@/lib/db";
import { checklistGateOk } from "@/lib/checklist-eval";
import { mariadbGetChecklistGateData } from "@/lib/mariadb/repository";
import { readStandalone } from "@/lib/standalone/store";

export async function canApproveFile(fileId: string) {
  if (usesJson()) {
    return readStandalone((s) => {
      const fileRow = s.files.find((f) => f.id === fileId);
      if (!fileRow) return { ok: false, reasons: ["File not found"] };
      if (fileRow.status !== "pending_review") return { ok: false, reasons: ["File is not awaiting review"] };

      const runId = (fileRow.metadata as { last_validation_run_id?: string })?.last_validation_run_id;
      if (!runId || !fileRow.workflow_id) return { ok: false, reasons: ["No validation run"] };

      const results = s.checklist_results.filter(
        (r) => r.file_id === fileId && r.validation_run_id === runId,
      );
      const defs = s.checklist_items
        .filter((c) => c.workflow_id === fileRow.workflow_id)
        .sort((a, b) => a.sort_order - b.sort_order);

      return checklistGateOk(defs, results);
    });
  }

  const data = await mariadbGetChecklistGateData(fileId);
  if (!data) return { ok: false, reasons: ["File not found"] };
  if (data.file.status !== "pending_review") return { ok: false, reasons: ["File is not awaiting review"] };
  if (!data.hasRun) return { ok: false, reasons: ["No validation run"] };
  return checklistGateOk(data.defs, data.results);
}
