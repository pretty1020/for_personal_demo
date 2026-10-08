import { randomUUID } from "node:crypto";
import { canApproveFile } from "@/lib/checklist-gate";
import { approveAndProcessFile, rejectFile } from "@/lib/services/file-process";
import { usesJson } from "@/lib/db";
import { mariadbGetFile, mariadbUpdateChecklistResultGateError } from "@/lib/mariadb/repository";
import { writeStandalone } from "@/lib/standalone/store";

async function logGateError(fileId: string, message: string) {
  const now = new Date().toISOString();
  if (usesJson()) {
    await writeStandalone((s) => {
      const fileRow = s.files.find((f) => f.id === fileId);
      const runId = (fileRow?.metadata as { last_validation_run_id?: string })?.last_validation_run_id;
      if (!runId) return;
      s.file_errors.push({
        id: randomUUID(),
        validation_run_id: runId,
        severity: "error",
        code: "CHECKLIST_GATE",
        message,
        row_index: null,
        column_name: null,
        details: { source: "checklist_gate" },
        created_at: now,
      });
    });
    return;
  }

  const file = await mariadbGetFile(fileId);
  const runId = (file?.metadata as { last_validation_run_id?: string } | undefined)?.last_validation_run_id;
  if (!runId) return;
  await mariadbUpdateChecklistResultGateError(fileId, runId, message);
}

export async function resolveChecklistGate(fileId: string): Promise<"processed" | "rejected"> {
  const gate = await canApproveFile(fileId);
  if (gate.ok) {
    await approveAndProcessFile(fileId);
    return "processed";
  }
  const msg = gate.reasons.join("; ");
  await rejectFile(fileId, msg, { source: "checklist_gate" });
  await logGateError(fileId, msg);
  return "rejected";
}

export const applyAutomaticChecklistResolution = resolveChecklistGate;
