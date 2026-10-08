import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type {
  AuditLogRow,
  ChecklistItemRow,
  FileRow,
  NotificationRow,
  RequiredColumnRow,
  WorkflowRow,
  WorkflowRuleRow,
} from "@/types/database";
import { DEFAULT_CHECKLIST_ITEMS } from "@/lib/workflows/defaults";
import { buildStandaloneSampleRecords } from "@/lib/standalone/sample-data";
import { standaloneStoreDir, standaloneStoreFile } from "@/lib/data-paths";

const storeDir = standaloneStoreDir();
const storeFile = standaloneStoreFile();

export type StandaloneStore = {
  workflows: WorkflowRow[];
  workflow_rules: WorkflowRuleRow[];
  required_columns: RequiredColumnRow[];
  checklist_items: ChecklistItemRow[];
  files: FileRow[];
  validation_runs: import("@/types/database").ValidationRunRow[];
  file_errors: import("@/types/database").FileErrorRow[];
  checklist_results: import("@/types/database").ChecklistResultRow[];
  audit_logs: AuditLogRow[];
  notifications: NotificationRow[];
};

let chain: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const p = chain.then(fn);
  chain = p.then(() => undefined).catch(() => undefined);
  return p;
}

function buildInitialStore(): StandaloneStore {
  const now = new Date().toISOString();
  const wfIds = [
    "a1000000-0000-4000-8000-000000000001",
    "a1000000-0000-4000-8000-000000000002",
    "a1000000-0000-4000-8000-000000000003",
    "a1000000-0000-4000-8000-000000000004",
    "a1000000-0000-4000-8000-000000000005",
  ] as const;

  const workflows: WorkflowRow[] = [
    {
      id: wfIds[0],
      name: "AT&T",
      status: "active",
      source_type: "upload",
      source_path: null,
      expected_file_type: "csv",
      destination_label: "ERP staging",
      pass_rules: { min_rows: 1 },
      created_at: now,
      updated_at: now,
    },
    {
      id: wfIds[1],
      name: "Fiserv",
      status: "active",
      source_type: "simulated_path",
      source_path: null,
      expected_file_type: "csv",
      destination_label: "Vendor master",
      pass_rules: { min_rows: 1 },
      created_at: now,
      updated_at: now,
    },
    {
      id: wfIds[2],
      name: "Toast",
      status: "active",
      source_type: "upload",
      source_path: null,
      expected_file_type: "csv",
      destination_label: "Kitchen exports",
      pass_rules: { min_rows: 1 },
      created_at: now,
      updated_at: now,
    },
    {
      id: wfIds[3],
      name: "Roadie",
      status: "disabled",
      source_type: "watched_folder",
      source_path: null,
      expected_file_type: "csv",
      destination_label: "Logistics archive",
      pass_rules: { min_rows: 1 },
      created_at: now,
      updated_at: now,
    },
    {
      id: wfIds[4],
      name: "SXM",
      status: "active",
      source_type: "upload",
      source_path: null,
      expected_file_type: "csv",
      destination_label: "Media ops",
      pass_rules: { min_rows: 1 },
      created_at: now,
      updated_at: now,
    },
  ];

  const required_columns: RequiredColumnRow[] = [
    {
      id: randomUUID(),
      workflow_id: wfIds[0],
      column_name: "order_id",
      data_type: "string",
      is_required: true,
      allowed_values: null,
      pattern: null,
      sort_order: 10,
      created_at: now,
    },
    {
      id: randomUUID(),
      workflow_id: wfIds[0],
      column_name: "amount",
      data_type: "number",
      is_required: true,
      allowed_values: null,
      pattern: null,
      sort_order: 20,
      created_at: now,
    },
    {
      id: randomUUID(),
      workflow_id: wfIds[0],
      column_name: "order_date",
      data_type: "date",
      is_required: true,
      allowed_values: null,
      pattern: null,
      sort_order: 30,
      created_at: now,
    },
    {
      id: randomUUID(),
      workflow_id: wfIds[0],
      column_name: "region",
      data_type: "category",
      is_required: true,
      allowed_values: ["North", "South", "East", "West"],
      pattern: null,
      sort_order: 40,
      created_at: now,
    },
    {
      id: randomUUID(),
      workflow_id: wfIds[1],
      column_name: "vendor_id",
      data_type: "number",
      is_required: true,
      allowed_values: null,
      pattern: null,
      sort_order: 10,
      created_at: now,
    },
    {
      id: randomUUID(),
      workflow_id: wfIds[1],
      column_name: "name",
      data_type: "string",
      is_required: true,
      allowed_values: null,
      pattern: null,
      sort_order: 20,
      created_at: now,
    },
    {
      id: randomUUID(),
      workflow_id: wfIds[1],
      column_name: "onboard_date",
      data_type: "date",
      is_required: true,
      allowed_values: null,
      pattern: null,
      sort_order: 30,
      created_at: now,
    },
    {
      id: randomUUID(),
      workflow_id: wfIds[1],
      column_name: "active",
      data_type: "category",
      is_required: true,
      allowed_values: ["true", "false"],
      pattern: null,
      sort_order: 40,
      created_at: now,
    },
    {
      id: randomUUID(),
      workflow_id: wfIds[2],
      column_name: "order_id",
      data_type: "string",
      is_required: true,
      allowed_values: null,
      pattern: null,
      sort_order: 10,
      created_at: now,
    },
    {
      id: randomUUID(),
      workflow_id: wfIds[2],
      column_name: "amount",
      data_type: "number",
      is_required: true,
      allowed_values: null,
      pattern: null,
      sort_order: 20,
      created_at: now,
    },
    {
      id: randomUUID(),
      workflow_id: wfIds[2],
      column_name: "order_date",
      data_type: "date",
      is_required: true,
      allowed_values: null,
      pattern: null,
      sort_order: 30,
      created_at: now,
    },
    {
      id: randomUUID(),
      workflow_id: wfIds[2],
      column_name: "region",
      data_type: "category",
      is_required: true,
      allowed_values: ["North", "South", "East", "West"],
      pattern: null,
      sort_order: 40,
      created_at: now,
    },
    {
      id: randomUUID(),
      workflow_id: wfIds[3],
      column_name: "order_id",
      data_type: "string",
      is_required: true,
      allowed_values: null,
      pattern: null,
      sort_order: 10,
      created_at: now,
    },
    {
      id: randomUUID(),
      workflow_id: wfIds[3],
      column_name: "amount",
      data_type: "number",
      is_required: true,
      allowed_values: null,
      pattern: null,
      sort_order: 20,
      created_at: now,
    },
    {
      id: randomUUID(),
      workflow_id: wfIds[3],
      column_name: "order_date",
      data_type: "date",
      is_required: true,
      allowed_values: null,
      pattern: null,
      sort_order: 30,
      created_at: now,
    },
    {
      id: randomUUID(),
      workflow_id: wfIds[3],
      column_name: "region",
      data_type: "category",
      is_required: true,
      allowed_values: ["North", "South", "East", "West"],
      pattern: null,
      sort_order: 40,
      created_at: now,
    },
    {
      id: randomUUID(),
      workflow_id: wfIds[4],
      column_name: "order_id",
      data_type: "string",
      is_required: true,
      allowed_values: null,
      pattern: null,
      sort_order: 10,
      created_at: now,
    },
    {
      id: randomUUID(),
      workflow_id: wfIds[4],
      column_name: "amount",
      data_type: "number",
      is_required: true,
      allowed_values: null,
      pattern: null,
      sort_order: 20,
      created_at: now,
    },
    {
      id: randomUUID(),
      workflow_id: wfIds[4],
      column_name: "order_date",
      data_type: "date",
      is_required: true,
      allowed_values: null,
      pattern: null,
      sort_order: 30,
      created_at: now,
    },
    {
      id: randomUUID(),
      workflow_id: wfIds[4],
      column_name: "region",
      data_type: "category",
      is_required: true,
      allowed_values: ["North", "South", "East", "West"],
      pattern: null,
      sort_order: 40,
      created_at: now,
    },
  ];

  const checklist_items: ChecklistItemRow[] = [];
  for (const wf of workflows) {
    for (const c of DEFAULT_CHECKLIST_ITEMS) {
      checklist_items.push({
        id: randomUUID(),
        workflow_id: wf.id,
        item_key: c.item_key,
        label: c.label,
        is_critical: c.is_critical,
        sort_order: c.sort_order,
      });
    }
  }

  const sample = buildStandaloneSampleRecords(new Date());
  return {
    workflows,
    workflow_rules: [],
    required_columns,
    checklist_items,
    files: sample.files,
    validation_runs: sample.validation_runs,
    file_errors: sample.file_errors,
    checklist_results: sample.checklist_results,
    audit_logs: sample.audit_logs,
    notifications: sample.notifications,
  };
}

