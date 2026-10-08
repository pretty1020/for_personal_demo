import { randomUUID } from "node:crypto";
import { usesJson } from "@/lib/db";
import {
  mariadbFindDuplicate,
  mariadbFindFileByName,
  mariadbGetFile,
  mariadbGetWorkflow,
  mariadbInsertFile,
  mariadbUpdateFile,
} from "@/lib/mariadb/repository";
import { readStandalone, writeStandalone } from "@/lib/standalone/store";
import { overwriteStoredFile, saveUploadFile } from "@/lib/storage";
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

export async function findFileByName(workflowId: string, fileName: string): Promise<FileRow | null> {
  if (usesJson()) {
    return readStandalone((s) => {
      const lower = fileName.toLowerCase();
      const matches = s.files
        .filter((f) => f.workflow_id === workflowId && f.original_name.toLowerCase() === lower)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return matches[0] ?? null;
    });
  }
  return mariadbFindFileByName(workflowId, fileName);
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

/** Replace file bytes in place (overwrite or append/merge result) and reset for re-validation. */
export async function replaceFileContent(input: {
  fileId: string;
  buffer: Buffer;
  hash: string;
  mimeType: string | null;
  metadataPatch?: Record<string, unknown>;
}): Promise<FileRow | null> {
  const now = new Date().toISOString();

  if (usesJson()) {
    return writeStandalone(async (s) => {
      const file = s.files.find((f) => f.id === input.fileId);
      if (!file) return null;
      await overwriteStoredFile(file.storage_path, input.buffer);
      file.file_hash = input.hash;
      file.size_bytes = input.buffer.length;
      if (input.mimeType !== undefined) file.mime_type = input.mimeType;
      file.status = "pending";
      file.processed_at = null;
      file.updated_at = now;
      file.metadata = {
        ...(typeof file.metadata === "object" && file.metadata ? file.metadata : {}),
        ...(input.metadataPatch || {}),
      };
      return { ...file };
    });
  }

  const existing = await mariadbGetFile(input.fileId);
  if (!existing) return null;
  await overwriteStoredFile(existing.storage_path, input.buffer);
  const metadata = {
    ...(typeof existing.metadata === "object" && existing.metadata ? existing.metadata : {}),
    ...(input.metadataPatch || {}),
  };
  await mariadbUpdateFile(input.fileId, {
    file_hash: input.hash,
    size_bytes: input.buffer.length,
    mime_type: input.mimeType,
    status: "pending",
    processed_at: null,
    updated_at: now,
    metadata,
  });
  return {
    ...existing,
    file_hash: input.hash,
    size_bytes: input.buffer.length,
    mime_type: input.mimeType,
    status: "pending",
    processed_at: null,
    updated_at: now,
    metadata,
  };
}
