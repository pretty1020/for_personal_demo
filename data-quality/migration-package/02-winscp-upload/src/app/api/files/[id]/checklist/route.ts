import { NextResponse } from "next/server";
import { requireBackend } from "@/lib/api-guard";
import { writeAudit } from "@/lib/audit";
import { usesJson } from "@/lib/db";
import {
  mariadbAcknowledgeChecklistItems,
  mariadbAcknowledgeWarnings,
  mariadbGetFile,
} from "@/lib/mariadb/repository";
import { readStandalone, writeStandalone } from "@/lib/standalone/store";
import { z } from "zod";

const bodySchema = z.object({
  acknowledgeWarnings: z.boolean().optional(),
  itemKeys: z.array(z.string().min(1)).optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = requireBackend();
  if (blocked) return blocked;
  const { id: fileId } = await ctx.params;
  const json = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  if (usesJson()) {
    const file = await readStandalone((s) => {
      const f = s.files.find((x) => x.id === fileId);
      if (!f) return null;
      return { metadata: f.metadata, workflow_id: f.workflow_id };
    });
    if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const runId = (file.metadata as { last_validation_run_id?: string })?.last_validation_run_id;
    if (!runId) return NextResponse.json({ error: "No validation run" }, { status: 400 });

    if (parsed.data.itemKeys?.length) {
      await writeStandalone((s) => {
        for (const r of s.checklist_results) {
          if (r.file_id === fileId && r.validation_run_id === runId && parsed.data.itemKeys!.includes(r.item_key)) {
            r.acknowledged = true;
            r.updated_at = new Date().toISOString();
          }
        }
      });
      await writeAudit({
        action: "checklist_reviewed",
        fileId,
        workflowId: file.workflow_id,
        details: { itemKeys: parsed.data.itemKeys },
      });
    }

    if (parsed.data.acknowledgeWarnings) {
      await writeStandalone((s) => {
        for (const r of s.checklist_results) {
          if (
            r.file_id === fileId &&
            r.validation_run_id === runId &&
            r.item_key === "warnings_acknowledged"
          ) {
            r.passed = true;
            r.acknowledged = true;
            r.updated_at = new Date().toISOString();
          }
        }
      });
      await writeAudit({
        action: "checklist_reviewed",
        fileId,
        workflowId: file.workflow_id,
        details: { acknowledgeWarnings: true },
      });
    }

    return NextResponse.json({ ok: true });
  }

  const file = await mariadbGetFile(fileId);
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const runId = (file.metadata as { last_validation_run_id?: string })?.last_validation_run_id;
  if (!runId) return NextResponse.json({ error: "No validation run" }, { status: 400 });

  if (parsed.data.itemKeys?.length) {
    const result = await mariadbAcknowledgeChecklistItems(fileId, parsed.data.itemKeys);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    await writeAudit({
      action: "checklist_reviewed",
      fileId,
      workflowId: file.workflow_id,
      details: { itemKeys: parsed.data.itemKeys },
    });
  }

  if (parsed.data.acknowledgeWarnings) {
    const result = await mariadbAcknowledgeWarnings(fileId);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    await writeAudit({
      action: "checklist_reviewed",
      fileId,
      workflowId: file.workflow_id,
      details: { acknowledgeWarnings: true },
    });
  }

  return NextResponse.json({ ok: true });
}