async function loadUnlocked(): Promise<StandaloneStore> {
  await fs.mkdir(storeDir, { recursive: true });
  try {
    const raw = await fs.readFile(storeFile, "utf8");
    return JSON.parse(raw) as StandaloneStore;
  } catch {
    const initial = buildInitialStore();
    await fs.writeFile(storeFile, JSON.stringify(initial, null, 2), "utf8");
    return initial;
  }
}

async function saveUnlocked(store: StandaloneStore) {
  await fs.mkdir(storeDir, { recursive: true });
  await fs.writeFile(storeFile, JSON.stringify(store, null, 2), "utf8");
}

export async function readStandalone<T>(fn: (s: StandaloneStore) => T | Promise<T>): Promise<T> {
  return enqueue(async () => {
    const s = await loadUnlocked();
    return fn(s);
  });
}

export async function writeStandalone<T>(fn: (s: StandaloneStore) => T | Promise<T>): Promise<T> {
  return enqueue(async () => {
    const s = await loadUnlocked();
    const r = await fn(s);
    await saveUnlocked(s);
    return r;
  });
}

export async function standaloneWriteAudit(input: {
  action: string;
  fileId?: string | null;
  workflowId?: string | null;
  details?: Record<string, unknown>;
}) {
  await writeStandalone((s) => {
    const row: AuditLogRow = {
      id: randomUUID(),
      file_id: input.fileId ?? null,
      workflow_id: input.workflowId ?? null,
      action: input.action,
      details: input.details ?? {},
      created_at: new Date().toISOString(),
    };
    s.audit_logs.push(row);
  });
}

