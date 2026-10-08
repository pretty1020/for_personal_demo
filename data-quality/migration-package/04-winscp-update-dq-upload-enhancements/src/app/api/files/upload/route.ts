import { NextResponse } from "next/server";
import { requireDqAuth } from "@/lib/api-guard";
import { sha256Buffer } from "@/lib/hash";
import { writeAudit, notify } from "@/lib/audit";
import { findDuplicate, findFileByName, replaceFileContent, saveIngestedFile } from "@/lib/ingest";
import { scheduleValidationJob } from "@/lib/jobs/queue";
import { runValidationForFile } from "@/lib/services/validation-service";
import { usesJson } from "@/lib/db";
import { mariadbGetWorkflow } from "@/lib/mariadb/repository";
import { readStandalone } from "@/lib/standalone/store";
import { getAllowDuplicates, getRequireYyyymmdd } from "@/lib/workflow-meta";
import { requireYyyymmddInFileName } from "@/lib/filename-period";
import { mergeTabularBuffers } from "@/lib/file-merge";
import { normalizeVisibility } from "@/lib/file-visibility";
import { readFileBytes } from "@/lib/storage";
import { validateUploadFileName, validateUploadMimeType } from "@/lib/validation/upload-guard";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

type ConflictAction = "overwrite" | "append";

