import { readFileBytes } from "@/lib/storage";
import { randomUUID } from "node:crypto";
import { validateBuffer } from "@/lib/validation/validate";
import { resolveChecklistResult } from "@/lib/validation/checklist-resolve";
import { needsManualChecklistReview } from "@/lib/checklist-eval";
import type { WorkflowValidationConfig } from "@/lib/validation/types";
import type { FileRecordStatus } from "@/types/database";
import {
  readStandalone,
  standaloneAppendNotification,
  standaloneWriteAudit,
  writeStandalone,
} from "@/lib/standalone/store";
import { resolveChecklistGate } from "@/lib/services/checklist-auto";

function withoutChecklistRejectionMeta(meta: unknown): Record<string, unknown> {
  const m = typeof meta === "object" && meta && !Array.isArray(meta) ? { ...(meta as Record<string, unknown>) } : {};
  delete m.rejection_reason;
  delete m.rejection_source;
  delete m.rejected_at;
  return m;
}

async function finalizeFailureStore(fileId: string, workflowId: string, message: string): Promise<void> {
  await writeStandalone((s) => {
    const fileRow = s.files.find((f) => f.id === fileId);
    const runId = randomUUID();
    const now = new Date().toISOString();
    if (fileRow) {
      fileRow.status = "blocked";
      fileRow.updated_at = now;
      fileRow.metadata = {
        ...(typeof fileRow.metadata === "object" && fileRow.metadata ? fileRow.metadata : {}),
        last_validation_run_id: runId,
      };
    }
    s.validation_runs.push({
      id: runId,
      file_id: fileId,
      started_at: now,
      completed_at: now,
      passed: false,
      can_proceed: false,
      summary: { errorCount: 1 },
      structure_result: {
        fileTypeAllowed: false,
        fileReadable: false,
        notPivotFormat: false,
        noMergedHeaders: false,
        requiredColumnsExist: false,
        noDuplicateColumnNames: false,
        validHeaderRow: false,
        notBlankDataset: false,
      },
      data_quality_result: {
        missingRequiredValues: false,
        invalidDates: false,
        invalidNumbers: false,
        invalidPatterns: false,
        duplicateRows: false,
        columnMismatch: false,
        invalidCategories: false,
      },
      pivot_detection: { score: 0, signals: [], likelyPivot: false },
    });
    s.file_errors.push({
      id: randomUUID(),
      validation_run_id: runId,
      severity: "error",
      code: "READ_STORAGE",
      message,
      row_index: null,
      column_name: null,
      details: {},
      created_at: now,
    });
  });
  await standaloneWriteAudit({
    action: "validation_failed",
    fileId,
    workflowId,
    details: { message },
  });
}

export async function runStandaloneValidationForFile(fileId: string): Promise<void> {
  await writeStandalone((s) => {
    const fr = s.files.find((f) => f.id === fileId);
    if (!fr) throw new Error("File not found");
    if (!fr.workflow_id) throw new Error("File has no workflow assigned");
    fr.status = "validating";
    fr.metadata = {
      ...withoutChecklistRejectionMeta(fr.metadata),
    };
    fr.updated_at = new Date().toISOString();
  });

  const ctx = await readStandalone((s) => {
    const fr = s.files.find((f) => f.id === fileId);
    if (!fr || !fr.workflow_id) return null;
    const wf = s.workflows.find((w) => w.id === fr.workflow_id) ?? null;
    const cols = s.required_columns
      .filter((c) => c.workflow_id === fr.workflow_id)
      .sort((a, b) => a.sort_order - b.sort_order);
    const items = s.checklist_items
      .filter((it) => it.workflow_id === fr.workflow_id)
      .sort((a, b) => a.sort_order - b.sort_order);
    return { fileRow: fr, wf, cols, items };
  });

  if (!ctx || !ctx.fileRow.workflow_id) throw new Error("File not found");
  const workflowId = ctx.fileRow.workflow_id;
  const { fileRow, wf, cols, items } = ctx;
  if (!wf) throw new Error("Workflow not found");

  await standaloneWriteAudit({
    action: "validation_started",
    fileId,
    workflowId,
  });

  let buffer: Buffer;
  try {
    buffer = await readFileBytes(fileRow.storage_path);
  } catch {
    await finalizeFailureStore(fileId, workflowId, "Unable to read file from storage");
    return;
  }

  const config: WorkflowValidationConfig = {
    expected_file_type: wf.expected_file_type,
    required_columns: cols.map((c) => ({
      column_name: c.column_name,
      data_type: c.data_type,
      is_required: c.is_required,
      allowed_values: c.allowed_values,
      pattern: c.pattern,
    })),
    pass_rules: (wf.pass_rules || {}) as WorkflowValidationConfig["pass_rules"],
  };

  const result = validateBuffer(fileRow.original_name, buffer, config);
  const warningCount = result.issues.filter((i) => i.severity === "warning").length;

  const stored = await writeStandalone((s) => {
    const fr = s.files.find((f) => f.id === fileId);
    if (!fr || !fr.workflow_id) return { resultRows: [] as { item_key: string; passed: boolean; acknowledged: boolean }[] };

    const runId = randomUUID();
    const now = new Date().toISOString();
    s.validation_runs.push({
      id: runId,
      file_id: fileId,
      started_at: now,
      completed_at: now,
      passed: result.passed,
      can_proceed: result.canProceed,
      summary: result.summary,
      structure_result: result.structure,
      data_quality_result: result.dataQuality,
      pivot_detection: result.pivot,
    });

    if (result.issues.length) {
      const capped = result.issues.slice(0, 200);
      for (const i of capped) {
        s.file_errors.push({
          id: randomUUID(),
          validation_run_id: runId,
          severity: i.severity,
          code: i.code,
          message: i.message,
          row_index: i.rowIndex ?? null,
          column_name: i.column ?? null,
          details: i.details ?? {},
          created_at: now,
        });
      }
    }

    const hints = result.checklistHints;
    const resultRows: { item_key: string; passed: boolean; acknowledged: boolean }[] = [];
    for (const it of items) {
      const resolved = resolveChecklistResult(hints, it.item_key, warningCount);
      resultRows.push({
        item_key: it.item_key,
        passed: resolved.passed,
        acknowledged: resolved.acknowledged,
      });
      s.checklist_results.push({
        id: randomUUID(),
        file_id: fileId,
        validation_run_id: runId,
        item_key: it.item_key,
        passed: resolved.passed,
        acknowledged: resolved.acknowledged,
        updated_at: now,
      });
    }

    let nextStatus: FileRecordStatus;
    if (!result.passed) {
      nextStatus = "blocked";
    } else {
      nextStatus = "pending_review";
    }

    fr.status = nextStatus;
    fr.metadata = {
      ...withoutChecklistRejectionMeta(fr.metadata),
      last_validation_run_id: runId,
      preview_rows: result.previewRows.slice(0, 15),
    };
    fr.updated_at = now;
    return { resultRows };
  });

  if (!result.passed) {
    await standaloneAppendNotification({
      type: "validation_failure",
      title: "Validation failed",
      message: `${fileRow.original_name} failed validation`,
      fileId,
      workflowId,
    });
    await standaloneWriteAudit({
      action: "validation_failed",
      fileId,
      workflowId,
      details: { summary: result.summary },
    });
  } else {
    await standaloneWriteAudit({
      action: "validation_passed",
      fileId,
      workflowId,
      details: {},
    });
    if (!needsManualChecklistReview(items, stored.resultRows)) {
      await resolveChecklistGate(fileId);
    }
  }
}
