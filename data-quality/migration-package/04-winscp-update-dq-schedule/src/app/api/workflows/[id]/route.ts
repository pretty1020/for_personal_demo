import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireDqAuth } from "@/lib/api-guard";
import { DEFAULT_CHECKLIST_ITEMS } from "@/lib/workflows/defaults";
import { usesJson } from "@/lib/db";
import {
  mariadbDeleteWorkflow,
  mariadbGetWorkflowDetail,
  mariadbUpdateWorkflowFull,
  mergeClientNameIntoPassRules,
} from "@/lib/mariadb/repository";
import { mergeWorkflowMetaIntoPassRules } from "@/lib/workflow-meta";
import { standaloneDeleteWorkflowCascade, writeStandalone } from "@/lib/standalone/store";
import type { ChecklistItemRow, RequiredColumnRow, WorkflowRow } from "@/types/database";
import { z } from "zod";

const columnSchema = z.object({
  id: z.string().uuid().optional(),
  column_name: z.string().min(1),
  data_type: z.enum(["string", "number", "date", "category"]),
  is_required: z.boolean(),
  allowed_values: z.array(z.string()).optional().nullable(),
  pattern: z.string().optional().nullable(),
});

const checklistItemPatchSchema = z.object({
  id: z.string().uuid().optional(),
  item_key: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9_]+$/, "item_key must be lowercase letters, digits, and underscores"),
  label: z.string().min(1).max(500),
  is_critical: z.boolean(),
  sort_order: z.number().int(),
});

