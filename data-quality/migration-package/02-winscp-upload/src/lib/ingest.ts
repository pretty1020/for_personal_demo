import { randomUUID } from "node:crypto";
import { usesJson } from "@/lib/db";
import {
  mariadbFindDuplicate,
  mariadbGetWorkflow,
  mariadbInsertFile,
} from "@/lib/mariadb/repository";
import { readStandalone, writeStandalone } from "@/lib/standalone/store";
import { saveUploadFile } from "@/lib/storage";
import type { FileRow } from "@/types/database";

export type IngestInput = {
  workflowId: string;
  fileName: string;
  buffer: Buffer;
  hash: string;
  mimeType: string | null;
  intakeSource: FileRow["intake_source"];
  metadata?: Record<string, unknown>;
};

export async function findDuplicate(workflowId: string, hash: string) {
  if (usesJson()) {
    return readStandalone(
      (s) => s.files.find((f) => f.workflow_id === workflowId && f.file_hash === hash)?.id ?? null,
    );
  }
  return mariadbFindDuplicate(workflowId, hash);
}

export async function saveIngestedFile(input: IngestInput): Promise<FileRow | null> {
  const { workflowId, fileName, buffer, hash, mimeType, intakeSource, metadata = {} } = input;
  const id = randomUUID();
  const now = new Date().toISOString();

  const storage_path = await saveUploadFile({
    workflowId,
    fileId: id,
    fileName,
    buffer,
    mimeType,
  });

  if (usesJson()) {
    const wf = await readStandalone((s) => s.workflows.find((w) => w.id === workflowId) ?? null);
    if (!wf) return null;
    return writeStandalone(async (s) => {
      const row: FileRow = {
        id,
        workflow_id: workflowId,
        original_name: fileName,
        storage_path,
        file_hash: hash,
        mime_type: mimeType,
        size_bytes: buffer.length,
        intake_source: intakeSource,
        status: "pending",
        metadata,
        processed_at: null,
        created_at: now,
        updated_at: now,
      };
      s.files.push(row);
      return row;
    });
  }

  const wf = await mariadbGetWorkflow(workflowId);
  if (!wf) return null;

  const row: FileRow = {
    id,
    workflow_id: workflowId,
    original_name: fileName,
    storage_path,
    file_hash: hash,
    mime_type: mimeType,
    size_bytes: buffer.length,
    intake_source: intakeSource,
    status: "pending",
    metadata,
    processed_at: null,
    created_at: now,
    updated_at: now,
  };
  await mariadbInsertFile(row);
  return row;
}