export async function standaloneAppendNotification(input: {
  type: string;
  title: string;
  message: string;
  fileId?: string | null;
  workflowId?: string | null;
}) {
  await writeStandalone((s) => {
    s.notifications.push({
      id: randomUUID(),
      type: input.type,
      title: input.title,
      message: input.message,
      read: false,
      file_id: input.fileId ?? null,
      workflow_id: input.workflowId ?? null,
      created_at: new Date().toISOString(),
    });
  });
}

export function standaloneListFilesWithWorkflowName(
  store: StandaloneStore,
  opts: { workflowId?: string | null; status?: string | null; limit: number },
) {
  let rows = [...store.files].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  if (opts.workflowId) rows = rows.filter((f) => f.workflow_id === opts.workflowId);
  if (opts.status) rows = rows.filter((f) => f.status === opts.status);
  rows = rows.slice(0, opts.limit);
  return rows.map((f) => {
    const wf = f.workflow_id ? store.workflows.find((w) => w.id === f.workflow_id) : undefined;
    return { ...f, workflows: wf ? { name: wf.name } : null };
  });
}

export function standaloneDeleteWorkflowCascade(store: StandaloneStore, workflowId: string) {
  store.workflows = store.workflows.filter((w) => w.id !== workflowId);
  store.workflow_rules = store.workflow_rules.filter((r) => r.workflow_id !== workflowId);
  store.required_columns = store.required_columns.filter((c) => c.workflow_id !== workflowId);
  store.checklist_items = store.checklist_items.filter((c) => c.workflow_id !== workflowId);
  const fileIds = new Set(store.files.filter((f) => f.workflow_id === workflowId).map((f) => f.id));
  store.files = store.files.filter((f) => f.workflow_id !== workflowId);
  const runIds = new Set(
    store.validation_runs.filter((r) => fileIds.has(r.file_id)).map((r) => r.id),
  );
  store.validation_runs = store.validation_runs.filter((r) => !fileIds.has(r.file_id));
  store.file_errors = store.file_errors.filter((e) => !runIds.has(e.validation_run_id));
  store.checklist_results = store.checklist_results.filter((c) => !fileIds.has(c.file_id));
  store.audit_logs = store.audit_logs.filter((a) => a.workflow_id !== workflowId && (!a.file_id || !fileIds.has(a.file_id)));
  store.notifications = store.notifications.filter(
    (n) => n.workflow_id !== workflowId && (!n.file_id || !fileIds.has(n.file_id)),
  );
}
