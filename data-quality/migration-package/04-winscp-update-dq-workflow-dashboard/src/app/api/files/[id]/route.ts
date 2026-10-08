import { NextResponse } from "next/server";
import { requireDqAuth } from "@/lib/api-guard";
import { writeAudit } from "@/lib/audit";
import { usesJson } from "@/lib/db";
import { getFileDetail } from "@/lib/file-detail";
import { mariadbDeleteFile, mariadbGetFile } from "@/lib/mariadb/repository";
import { deleteStoredFile } from "@/lib/storage";
import { standaloneDeleteFileCascade, writeStandalone } from "@/lib/standalone/store";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireDqAuth(request);
  if ("error" in auth) return auth.error;

  const { id } = await ctx.params;
  const payload = await getFileDetail(id);
  if (!payload) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(payload);
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
      // Audit while the file still exists (standalone has no FK, but keep order consistent).
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

  // Audit BEFORE delete — audit_logs.file_id FK rejects inserts after the row is gone.
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
