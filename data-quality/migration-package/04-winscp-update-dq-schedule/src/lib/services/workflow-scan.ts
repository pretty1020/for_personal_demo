import fs from "node:fs/promises";
import path from "node:path";
import { usesJson } from "@/lib/db";
import { mariadbGetWorkflow } from "@/lib/mariadb/repository";
import { watchDir } from "@/lib/data-paths";
import { sha256Buffer } from "@/lib/hash";
import { writeAudit, notify } from "@/lib/audit";
import { findDuplicate, saveIngestedFile } from "@/lib/ingest";
import { scheduleValidationJob } from "@/lib/jobs/queue";
import { isVercelRuntime } from "@/lib/storage";
import { runValidationForFile } from "@/lib/services/validation-service";
import { readStandalone } from "@/lib/standalone/store";
import { validateUploadFileName } from "@/lib/validation/upload-guard";
import { getAllowDuplicates } from "@/lib/workflow-meta";
import type { WorkflowRow } from "@/types/database";

function scanDir(workflowId: string, wf: Pick<WorkflowRow, "source_type" | "source_path">) {
  const fallback = watchDir(workflowId);
  const raw = wf.source_path?.trim();
  if (!raw) return fallback;
  const cwd = process.cwd();
  const resolved = path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
  if (wf.source_type === "simulated_path" || wf.source_type === "watched_folder") return resolved;
  // Upload workflows may still scan a configured path (or the default watch folder).
  return resolved;
}

export function shouldSkipWorkflowScanFile(name: string) {
  if (name.startsWith(".") || name.startsWith("~$")) return true;
  const lower = name.toLowerCase();
  return lower === "thumbs.db" || lower === "desktop.ini";
}

async function getWorkflow(workflowId: string) {
  if (usesJson()) return readStandalone((s) => s.workflows.find((w) => w.id === workflowId) ?? null);
  return mariadbGetWorkflow(workflowId);
}

export async function scanWorkflowSources(workflowId: string) {
  if (isVercelRuntime()) {
    return {
      ingested: 0,
      fileIds: [] as string[],
      skipped: [] as { name: string; reason: string }[],
      warning: "Folder scan is not available on Vercel. Use Upload instead.",
    };
  }

  const wf = await getWorkflow(workflowId);
  if (!wf) throw new Error("Workflow not found");

  const base = scanDir(workflowId, wf);
  let names: string[] = [];
  try {
    names = await fs.readdir(base);
  } catch {
    await fs.mkdir(base, { recursive: true });
  }

  const created: string[] = [];
  const skipped: { name: string; reason: string }[] = [];
  const passRules = (wf.pass_rules || {}) as { file_name_pattern?: string };
  const fileNamePattern = passRules.file_name_pattern ?? null;
  const allowDuplicates = getAllowDuplicates(wf.pass_rules);

  for (const name of names) {
    if (shouldSkipWorkflowScanFile(name)) continue;
    const full = path.join(base, name);
    const stat = await fs.stat(full).catch(() => null);
    if (!stat?.isFile()) continue;

    const nameCheck = validateUploadFileName(name, wf.expected_file_type, fileNamePattern);
    if (!nameCheck.ok) {
      skipped.push({ name, reason: nameCheck.error });
      continue;
    }

    const ext = path.extname(name).toLowerCase();
    if (wf.expected_file_type === "csv" && ext !== ".csv") continue;
    if (wf.expected_file_type === "xlsx" && ![".xlsx", ".xls"].includes(ext)) continue;

    const buffer = await fs.readFile(full);
    const hash = sha256Buffer(buffer);
    const dupId = await findDuplicate(workflowId, hash);
    if (dupId && !allowDuplicates) {
      await writeAudit({
        action: "duplicate_prevented",
        workflowId,
        details: { fileName: name, hash, existingId: dupId },
      });
      await notify({
        type: "duplicate_upload",
        title: "Duplicate prevented",
        message: `${name} already ingested for this workflow`,
        workflowId,
        fileId: dupId,
      });
      skipped.push({ name, reason: "Duplicate" });
      continue;
    }

    const row = await saveIngestedFile({
      workflowId,
      fileName: name,
      buffer,
      hash,
      mimeType:
        ext === ".csv"
          ? "text/csv"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      intakeSource: wf.source_type === "upload" ? "watched_folder" : wf.source_type,
      metadata: { scanned_from: full },
    });
    if (!row) continue;

    created.push(row.id);
    await writeAudit({ action: "file_uploaded", fileId: row.id, workflowId, details: { source: "scan", name } });
    await notify({
      type: "file_received",
      title: "New file ingested",
      message: `${name} captured from watched source`,
      fileId: row.id,
      workflowId,
    });
    scheduleValidationJob(row.id, runValidationForFile);
  }

  return {
    ingested: created.length,
    fileIds: created,
    skipped,
    scanPath: base,
  };
}
