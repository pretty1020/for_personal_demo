import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireDqAuth } from "@/lib/api-guard";
import { DEFAULT_CHECKLIST_ITEMS } from "@/lib/workflows/defaults";
import { usesJson } from "@/lib/db";
import { mariadbCreateWorkflow, mariadbListWorkflowsWithStats, mergeClientNameIntoPassRules } from "@/lib/mariadb/repository";
import { readStandalone, writeStandalone } from "@/lib/standalone/store";
import type { ChecklistItemRow, RequiredColumnRow, WorkflowRow } from "@/types/database";
import { mergeWorkflowMetaIntoPassRules } from "@/lib/workflow-meta";
import { z } from "zod";

const columnSchema = z.object({
  column_name: z.string().min(1),
  data_type: z.enum(["string", "number", "date", "category"]),
  is_required: z.boolean(),
  allowed_values: z.array(z.string()).optional().nullable(),
  pattern: z.string().optional().nullable(),
});

const checklistItemSchema = z.object({
  item_key: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9_]+$/, "item_key must be lowercase letters, digits, and underscores"),
  label: z.string().min(1).max(500),
  is_critical: z.boolean().optional().default(true),
  sort_order: z.number().int().optional(),
});

const createSchema = z.object({
  name: z.string().min(2),
  client_name: z.string().max(255).optional().nullable(),
  status: z.enum(["active", "disabled"]).optional(),
  source_type: z.enum(["upload", "watched_folder", "simulated_path"]),
  source_path: z.string().optional().nullable(),
  expected_file_type: z.enum(["csv", "xlsx"]),
  destination_label: z.string().min(1),
  upload_frequency: z.enum(["daily", "weekly", "monthly"]).optional(),
  allow_duplicates: z.boolean().optional(),
  data_owners: z.array(z.string()).optional(),
  pass_rules: z.record(z.unknown()).optional(),
  columns: z.array(columnSchema).default([]),
  checklist_items: z.array(checklistItemSchema).optional(),
});

export async function GET(req: Request) {
  const auth = await requireDqAuth(req);
  if ("error" in auth) return auth.error;
  if (usesJson()) {
    const enriched = await readStandalone((s) => {
      const workflows = [...s.workflows].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
      return workflows.map((w) => {
        const wfFiles = s.files.filter((f) => f.workflow_id === w.id);
        const total = wfFiles.length;
        const failed = wfFiles.filter((f) => f.status === "blocked" || f.status === "rejected").length;
        const lastRun = wfFiles.reduce<string | null>((acc, f) => {
          if (!acc || f.created_at > acc) return f.created_at;
          return acc;
        }, null);
        const success = wfFiles.filter((f) => f.status === "processed").length;
        const rate = total ? Math.round((success / total) * 100) : 0;
        return {
          ...w,
          stats: { total, failed, lastRun, successRate: rate },
        };
      });
    });
    return NextResponse.json({ workflows: enriched });
  }
  const workflows = await mariadbListWorkflowsWithStats();
  return NextResponse.json({ workflows });
}

export async function POST(req: Request) {
  const auth = await requireDqAuth(req);
  if ("error" in auth) return auth.error;
  const json = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const body = parsed.data;
  const clientName = body.client_name?.trim() || null;
  const pr = (body.pass_rules || {}) as Record<string, unknown>;
  const passRules = mergeWorkflowMetaIntoPassRules(
    mergeClientNameIntoPassRules(pr, clientName),
    {
      client_name: clientName,
      upload_frequency: body.upload_frequency ?? (pr.upload_frequency as "daily" | "weekly" | "monthly" | undefined) ?? "daily",
      allow_duplicates: body.allow_duplicates ?? Boolean(pr.allow_duplicates),
      data_owners: body.data_owners ?? (Array.isArray(pr.data_owners) ? (pr.data_owners as string[]) : []),
      file_name_pattern: typeof pr.file_name_pattern === "string" ? pr.file_name_pattern : null,
      min_rows: typeof pr.min_rows === "number" ? pr.min_rows : 1,
      sharepoint_url: typeof pr.sharepoint_url === "string" ? pr.sharepoint_url : null,
      require_yyyymmdd:
        typeof pr.require_yyyymmdd === "boolean" ? pr.require_yyyymmdd : true,
    },
  );
  const checklistDefs =
    body.checklist_items && body.checklist_items.length > 0
      ? body.checklist_items.map((c, idx) => ({
          item_key: c.item_key,
          label: c.label,
          is_critical: c.is_critical ?? true,
          sort_order: c.sort_order ?? (idx + 1) * 10,
        }))
      : DEFAULT_CHECKLIST_ITEMS;

  if (usesJson()) {
    const wf = await writeStandalone((s) => {
      const now = new Date().toISOString();
      const id = randomUUID();
      const row: WorkflowRow = {
        id,
        name: body.name,
        client_name: clientName,
        status: body.status ?? "active",
        source_type: body.source_type,
        source_path: body.source_path || null,
        expected_file_type: body.expected_file_type,
        destination_label: body.destination_label,
        pass_rules: passRules,
        created_at: now,
        updated_at: now,
      };
      s.workflows.push(row);
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
      for (const c of checklistDefs) {
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
      return row;
    });
    return NextResponse.json({ workflow: wf });
  }

  const now = new Date().toISOString();
  const id = randomUUID();
  const workflow: WorkflowRow = {
    id,
    name: body.name,
    client_name: clientName,
    status: body.status ?? "active",
    source_type: body.source_type,
    source_path: body.source_path || null,
    expected_file_type: body.expected_file_type,
    destination_label: body.destination_label,
    pass_rules: passRules,
    created_at: now,
    updated_at: now,
  };
  const columns: RequiredColumnRow[] = body.columns.map((c, idx) => ({
    id: randomUUID(),
    workflow_id: id,
    column_name: c.column_name,
    data_type: c.data_type,
    is_required: c.is_required,
    allowed_values: c.allowed_values ?? null,
    pattern: c.pattern ?? null,
    sort_order: idx * 10,
    created_at: now,
  }));
  const checklist: ChecklistItemRow[] = checklistDefs.map((c) => ({
    id: randomUUID(),
    workflow_id: id,
    item_key: c.item_key,
    label: c.label,
    is_critical: c.is_critical,
    sort_order: c.sort_order,
  }));

  await mariadbCreateWorkflow({ workflow, columns, checklist });
  return NextResponse.json({ workflow });
}