const patchSchema = z
  .object({
    name: z.string().min(2).optional(),
    client_name: z.string().max(255).optional().nullable(),
    status: z.enum(["active", "disabled"]).optional(),
    source_type: z.enum(["upload", "watched_folder", "simulated_path"]).optional(),
    source_path: z.string().optional().nullable(),
    expected_file_type: z.enum(["csv", "xlsx"]).optional(),
    destination_label: z.string().min(1).optional(),
    pass_rules: z.record(z.unknown()).optional(),
    columns: z.array(columnSchema).optional(),
    checklist_items: z.array(checklistItemPatchSchema).optional(),
  })
  .superRefine((val, ctx) => {
    if (!val.checklist_items?.length) return;
    const keys = val.checklist_items.map((i) => i.item_key);
    const seen = new Set<string>();
    for (const k of keys) {
      if (seen.has(k)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate checklist item_key: ${k}`,
          path: ["checklist_items"],
        });
        return;
      }
      seen.add(k);
    }
  });

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireDqAuth(request);
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;
  if (usesJson()) {
    const payload = await writeStandalone((s) => {
      const workflow = s.workflows.find((w) => w.id === id);
      if (!workflow) return null;
      let checklist = s.checklist_items.filter((c) => c.workflow_id === id).sort((a, b) => a.sort_order - b.sort_order);
      if (!checklist.length) {
        for (const c of DEFAULT_CHECKLIST_ITEMS) {
          const item: ChecklistItemRow = {
            id: randomUUID(),
            workflow_id: id,
            item_key: c.item_key,
            label: c.label,
            is_critical: c.is_critical,
            sort_order: c.sort_order,
          };
          s.checklist_items.push(item);
        }
        checklist = s.checklist_items.filter((c) => c.workflow_id === id).sort((a, b) => a.sort_order - b.sort_order);
      }
      const columns = s.required_columns.filter((c) => c.workflow_id === id).sort((a, b) => a.sort_order - b.sort_order);
      return { workflow, columns, checklist };
    });
    if (!payload) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(payload);
  }

  let detail = await mariadbGetWorkflowDetail(id);
  if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!detail.checklist.length) {
    const checklist: ChecklistItemRow[] = DEFAULT_CHECKLIST_ITEMS.map((c) => ({
      id: randomUUID(),
      workflow_id: id,
      item_key: c.item_key,
      label: c.label,
      is_critical: c.is_critical,
      sort_order: c.sort_order,
    }));
    await mariadbUpdateWorkflowFull({
      workflow: detail.workflow,
      columns: detail.columns,
      checklist,
    });
    detail = await mariadbGetWorkflowDetail(id);
    if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    workflow: detail.workflow,
    columns: detail.columns,
    checklist: detail.checklist,
  });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireDqAuth(req);
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const body = parsed.data;
  if (usesJson()) {
    const workflow = await writeStandalone((s) => {
      const wf = s.workflows.find((w) => w.id === id);
      if (!wf) return null;
      const now = new Date().toISOString();
      if (body.name !== undefined) wf.name = body.name;
      if (body.client_name !== undefined) wf.client_name = body.client_name?.trim() || null;
      if (body.status !== undefined) wf.status = body.status;
      if (body.source_type !== undefined) wf.source_type = body.source_type;
      if (body.source_path !== undefined) wf.source_path = body.source_path;
      if (body.expected_file_type !== undefined) wf.expected_file_type = body.expected_file_type;
      if (body.destination_label !== undefined) wf.destination_label = body.destination_label;
      if (body.pass_rules !== undefined || body.client_name !== undefined) {
        const base = body.pass_rules !== undefined ? body.pass_rules : wf.pass_rules;
        wf.pass_rules = mergeWorkflowMetaIntoPassRules(
          mergeClientNameIntoPassRules(base || {}, wf.client_name),
          {
            client_name: wf.client_name,
            upload_frequency:
              (base?.upload_frequency as "daily" | "weekly" | "monthly" | undefined) || undefined,
            allow_duplicates:
              typeof base?.allow_duplicates === "boolean" ? base.allow_duplicates : undefined,
            data_owners: Array.isArray(base?.data_owners) ? (base.data_owners as string[]) : undefined,
            file_name_pattern:
              typeof base?.file_name_pattern === "string" ? base.file_name_pattern : undefined,
            min_rows: typeof base?.min_rows === "number" ? base.min_rows : undefined,
          },
        );
      }
      wf.updated_at = now;
      if (body.columns) {
        s.required_columns = s.required_columns.filter((c) => c.workflow_id !== id);
        body.columns.forEach((c, idx) => {
          const col: RequiredColumnRow = {
            id: randomUUID(),
            workflow_id: id,
            column_name: c.column_name,
            data_type: c.data_type,
            is_required: c.is_required,
            allowed_values: c.allowed_values ?? null,
            pattern: c.pattern ?? null,
            sort_order: idx * 10,
            created_at: now,
          };
          s.required_columns.push(col);
        });
      }
      if (body.checklist_items) {
        s.checklist_items = s.checklist_items.filter((c) => c.workflow_id !== id);
        for (const c of body.checklist_items) {
          const item: ChecklistItemRow = {
            id: c.id ?? randomUUID(),
            workflow_id: id,
            item_key: c.item_key,
            label: c.label,
            is_critical: c.is_critical,
            sort_order: c.sort_order,
          };
          s.checklist_items.push(item);
        }
      }
      return wf;
    });
    if (!workflow) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ workflow });
  }

  const detail = await mariadbGetWorkflowDetail(id);
  if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const now = new Date().toISOString();
  const nextClientName =
    body.client_name !== undefined
      ? body.client_name?.trim() || null
      : detail.workflow.client_name;
  const basePass = body.pass_rules ?? detail.workflow.pass_rules;
  const nextPassRules = mergeWorkflowMetaIntoPassRules(
    mergeClientNameIntoPassRules(basePass || {}, nextClientName),
    {
      client_name: nextClientName,
      upload_frequency:
        (basePass?.upload_frequency as "daily" | "weekly" | "monthly" | undefined) || undefined,
      allow_duplicates:
        typeof basePass?.allow_duplicates === "boolean" ? basePass.allow_duplicates : undefined,
      data_owners: Array.isArray(basePass?.data_owners) ? (basePass.data_owners as string[]) : undefined,
      file_name_pattern:
        typeof basePass?.file_name_pattern === "string" ? basePass.file_name_pattern : undefined,
      min_rows: typeof basePass?.min_rows === "number" ? basePass.min_rows : undefined,
    },
  );
  const workflow: WorkflowRow = {
    ...detail.workflow,
    name: body.name ?? detail.workflow.name,
    client_name: nextClientName,
    status: body.status ?? detail.workflow.status,
    source_type: body.source_type ?? detail.workflow.source_type,
    source_path: body.source_path !== undefined ? body.source_path : detail.workflow.source_path,
    expected_file_type: body.expected_file_type ?? detail.workflow.expected_file_type,
    destination_label: body.destination_label ?? detail.workflow.destination_label,
    pass_rules: nextPassRules,
    updated_at: now,
  };

  let columns = detail.columns;
  if (body.columns) {
    columns = body.columns.map((c, idx) => ({
      id: c.id ?? randomUUID(),
      workflow_id: id,
      column_name: c.column_name,
      data_type: c.data_type,
      is_required: c.is_required,
      allowed_values: c.allowed_values ?? null,
      pattern: c.pattern ?? null,
      sort_order: idx * 10,
      created_at: now,
    }));
  }

  let checklist = detail.checklist;
  if (body.checklist_items) {
    checklist = body.checklist_items.map((c) => ({
      id: c.id ?? randomUUID(),
      workflow_id: id,
      item_key: c.item_key,
      label: c.label,
      is_critical: c.is_critical,
      sort_order: c.sort_order,
    }));
  }

  await mariadbUpdateWorkflowFull({ workflow, columns, checklist });
  return NextResponse.json({ workflow });
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireDqAuth(request);
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;
  if (usesJson()) {
    const ok = await writeStandalone((s) => {
      const wf = s.workflows.find((w) => w.id === id);
      if (!wf) return false;
      standaloneDeleteWorkflowCascade(s, id);
      return true;
    });
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  }
  const deleted = await mariadbDeleteWorkflow(id);
  if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
