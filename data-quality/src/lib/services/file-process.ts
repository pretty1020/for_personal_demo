import { usesJson } from "@/lib/db";
import { canApproveFile } from "@/lib/checklist-gate";
import { writeAudit, notify } from "@/lib/audit";
import { mariadbGetFile, mariadbUpdateFile } from "@/lib/mariadb/repository";
import { writeStandalone } from "@/lib/standalone/store";
import { promoteToProcessed } from "@/lib/storage";

export async function approveAndProcessFile(fileId: string) {
  const gate = await canApproveFile(fileId);
  if (!gate.ok) throw new Error(gate.reasons.join("; "));

  const now = new Date().toISOString();

  if (usesJson()) {
    const meta = await writeStandalone(async (s) => {
      const fileRow = s.files.find((f) => f.id === fileId);
      if (!fileRow) throw new Error("File not found");
      const destPath = await promoteToProcessed({
        storagePath: fileRow.storage_path,
        workflowId: fileRow.workflow_id || "unassigned",
        fileId,
        fileName: fileRow.original_name,
      });
      fileRow.status = "processed";
      fileRow.processed_at = now;
      fileRow.metadata = {
        ...(typeof fileRow.metadata === "object" && fileRow.metadata ? fileRow.metadata : {}),
        processed_path: destPath,
      };
      fileRow.updated_at = now;
      return { destPath, workflowId: fileRow.workflow_id, name: fileRow.original_name };
    });
    await writeAudit({ action: "approved_processed", fileId, workflowId: meta.workflowId, details: { destPath: meta.destPath } });
    await notify({
      type: "completed_processing",
      title: "Processing complete",
      message: `${meta.name} moved to processed stage`,
      fileId,
      workflowId: meta.workflowId,
    });
    return;
  }

  const fileRow = await mariadbGetFile(fileId);
  if (!fileRow) throw new Error("File not found");

  const destPath = await promoteToProcessed({
    storagePath: fileRow.storage_path,
    workflowId: fileRow.workflow_id || "unassigned",
    fileId,
    fileName: fileRow.original_name,
  });

  await mariadbUpdateFile(fileId, {
    status: "processed",
    processed_at: now,
    metadata: {
      ...(typeof fileRow.metadata === "object" && fileRow.metadata ? fileRow.metadata : {}),
      processed_path: destPath,
    },
    updated_at: now,
  });

  await writeAudit({ action: "approved_processed", fileId, workflowId: fileRow.workflow_id, details: { destPath } });
  await notify({
    type: "completed_processing",
    title: "Processing complete",
    message: `${fileRow.original_name} moved to processed stage`,
    fileId,
    workflowId: fileRow.workflow_id,
  });
}

export async function rejectFile(
  fileId: string,
  reason?: string,
  opts?: { source?: "manual" | "checklist_gate" },
) {
  const now = new Date().toISOString();
  const metaPatch =
    reason || opts?.source
      ? {
          ...(reason ? { rejection_reason: reason, rejected_at: now } : { rejected_at: now }),
          ...(opts?.source ? { rejection_source: opts.source } : {}),
        }
      : { rejected_at: now };

  if (usesJson()) {
    const meta = await writeStandalone((s) => {
      const fileRow = s.files.find((f) => f.id === fileId);
      if (!fileRow) throw new Error("File not found");
      fileRow.status = "rejected";
      fileRow.updated_at = now;
      fileRow.metadata = {
        ...(typeof fileRow.metadata === "object" && fileRow.metadata ? fileRow.metadata : {}),
        ...metaPatch,
      };
      return { workflowId: fileRow.workflow_id, name: fileRow.original_name };
    });
    await writeAudit({
      action: "rejected",
      fileId,
      workflowId: meta.workflowId,
      details: { reason: reason || null, source: opts?.source ?? "manual" },
    });
    await notify({
      type: "rejected",
      title: "File rejected",
      message: reason ? `${meta.name} was rejected: ${reason}` : `${meta.name} was rejected`,
      fileId,
      workflowId: meta.workflowId,
    });
    return;
  }

  const fileRow = await mariadbGetFile(fileId);
  if (!fileRow) throw new Error("File not found");

  await mariadbUpdateFile(fileId, {
    status: "rejected",
    updated_at: now,
    metadata: {
      ...(typeof fileRow.metadata === "object" && fileRow.metadata ? fileRow.metadata : {}),
      ...metaPatch,
    },
  });

  await writeAudit({
    action: "rejected",
    fileId,
    workflowId: fileRow.workflow_id,
    details: { reason: reason || null, source: opts?.source ?? "manual" },
  });
  await notify({
    type: "rejected",
    title: "File rejected",
    message: reason ? `${fileRow.original_name} was rejected: ${reason}` : `${fileRow.original_name} was rejected`,
    fileId,
    workflowId: fileRow.workflow_id,
  });
}
