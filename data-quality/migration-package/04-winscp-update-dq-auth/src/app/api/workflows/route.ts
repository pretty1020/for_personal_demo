import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireDqAuth } from "@/lib/api-guard";
import { DEFAULT_CHECKLIST_ITEMS } from "@/lib/workflows/defaults";
import { usesJson } from "@/lib/db";
import { mariadbCreateWorkflow, mariadbListWorkflowsWithStats } from "@/lib/mariadb/repository";
import { readStandalone, writeStandalone } from "@/lib/standalone/store";
import type { ChecklistItemRow, RequiredColumnRow, WorkflowRow } from "@/types/database";
import { z } from "zod";

const columnSchema = z.object({
  column_name: z.string().min(1),
  data_type: z.enum(["string", "number", "date", "category"]),
  is_required: z.boolean(),
  allowed_values: z.array(z.string()).optional().nullable(),
  pattern: z.string().optional().nullable(),
});

const createSchema = z.object({
  name: z.string().min(2),
  status: z.enum(["active", "disabled"]).optional(),
  source_type: z.enum(["upload", "watched_folder", "simulated_path"]),
  source_path: z.string().optional().nullable(),
  expected_file_type: z.enum(["csv", "xlsx"]),
  destination_label: z.string().min(1),
  pass_rules: z.record(z.unknown()).optional(),
  columns: z.array(columnSchema).default([]),
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
  if (usesJson()) {
    const wf = await writeStandalone((s) => {
      const now = new Date().toISOString();
      const id = randomUUID();
      const row: WorkflowRow = {
        id,
        name: body.name,
        status: body.status ?? "active",
        source_type: body.source_type,
        source_path: body.source_path || null,
        expected_file_type: body.expected_file_type,
        destination_label: body.destination_label,
        pass_rules: body.pass_rules ?? {},
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
      return row;
    });
    return NextResponse.json({ workflow: wf });
  }

  const now = new Date().toISOString();
  const id = randomUUID();
  const workflow: WorkflowRow = {
    id,
    name: body.name,
    status: body.status ?? "active",
    source_type: body.source_type,
    source_path: body.source_path || null,
    expected_file_type: body.expected_file_type,
    destination_label: body.destination_label,
    pass_rules: body.pass_rules ?? {},
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
  const checklist: ChecklistItemRow[] = DEFAULT_CHECKLIST_ITEMS.map((c) => ({
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
