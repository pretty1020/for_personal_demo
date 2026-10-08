import { NextResponse } from "next/server";
import { requireDqAuth } from "@/lib/api-guard";
import { sha256Buffer } from "@/lib/hash";
import { writeAudit, notify } from "@/lib/audit";
import { findDuplicate, saveIngestedFile } from "@/lib/ingest";
import { scheduleValidationJob } from "@/lib/jobs/queue";
import { runValidationForFile } from "@/lib/services/validation-service";
import { usesJson } from "@/lib/db";
import { mariadbGetWorkflow } from "@/lib/mariadb/repository";
import { readStandalone } from "@/lib/standalone/store";
import { validateUploadFileName, validateUploadMimeType } from "@/lib/validation/upload-guard";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export async function POST(req: Request) {
  const auth = await requireDqAuth(req);
  if ("error" in auth) return auth.error;

  try {
    const form = await req.formData();
    const workflowId = String(form.get("workflowId") || "");
    const file = form.get("file");
    if (!workflowId || !(file instanceof File)) {
      return NextResponse.json({ error: "workflowId and file are required" }, { status: 400 });
    }

    let wfName = "workflow";
    let expectedFileType: "csv" | "xlsx" = "csv";
    let fileNamePattern: string | null = null;

    if (usesJson()) {
      const wf = await readStandalone((s) => s.workflows.find((w) => w.id === workflowId) ?? null);
      if (!wf) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
      wfName = wf.name;
      expectedFileType = wf.expected_file_type;
      const passRules = wf.pass_rules as { file_name_pattern?: string } | undefined;
      fileNamePattern = passRules?.file_name_pattern ?? null;
    } else {
      const wf = await mariadbGetWorkflow(workflowId);
      if (!wf) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
      wfName = wf.name;
      expectedFileType = wf.expected_file_type;
      const passRules = wf.pass_rules as { file_name_pattern?: string } | undefined;
      fileNamePattern = passRules?.file_name_pattern ?? null;
    }

    const nameCheck = validateUploadFileName(file.name, expectedFileType, fileNamePattern);
    if (!nameCheck.ok) {
      return NextResponse.json({ error: nameCheck.error }, { status: 400 });
    }

    const mimeCheck = validateUploadMimeType(file.type || null, expectedFileType);
    if (!mimeCheck.ok) {
      return NextResponse.json({ error: mimeCheck.error }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `File exceeds ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB upload limit` },
        { status: 413 },
      );
    }
    const hash = sha256Buffer(buffer);
    const existingId = await findDuplicate(workflowId, hash);

    if (existingId) {
      await writeAudit({
        action: "duplicate_prevented",
        workflowId,
        fileId: existingId,
        details: { name: file.name, hash },
      });
      await notify({
        type: "duplicate_upload",
        title: "Duplicate upload blocked",
        message: `${file.name} matches an existing file for this workflow`,
        fileId: existingId,
        workflowId,
      });
      return NextResponse.json({ duplicate: true, existingId }, { status: 409 });
    }

    const inserted = await saveIngestedFile({
      workflowId,
      fileName: file.name,
      buffer,
      hash,
      mimeType: file.type || null,
      intakeSource: "upload",
    });

    if (!inserted) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });

    await writeAudit({
      action: "file_uploaded",
      fileId: inserted.id,
      workflowId,
      details: { name: file.name, size: buffer.length },
    });

    await notify({
      type: "file_received",
      title: "File uploaded",
      message: `${file.name} received for workflow ${wfName}`,
      fileId: inserted.id,
      workflowId,
    });

    scheduleValidationJob(inserted.id, runValidationForFile);
    return NextResponse.json({ file: inserted });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Upload failed";
    console.error("[api/files/upload]", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
