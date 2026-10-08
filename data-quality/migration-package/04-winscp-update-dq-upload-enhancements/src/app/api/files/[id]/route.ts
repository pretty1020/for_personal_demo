import { NextResponse } from "next/server";
import { requireDqAuth } from "@/lib/api-guard";
import { writeAudit } from "@/lib/audit";
import { usesJson } from "@/lib/db";
import { getFileDetail } from "@/lib/file-detail";
import { redactPrivatePreview, normalizeVisibility } from "@/lib/file-visibility";
import {
  mariadbDeleteFile,
  mariadbGetFile,
  mariadbUpdateFile,
} from "@/lib/mariadb/repository";
import { deleteStoredFile } from "@/lib/storage";
import { standaloneDeleteFileCascade, writeStandalone } from "@/lib/standalone/store";
import { z } from "zod";

const patchSchema = z.object({
  visibility: z.enum(["public", "private"]).optional(),
  sharepoint_uploaded: z.boolean().optional(),
});

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireDqAuth(request);
  if ("error" in auth) return auth.error;

  const { id } = await ctx.params;
  const payload = await getFileDetail(id);
  if (!payload) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const file = redactPrivatePreview(payload.file);
  return NextResponse.json({ ...payload, file });
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireDqAuth(request);
  if ("error" in auth) return auth.error;

  const { id } = await ctx.params;
  const json = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const body = parsed.data;
  const now = new Date().toISOString();

  if (usesJson()) {
    const updated = await writeStandalone((s) => {
      const file = s.files.find((f) => f.id === id);
      if (!file) return null;
      const meta = {
        ...(typeof file.metadata === "object" && file.metadata ? file.metadata : {}),
      };
      if (body.visibility !== undefined) {
        meta.visibility = normalizeVisibility(body.visibility);
      }
      if (body.sharepoint_uploaded === true) {
        meta.sharepoint_uploaded_at = now;
      } else if (body.sharepoint_uploaded === false) {
        delete meta.sharepoint_uploaded_at;
      }
      file.metadata = meta;
      file.updated_at = now;
      return { ...file };
    });
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (body.visibility !== undefined) {
      await writeAudit({
        action: "file_visibility_updated",
        fileId: id,
        workflowId: updated.workflow_id,
        details: { visibility: body.visibility },
      });
    }
    if (body.sharepoint_uploaded === true) {
      await writeAudit({
        action: "sharepoint_upload_marked",
        fileId: id,
        workflowId: updated.workflow_id,
        details: { at: now },
      });
    }
    return NextResponse.json({ file: redactPrivatePreview(updated) });
  }

  const existing = await mariadbGetFile(id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const meta = {
    ...(typeof existing.metadata === "object" && existing.metadata ? existing.metadata : {}),
  };
  if (body.visibility !== undefined) {
    meta.visibility = normalizeVisibility(body.visibility);
  }
  if (body.sharepoint_uploaded === true) {
    meta.sharepoint_uploaded_at = now;
  } else if (body.sharepoint_uploaded === false) {
    delete meta.sharepoint_uploaded_at;
  }
  await mariadbUpdateFile(id, { metadata: meta, updated_at: now });
  const file = { ...existing, metadata: meta, updated_at: now };

  if (body.visibility !== undefined) {
    await writeAudit({
      action: "file_visibility_updated",
      fileId: id,
      workflowId: existing.workflow_id,
      details: { visibility: body.visibility },
    });
  }
  if (body.sharepoint_uploaded === true) {
    await writeAudit({
      action: "sharepoint_upload_marked",
      fileId: id,
      workflowId: existing.workflow_id,
      details: { at: now },
    });
  }

  return NextResponse.json({ file: redactPrivatePreview(file) });
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireDqAuth(request);
  if ("error" in auth) return auth.error;

  const { id } = await ctx.params;

  if (usesJson()) {
    const result = await writeStandalone((s) => {
      const file = s.files.find((f) => f.id === id);
      if (!file) return null;
      const snapshot = { ...file };
      return snapshot;
    });
    if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await writeAudit({
      action: "file_deleted",
      fileId: id,
      workflowId: result.workflow_id,
      details: { original_name: result.original_name },
    });

    await writeStandalone((s) => {
      standaloneDeleteFileCascade(s, id);
      return true;
    });
    await deleteStoredFile(result.storage_path);
    return NextResponse.json({ ok: true });
  }

  const existing = await mariadbGetFile(id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await writeAudit({
    action: "file_deleted",
    fileId: id,
    workflowId: existing.workflow_id,
    details: { original_name: existing.original_name },
  });

  const deleted = await mariadbDeleteFile(id);
  if (!deleted.ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (deleted.storagePath) await deleteStoredFile(deleted.storagePath);
  return NextResponse.json({ ok: true });
}