export async function POST(req: Request) {
  const auth = await requireDqAuth(req);
  if ("error" in auth) return auth.error;

  try {
    const form = await req.formData();
    const workflowId = String(form.get("workflowId") || "");
    const file = form.get("file");
    const conflictRaw = String(form.get("conflictAction") || "").toLowerCase();
    const conflictAction: ConflictAction | null =
      conflictRaw === "overwrite" || conflictRaw === "append" ? conflictRaw : null;
    const visibility = normalizeVisibility(form.get("visibility"));

    if (!workflowId || !(file instanceof File)) {
      return NextResponse.json({ error: "workflowId and file are required" }, { status: 400 });
    }

    let wfName = "workflow";
    let expectedFileType: "csv" | "xlsx" = "csv";
    let fileNamePattern: string | null = null;
    let allowDuplicates = false;
    let requireYmd = true;

    if (usesJson()) {
      const wf = await readStandalone((s) => s.workflows.find((w) => w.id === workflowId) ?? null);
      if (!wf) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
      wfName = wf.name;
      expectedFileType = wf.expected_file_type;
      const passRules = wf.pass_rules as { file_name_pattern?: string } | undefined;
      fileNamePattern = passRules?.file_name_pattern ?? null;
      allowDuplicates = getAllowDuplicates(wf.pass_rules);
      requireYmd = getRequireYyyymmdd(wf.pass_rules);
    } else {
      const wf = await mariadbGetWorkflow(workflowId);
      if (!wf) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
      wfName = wf.name;
      expectedFileType = wf.expected_file_type;
      const passRules = wf.pass_rules as { file_name_pattern?: string } | undefined;
      fileNamePattern = passRules?.file_name_pattern ?? null;
      allowDuplicates = getAllowDuplicates(wf.pass_rules);
      requireYmd = getRequireYyyymmdd(wf.pass_rules);
    }

    const nameCheck = validateUploadFileName(file.name, expectedFileType, fileNamePattern);
    if (!nameCheck.ok) {
      return NextResponse.json({ error: nameCheck.error }, { status: 400 });
    }

    let periodYyyymmdd: string | null = null;
    if (requireYmd) {
      const ymd = requireYyyymmddInFileName(file.name);
      if (!ymd.ok) {
        return NextResponse.json({ error: ymd.error }, { status: 400 });
      }
      periodYyyymmdd = ymd.period;
    }

    const mimeCheck = validateUploadMimeType(file.type || null, expectedFileType);
    if (!mimeCheck.ok) {
      return NextResponse.json({ error: mimeCheck.error }, { status: 400 });
    }

    let buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `File exceeds ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB upload limit` },
        { status: 413 },
      );
    }

    const sameName = await findFileByName(workflowId, file.name);
    if (sameName && !conflictAction) {
      return NextResponse.json(
        {
          filenameConflict: true,
          existingId: sameName.id,
          existingName: sameName.original_name,
          message:
            "A file with this name already exists. Choose Overwrite or Append/Merge.",
        },
        { status: 409 },
      );
    }

    if (sameName && conflictAction === "append") {
      const existingBuf = await readFileBytes(sameName.storage_path);
      const merged = mergeTabularBuffers({
        existingName: sameName.original_name,
        existingBuffer: existingBuf,
        incomingName: file.name,
        incomingBuffer: buffer,
        expectedFileType,
      });
      if (!merged.ok) {
        return NextResponse.json({ error: merged.error }, { status: 400 });
      }
      if (merged.buffer.length > MAX_UPLOAD_BYTES) {
        return NextResponse.json(
          { error: `Merged file exceeds ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB limit` },
          { status: 413 },
        );
      }
      buffer = Buffer.from(merged.buffer);
    }

    const hash = sha256Buffer(buffer);
    const existingHashId = await findDuplicate(workflowId, hash);

    if (existingHashId && !allowDuplicates && (!sameName || sameName.id !== existingHashId)) {
      await writeAudit({
        action: "duplicate_prevented",
        workflowId,
        fileId: existingHashId,
        details: { name: file.name, hash },
      });
      await notify({
        type: "duplicate_upload",
        title: "Duplicate upload blocked",
        message: `${file.name} matches an existing file for this workflow`,
        fileId: existingHashId,
        workflowId,
      });
      return NextResponse.json({ duplicate: true, existingId: existingHashId }, { status: 409 });
    }

    const baseMeta: Record<string, unknown> = {
      visibility,
      ...(periodYyyymmdd ? { period_yyyymmdd: periodYyyymmdd } : {}),
    };

    if (sameName && conflictAction) {
      const replaced = await replaceFileContent({
        fileId: sameName.id,
        buffer,
        hash,
        mimeType: file.type || sameName.mime_type,
        metadataPatch: {
          ...baseMeta,
          conflict_action: conflictAction,
          last_conflict_at: new Date().toISOString(),
          ...(existingHashId && allowDuplicates && existingHashId !== sameName.id
            ? { duplicate_of: existingHashId, allowed_duplicate: true }
            : {}),
        },
      });
      if (!replaced) return NextResponse.json({ error: "File not found" }, { status: 404 });

      await writeAudit({
        action: conflictAction === "append" ? "file_appended" : "file_overwritten",
        fileId: replaced.id,
        workflowId,
        details: {
          name: file.name,
          size: buffer.length,
          conflictAction,
          ...(periodYyyymmdd ? { period_yyyymmdd: periodYyyymmdd } : {}),
        },
      });
      await notify({
        type: "file_received",
        title: conflictAction === "append" ? "File appended" : "File overwritten",
        message: `${file.name} ${conflictAction === "append" ? "merged into" : "replaced"} existing upload for ${wfName}`,
        fileId: replaced.id,
        workflowId,
      });

      scheduleValidationJob(replaced.id, runValidationForFile);
      return NextResponse.json({
        file: replaced,
        conflictResolved: conflictAction,
        periodYyyymmdd,
      });
    }

    const inserted = await saveIngestedFile({
      workflowId,
      fileName: file.name,
      buffer,
      hash,
      mimeType: file.type || null,
      intakeSource: "upload",
      metadata: {
        ...baseMeta,
        ...(existingHashId && allowDuplicates
          ? { duplicate_of: existingHashId, allowed_duplicate: true }
          : {}),
      },
    });

    if (!inserted) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });

    await writeAudit({
      action: "file_uploaded",
      fileId: inserted.id,
      workflowId,
      details: {
        name: file.name,
        size: buffer.length,
        visibility,
        ...(periodYyyymmdd ? { period_yyyymmdd: periodYyyymmdd } : {}),
        ...(existingHashId && allowDuplicates ? { allowed_duplicate_of: existingHashId } : {}),
      },
    });

    await notify({
      type: "file_received",
      title: "File uploaded",
      message: `${file.name} received for workflow ${wfName}`,
      fileId: inserted.id,
      workflowId,
    });

    scheduleValidationJob(inserted.id, runValidationForFile);
    return NextResponse.json({
      file: inserted,
      allowedDuplicate: Boolean(existingHashId && allowDuplicates),
      periodYyyymmdd,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Upload failed";
    console.error("[api/files/upload]", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
