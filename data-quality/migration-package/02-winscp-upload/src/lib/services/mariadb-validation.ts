import { randomUUID } from "node:crypto";
import { usesMariaDb } from "@/lib/db";
import {
  mariadbGetChecklistItems,
  mariadbGetFile,
  mariadbGetRequiredColumns,
  mariadbGetWorkflow,
  mariadbInsertChecklistResults,
  mariadbInsertFileErrors,
  mariadbInsertValidationRun,
  mariadbUpdateFile,
} from "@/lib/mariadb/repository";
import { readFileBytes } from "@/lib/storage";
import { validateBuffer } from "@/lib/validation/validate";
import { resolveChecklistResult } from "@/lib/validation/checklist-resolve";
import { needsManualChecklistReview } from "@/lib/checklist-eval";
import type { WorkflowValidationConfig } from "@/lib/validation/types";
import { writeAudit, notify } from "@/lib/audit";
import type { DataQualityChecks, FileRecordStatus, StructureChecks } from "@/types/database";
import { resolveChecklistGate } from "@/lib/services/checklist-auto";

function withoutChecklistRejectionMeta(meta: unknown): Record<string, unknown> {
  const m = typeof meta === "object" && meta && !Array.isArray(meta) ? { ...(meta as Record<string, unknown>) } : {};
  delete m.rejection_reason;
  delete m.rejection_source;
  delete m.rejected_at;
  return m;
}

async function finalizeMariaDbFailure(fileId: string, workflowId: string, message: string): Promise<void> {
  const file = await mariadbGetFile(fileId);
  const now = new Date().toISOString();
  const runId = await mariadbInsertValidationRun({
    id: randomUUID(),
    file_id: fileId,
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
    } satisfies StructureChecks,
    data_quality_result: {
      missingRequiredValues: false,
      invalidDates: false,
      invalidNumbers: false,
      invalidPatterns: false,
      duplicateRows: false,
      columnMismatch: false,
      invalidCategories: false,
    } satisfies DataQualityChecks,
    pivot_detection: { score: 0, signals: [], likelyPivot: false },
  });
  await mariadbInsertFileErrors([
    {
      validation_run_id: runId,
      severity: "error",
      code: "READ_STORAGE",
      message,
      row_index: null,
      column_name: null,
      details: {},
    },
  ]);
  await mariadbUpdateFile(fileId, {
    status: "blocked",
    updated_at: now,
    metadata: {
      ...(typeof file?.metadata === "object" && file.metadata ? file.metadata : {}),
      last_validation_run_id: runId,
    },
  });
  await writeAudit({
    action: "validation_failed",
    fileId,
    workflowId,
    details: { message },
  });
}

export async function runMariaDbValidationForFile(fileId: string): Promise<void> {
  if (!usesMariaDb()) throw new Error("MariaDB backend not active");

  const fileRow = await mariadbGetFile(fileId);
  if (!fileRow) throw new Error("File not found");
  if (!fileRow.workflow_id) throw new Error("File has no workflow assigned");

  const workflowId = fileRow.workflow_id;

  await mariadbUpdateFile(fileId, {
    status: "validating",
    updated_at: new Date().toISOString(),
    metadata: withoutChecklistRejectionMeta(fileRow.metadata),
  });

  const wf = await mariadbGetWorkflow(workflowId);
  const cols = await mariadbGetRequiredColumns(workflowId);
  const items = await mariadbGetChecklistItems(workflowId);
  if (!wf) throw new Error("Workflow not found");

  await writeAudit({
    action: "validation_started",
    fileId,
    workflowId,
  });

  let buffer: Buffer;
  try {
    buffer = await readFileBytes(fileRow.storage_path);
  } catch {
    await finalizeMariaDbFailure(fileId, workflowId, "Unable to read file from storage");
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

  const runId = await mariadbInsertValidationRun({
    id: randomUUID(),
    file_id: fileId,
    completed_at: new Date().toISOString(),
    passed: result.passed,
    can_proceed: result.canProceed,
    summary: result.summary,
    structure_result: result.structure,
    data_quality_result: result.dataQuality,
    pivot_detection: result.pivot,
  });

  if (result.issues.length) {
    await mariadbInsertFileErrors(
      result.issues.slice(0, 200).map((i) => ({
        validation_run_id: runId,
        severity: i.severity,
        code: i.code,
        message: i.message,
        row_index: i.rowIndex ?? null,
        column_name: i.column ?? null,
        details: i.details ?? {},
      })),
    );
  }

  const hints = result.checklistHints;
  const resultRows = items.map((it) => {
    const resolved = resolveChecklistResult(hints, it.item_key, warningCount);
    return {
      item_key: it.item_key,
      passed: resolved.passed,
      acknowledged: resolved.acknowledged,
    };
  });

  await mariadbInsertChecklistResults(
    items.map((it, idx) => ({
      file_id: fileId,
      validation_run_id: runId,
      item_key: it.item_key,
      passed: resultRows[idx].passed,
      acknowledged: resultRows[idx].acknowledged,
    })),
  );

  let nextStatus: FileRecordStatus;
  if (!result.passed) {
    nextStatus = "blocked";
    await notify({
      type: "validation_failure",
      title: "Validation failed",
      message: `${fileRow.original_name} failed validation`,
      fileId,
      workflowId,
    });
    await writeAudit({
      action: "validation_failed",
      fileId,
      workflowId,
      details: { runId, summary: result.summary },
    });
  } else {
    nextStatus = "pending_review";
    await writeAudit({
      action: "validation_passed",
      fileId,
      workflowId,
      details: { runId },
    });
  }

  await mariadbUpdateFile(fileId, {
    status: nextStatus,
    metadata: {
      ...withoutChecklistRejectionMeta(fileRow.metadata),
      last_validation_run_id: runId,
      preview_rows: result.previewRows.slice(0, 15),
    },
    updated_at: new Date().toISOString(),
  });

  if (result.passed) {
    const manualPending = needsManualChecklistReview(items, resultRows);
    if (warningCount === 0 && !manualPending) {
      await resolveChecklistGate(fileId);
    }
  }
}
