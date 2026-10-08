import { randomUUID } from "node:crypto";
import type { PoolConnection, ResultSetHeader } from "mysql2/promise";
import { withMariaDb, withMariaDbTransaction, type MariaDbRow } from "@/lib/mariadb/pool";
import { summarizeChecklistResults } from "@/lib/checklist-eval";
import { summarizeBlockingReasons } from "@/lib/reports/failure-reasons";
import { formatFileStatus } from "@/components/status-badge";
import type {
  AuditLogRow,
  ChecklistItemRow,
  ChecklistResultRow,
  FileErrorRow,
  FileRow,
  NotificationRow,
  RequiredColumnRow,
  ValidationRunRow,
  WorkflowRow,
} from "@/types/database";

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "object") return value as T;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

/** Format ISO timestamps for MariaDB DATETIME(3) (UTC). */
function toSqlDateTime(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return value.replace("T", " ").replace(/Z$/i, "").slice(0, 23);
  }
  const p = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)}`;
}

/** Read DATETIME/TIMESTAMP values as UTC ISO strings. */
function fromSqlDateTime(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const s = String(value).trim();
  if (!s) return new Date(0).toISOString();
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) || s.includes("T")) {
    return new Date(s).toISOString();
  }
  return new Date(`${s.replace(" ", "T")}Z`).toISOString();
}

function bool(v: unknown) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v === "1" || v.toLowerCase() === "true";
  if (Buffer.isBuffer(v)) return v.length > 0 && v[0] !== 0;
  return Boolean(v);
}

function resolveClientName(row: MariaDbRow, passRules: Record<string, unknown>): string | null {
  if (row.client_name != null && String(row.client_name).trim()) {
    return String(row.client_name).trim();
  }
  const fromRules = passRules.client_name;
  if (typeof fromRules === "string" && fromRules.trim()) return fromRules.trim();
  return null;
}

/** Keep client_name in pass_rules so Dashboard works even before 021 ALTER runs. */
export function mergeClientNameIntoPassRules(
  passRules: Record<string, unknown>,
  clientName: string | null | undefined,
): Record<string, unknown> {
  const next = { ...passRules };
  const trimmed = typeof clientName === "string" ? clientName.trim() : "";
  if (trimmed) next.client_name = trimmed;
  else delete next.client_name;
  return next;
}

function mapWorkflow(row: MariaDbRow): WorkflowRow {
  const pass_rules = parseJson<Record<string, unknown>>(row.pass_rules, {});
  return {
    id: String(row.id),
    name: String(row.name),
    client_name: resolveClientName(row, pass_rules),
    status: row.status as WorkflowRow["status"],
    source_type: row.source_type as WorkflowRow["source_type"],
    source_path: row.source_path ? String(row.source_path) : null,
    expected_file_type: row.expected_file_type as WorkflowRow["expected_file_type"],
    destination_label: String(row.destination_label),
    pass_rules,
    created_at: fromSqlDateTime(row.created_at),
    updated_at: fromSqlDateTime(row.updated_at),
  };
}

function mapFile(row: MariaDbRow): FileRow {
  return {
    id: String(row.id),
    workflow_id: row.workflow_id ? String(row.workflow_id) : null,
    original_name: String(row.original_name),
    storage_path: String(row.storage_path),
    file_hash: String(row.file_hash),
    mime_type: row.mime_type ? String(row.mime_type) : null,
    size_bytes: Number(row.size_bytes),
    intake_source: row.intake_source as FileRow["intake_source"],
    status: row.status as FileRow["status"],
    metadata: parseJson(row.metadata, {}),
    processed_at: row.processed_at ? fromSqlDateTime(row.processed_at) : null,
    created_at: fromSqlDateTime(row.created_at),
    updated_at: fromSqlDateTime(row.updated_at),
  };
}

function mapRequiredColumn(row: MariaDbRow): RequiredColumnRow {
  return {
    id: String(row.id),
    workflow_id: String(row.workflow_id),
    column_name: String(row.column_name),
    data_type: row.data_type as RequiredColumnRow["data_type"],
    is_required: bool(row.is_required),
    allowed_values: parseJson<string[] | null>(row.allowed_values, null),
    pattern: row.pattern ? String(row.pattern) : null,
    sort_order: Number(row.sort_order),
    created_at: fromSqlDateTime(row.created_at),
  };
}

function mapChecklistItem(row: MariaDbRow): ChecklistItemRow {
  return {
    id: String(row.id),
    workflow_id: String(row.workflow_id),
    item_key: String(row.item_key),
    label: String(row.label),
    is_critical: bool(row.is_critical),
    sort_order: Number(row.sort_order),
  };
}

function mapChecklistResult(row: MariaDbRow): ChecklistResultRow {
  return {
    id: String(row.id),
    file_id: String(row.file_id),
    validation_run_id: String(row.validation_run_id),
    item_key: String(row.item_key),
    passed: bool(row.passed),
    acknowledged: bool(row.acknowledged),
    updated_at: fromSqlDateTime(row.updated_at),
  };
}

function mapValidationRun(row: MariaDbRow): ValidationRunRow {
  return {
    id: String(row.id),
    file_id: String(row.file_id),
    started_at: fromSqlDateTime(row.started_at),
    completed_at: row.completed_at ? fromSqlDateTime(row.completed_at) : null,
    passed: bool(row.passed),
    can_proceed: bool(row.can_proceed),
    summary: parseJson(row.summary, {}),
    structure_result: parseJson(row.structure_result, {}) as ValidationRunRow["structure_result"],
    data_quality_result: parseJson(row.data_quality_result, {}) as ValidationRunRow["data_quality_result"],
    pivot_detection: parseJson(row.pivot_detection, {}) as ValidationRunRow["pivot_detection"],
  };
}

function mapFileError(row: MariaDbRow): FileErrorRow {
  return {
    id: String(row.id),
    validation_run_id: String(row.validation_run_id),
    severity: row.severity as FileErrorRow["severity"],
    code: String(row.code),
    message: String(row.message),
    row_index: row.row_index != null ? Number(row.row_index) : null,
    column_name: row.column_name ? String(row.column_name) : null,
    details: parseJson(row.details, {}),
    created_at: fromSqlDateTime(row.created_at),
  };
}

async function mariadbGetRequiredColumnsConn(conn: PoolConnection, workflowId: string) {
  const [rows] = await conn.query<MariaDbRow[]>(
    "SELECT * FROM required_columns WHERE workflow_id = ? ORDER BY sort_order ASC",
    [workflowId],
  );
  return rows.map(mapRequiredColumn);
}

async function mariadbGetChecklistItemsConn(conn: PoolConnection, workflowId: string) {
  const [rows] = await conn.query<MariaDbRow[]>(
    "SELECT * FROM checklist_items WHERE workflow_id = ? ORDER BY sort_order ASC",
    [workflowId],
  );
  return rows.map(mapChecklistItem);
}

export async function mariadbGetFileConn(conn: PoolConnection, fileId: string) {
  const [rows] = await conn.query<MariaDbRow[]>("SELECT * FROM files WHERE id = ? LIMIT 1", [fileId]);
  return rows[0] ? mapFile(rows[0]) : null;
}

export async function mariadbFindDuplicate(workflowId: string, hash: string) {
  return withMariaDb(async (conn) => {
    const [rows] = await conn.query<MariaDbRow[]>(
      "SELECT id FROM files WHERE workflow_id = ? AND file_hash = ? LIMIT 1",
      [workflowId, hash],
    );
    return rows[0]?.id ? String(rows[0].id) : null;
  });
}

export async function mariadbGetWorkflow(workflowId: string) {
  return withMariaDb(async (conn) => {
    const [rows] = await conn.query<MariaDbRow[]>("SELECT * FROM workflows WHERE id = ? LIMIT 1", [workflowId]);
    return rows[0] ? mapWorkflow(rows[0]) : null;
  });
}

export async function mariadbGetRequiredColumns(workflowId: string) {
  return withMariaDb(async (conn) => mariadbGetRequiredColumnsConn(conn, workflowId));
}

export async function mariadbGetChecklistItems(workflowId: string) {
  return withMariaDb(async (conn) => mariadbGetChecklistItemsConn(conn, workflowId));
}

export async function mariadbGetFile(fileId: string) {
  return withMariaDb(async (conn) => mariadbGetFileConn(conn, fileId));
}

export async function mariadbInsertFile(row: FileRow) {
  return withMariaDb(async (conn) => {
    await conn.query(
      `INSERT INTO files (id, workflow_id, original_name, storage_path, file_hash, mime_type, size_bytes, intake_source, status, metadata, processed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.workflow_id,
        row.original_name,
        row.storage_path,
        row.file_hash,
        row.mime_type,
        row.size_bytes,
        row.intake_source,
        row.status,
        JSON.stringify(row.metadata),
        toSqlDateTime(row.processed_at),
        toSqlDateTime(row.created_at),
        toSqlDateTime(row.updated_at),
      ],
    );
    return row;
  });
}

export async function mariadbUpdateFile(
  fileId: string,
  patch: Partial<Pick<FileRow, "status" | "metadata" | "processed_at" | "updated_at">>,
) {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.status !== undefined) {
    sets.push("status = ?");
    vals.push(patch.status);
  }
  if (patch.metadata !== undefined) {
    sets.push("metadata = ?");
    vals.push(JSON.stringify(patch.metadata));
  }
  if (patch.processed_at !== undefined) {
    sets.push("processed_at = ?");
    vals.push(toSqlDateTime(patch.processed_at));
  }
  if (patch.updated_at !== undefined) {
    sets.push("updated_at = ?");
    vals.push(toSqlDateTime(patch.updated_at));
  }
  if (!sets.length) return;
  vals.push(fileId);
  await withMariaDb(async (conn) => {
    await conn.query(`UPDATE files SET ${sets.join(", ")} WHERE id = ?`, vals);
  });
}

export async function mariadbInsertValidationRun(
  run: Omit<ValidationRunRow, "started_at"> & { started_at?: string },
) {
  const id = run.id || randomUUID();
  const started = run.started_at || new Date().toISOString();
  await withMariaDb(async (conn) => {
    await conn.query(
      `INSERT INTO validation_runs (id, file_id, started_at, completed_at, passed, can_proceed, summary, structure_result, data_quality_result, pivot_detection)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        run.file_id,
        toSqlDateTime(started),
        toSqlDateTime(run.completed_at),
        run.passed ? 1 : 0,
        run.can_proceed ? 1 : 0,
        JSON.stringify(run.summary),
        JSON.stringify(run.structure_result),
        JSON.stringify(run.data_quality_result),
        JSON.stringify(run.pivot_detection),
      ],
    );
  });
  return id;
}

export async function mariadbInsertFileErrors(errors: Array<Omit<FileErrorRow, "id" | "created_at">>) {
  if (!errors.length) return;
  await withMariaDb(async (conn) => {
    for (const e of errors) {
      await conn.query(
        `INSERT INTO file_errors (id, validation_run_id, severity, code, message, row_index, column_name, details)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(),
          e.validation_run_id,
          e.severity,
          e.code,
          e.message,
          e.row_index ?? null,
          e.column_name ?? null,
          JSON.stringify(e.details ?? {}),
        ],
      );
    }
  });
}

export async function mariadbInsertChecklistResults(
  rows: Array<Omit<ChecklistResultRow, "id" | "updated_at">>,
) {
  if (!rows.length) return;
  await withMariaDb(async (conn) => {
    for (const r of rows) {
      await conn.query(
        `INSERT INTO checklist_results (id, file_id, validation_run_id, item_key, passed, acknowledged)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(),
          r.file_id,
          r.validation_run_id,
          r.item_key,
          r.passed ? 1 : 0,
          r.acknowledged ? 1 : 0,
        ],
      );
    }
  });
}

export async function mariadbWriteAudit(input: {
  action: string;
  fileId?: string | null;
  workflowId?: string | null;
  details?: Record<string, unknown>;
}) {
  await withMariaDb(async (conn) => {
    await conn.query(
      "INSERT INTO audit_logs (id, file_id, workflow_id, action, details) VALUES (?, ?, ?, ?, ?)",
      [
        randomUUID(),
        input.fileId ?? null,
        input.workflowId ?? null,
        input.action,
        JSON.stringify(input.details ?? {}),
      ],
    );
  });
}

export async function mariadbNotify(input: {
  type: string;
  title: string;
  message: string;
  fileId?: string | null;
  workflowId?: string | null;
}) {
  await withMariaDb(async (conn) => {
    await conn.query(
      "INSERT INTO notifications (id, type, title, message, `read`, file_id, workflow_id) VALUES (?, ?, ?, ?, 0, ?, ?)",
      [randomUUID(), input.type, input.title, input.message, input.fileId ?? null, input.workflowId ?? null],
    );
  });
}

export async function mariadbGetChecklistGateData(fileId: string) {
  return withMariaDb(async (conn) => {
    const file = await mariadbGetFileConn(conn, fileId);
    if (!file) return null;
    const meta = file.metadata as { last_validation_run_id?: string };
    const runId = meta.last_validation_run_id;
    if (!runId || !file.workflow_id) {
      // hasRun keeps "no validation run yet" distinct from "this workflow defines
      // no checklist items". Both yield an empty defs list but must gate opposite
      // ways, and collapsing them auto-rejected files that had actually passed.
      return {
        file,
        hasRun: false,
        defs: [] as ChecklistItemRow[],
        results: [] as ChecklistResultRow[],
      };
    }

    const defs = await mariadbGetChecklistItemsConn(conn, file.workflow_id);
    const [resRows] = await conn.query<MariaDbRow[]>(
      "SELECT * FROM checklist_results WHERE file_id = ? AND validation_run_id = ?",
      [fileId, runId],
    );
    return {
      file,
      hasRun: true,
      defs,
      results: resRows.map(mapChecklistResult),
    };
  });
}

export async function mariadbAcknowledgeChecklistItems(fileId: string, itemKeys: string[]) {
  if (!itemKeys.length) {
    return { ok: false as const, error: "No checklist items specified" };
  }
  return withMariaDbTransaction(async (conn) => {
    const file = await mariadbGetFileConn(conn, fileId);
    if (!file) return { ok: false as const, error: "File not found" };
    // Rows are unique per (file_id, validation_run_id, item_key). Without the run
    // filter this also acknowledges every earlier run, rewriting review history.
    const runId = (file.metadata as { last_validation_run_id?: string })?.last_validation_run_id;
    if (!runId) return { ok: false as const, error: "No validation run" };

    const placeholders = itemKeys.map(() => "?").join(",");
    await conn.query(
      `UPDATE checklist_results SET acknowledged = 1
        WHERE file_id = ? AND validation_run_id = ? AND item_key IN (${placeholders})`,
      [fileId, runId, ...itemKeys],
    );

    const refreshed = await mariadbGetFileConn(conn, fileId);
    return { ok: true as const, file: refreshed ?? file };
  });
}

export async function mariadbAcknowledgeWarnings(fileId: string) {
  return withMariaDbTransaction(async (conn) => {
    const file = await mariadbGetFileConn(conn, fileId);
    if (!file) return { ok: false as const, error: "File not found" };
    const runId = (file.metadata as { last_validation_run_id?: string })?.last_validation_run_id;
    if (!runId) return { ok: false as const, error: "No validation run" };

    await conn.query(
      "UPDATE checklist_results SET passed = 1, acknowledged = 1 WHERE file_id = ? AND validation_run_id = ? AND item_key = ?",
      [fileId, runId, "warnings_acknowledged"],
    );
    const refreshed = await mariadbGetFileConn(conn, fileId);
    return { ok: true as const, file: refreshed ?? file };
  });
}

export async function mariadbGetReportsPayload(opts: { workflowId: string | null; limit: number }) {
  return withMariaDb(async (conn) => {
    const limit = opts.limit;
    const [runRows] = await conn.query<MariaDbRow[]>(
      `SELECT vr.*, f.id AS f_id, f.original_name, f.workflow_id, f.status, f.metadata, f.processed_at, f.created_at AS f_created
       FROM validation_runs vr
       JOIN files f ON f.id = vr.file_id
       ORDER BY vr.started_at DESC
       LIMIT ?`,
      [limit],
    );

    const runs = [];
    for (const row of runRows) {
      const wfId = row.workflow_id ? String(row.workflow_id) : null;
      if (opts.workflowId && wfId !== opts.workflowId) continue;

      const runId = String(row.id);
      const fileId = String(row.file_id);
      const [errRows] = await conn.query<MariaDbRow[]>(
        "SELECT validation_run_id, code, message, severity FROM file_errors WHERE validation_run_id = ?",
        [runId],
      );

      let checklistSummary: string | null = null;
      if (wfId) {
        const [defs] = await conn.query<MariaDbRow[]>(
          "SELECT item_key, label, is_critical FROM checklist_items WHERE workflow_id = ?",
          [wfId],
        );
        const [clRows] = await conn.query<MariaDbRow[]>(
          "SELECT item_key, passed, acknowledged FROM checklist_results WHERE file_id = ? AND validation_run_id = ?",
          [fileId, runId],
        );
        checklistSummary = summarizeChecklistResults(
          defs.map((d) => ({
            item_key: String(d.item_key),
            label: String(d.label),
            is_critical: bool(d.is_critical),
          })),
          clRows.map((r) => ({
            item_key: String(r.item_key),
            passed: bool(r.passed),
            acknowledged: bool(r.acknowledged),
          })),
        );
      }

      const fileMeta = parseJson(row.metadata, {}) as Record<string, unknown>;
      const failure_reasons = summarizeBlockingReasons(
        runId,
        bool(row.passed),
        errRows.map((e) => ({
          validation_run_id: String(e.validation_run_id),
          code: String(e.code),
          message: String(e.message),
          severity: String(e.severity),
        })),
        { status: String(row.status), metadata: fileMeta },
        checklistSummary,
      );

      runs.push({
        id: runId,
        file_id: fileId,
        passed: bool(row.passed),
        started_at: fromSqlDateTime(row.started_at),
        failure_reasons,
        checklist_summary: checklistSummary,
        files: {
          id: fileId,
          original_name: String(row.original_name),
          workflow_id: wfId,
          status: String(row.status),
          status_display: formatFileStatus(String(row.status)),
        },
      });
    }

    const [fileList] = await conn.query<MariaDbRow[]>(
      "SELECT id, original_name, workflow_id, status, metadata, processed_at, created_at FROM files ORDER BY created_at DESC LIMIT 500",
    );
    const filtered = opts.workflowId
      ? fileList.filter((f) => String(f.workflow_id) === opts.workflowId)
      : fileList;

    const processedFiles = filtered
      .filter((f) => f.status === "processed")
      .slice(0, 150)
      .map((f) => ({
        id: String(f.id),
        original_name: String(f.original_name),
        workflow_id: f.workflow_id ? String(f.workflow_id) : null,
        processed_at: f.processed_at ? fromSqlDateTime(f.processed_at) : null,
      }));

    const failedStatuses = new Set(["blocked", "rejected", "duplicate_blocked"]);
    const failedFiles = filtered
      .filter((f) => failedStatuses.has(String(f.status)))
      .slice(0, 200)
      .map((f) => {
        const meta = parseJson(f.metadata, {}) as Record<string, unknown>;
        return {
          id: String(f.id),
          original_name: String(f.original_name),
          workflow_id: f.workflow_id ? String(f.workflow_id) : null,
          status: String(f.status),
          status_display: formatFileStatus(String(f.status)),
          detail: typeof meta.rejection_reason === "string" ? meta.rejection_reason : null,
        };
      });

    return { runs: runs.slice(0, limit), processedFiles, failedFiles };
  });
}

export async function mariadbListNotifications(limit = 50) {
  return withMariaDb(async (conn) => {
    const [rows] = await conn.query<MariaDbRow[]>(
      "SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?",
      [limit],
    );
    return rows.map(
      (r): NotificationRow => ({
        id: String(r.id),
        type: String(r.type),
        title: String(r.title),
        message: String(r.message),
        read: bool(r.read),
        file_id: r.file_id ? String(r.file_id) : null,
        workflow_id: r.workflow_id ? String(r.workflow_id) : null,
        created_at: fromSqlDateTime(r.created_at),
      }),
    );
  });
}

export async function mariadbMarkNotificationsRead(markAllRead: boolean, ids?: string[]) {
  await withMariaDb(async (conn) => {
    if (markAllRead) {
      await conn.query("UPDATE notifications SET `read` = 1 WHERE `read` = 0");
      return;
    }
    if (ids?.length) {
      const placeholders = ids.map(() => "?").join(",");
      await conn.query(`UPDATE notifications SET \`read\` = 1 WHERE id IN (${placeholders})`, ids);
    }
  });
}

export async function mariadbListAuditLogs(limit = 200) {
  return withMariaDb(async (conn) => {
    const [rows] = await conn.query<MariaDbRow[]>(
      "SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?",
      [limit],
    );
    return rows.map(
      (r): AuditLogRow => ({
        id: String(r.id),
        file_id: r.file_id ? String(r.file_id) : null,
        workflow_id: r.workflow_id ? String(r.workflow_id) : null,
        action: String(r.action),
        details: parseJson(r.details, {}),
        created_at: fromSqlDateTime(r.created_at),
      }),
    );
  });
}

export async function mariadbListFiles(opts: {
  workflowId?: string | null;
  status?: string | null;
  limit: number;
}) {
  return withMariaDb(async (conn) => {
    let sql =
      "SELECT f.*, w.name AS workflow_name FROM files f LEFT JOIN workflows w ON w.id = f.workflow_id WHERE 1=1";
    const params: unknown[] = [];
    if (opts.workflowId) {
      sql += " AND f.workflow_id = ?";
      params.push(opts.workflowId);
    }
    if (opts.status) {
      sql += " AND f.status = ?";
      params.push(opts.status);
    }
    sql += " ORDER BY f.created_at DESC LIMIT ?";
    params.push(opts.limit);
    const [rows] = await conn.query<MariaDbRow[]>(sql, params);
    return rows.map((r) => ({
      ...mapFile(r),
      workflows: r.workflow_name ? { name: String(r.workflow_name) } : null,
    }));
  });
}

export async function mariadbUpdateChecklistResultGateError(_fileId: string, runId: string, message: string) {
  await withMariaDb(async (conn) => {
    await conn.query(
      `INSERT INTO file_errors (id, validation_run_id, severity, code, message)
       VALUES (?, ?, 'error', 'CHECKLIST_GATE', ?)`,
      [randomUUID(), runId, message],
    );
  });
}

export async function mariadbGetFileMetadata(fileId: string) {
  const file = await mariadbGetFile(fileId);
  return file?.metadata ?? {};
}

export async function mariadbDeleteWorkflow(workflowId: string): Promise<boolean> {
  return withMariaDbTransaction(async (conn) => {
    // files.workflow_id is ON DELETE SET NULL, so dropping the workflow alone would
    // leave detached file rows that still surface in listings and reports. The JSON
    // backend cascades here, so remove the files first to keep both backends equal.
    // validation_runs, file_errors and checklist_results cascade off files; audit_logs
    // and notifications keep their rows with a NULL reference, preserving the trail.
    await conn.query("DELETE FROM files WHERE workflow_id = ?", [workflowId]);
    const [result] = await conn.query<ResultSetHeader>("DELETE FROM workflows WHERE id = ?", [workflowId]);
    return result.affectedRows > 0;
  });
}

export async function mariadbListWorkflowsWithStats() {
  return withMariaDb(async (conn) => {
    const [wfs] = await conn.query<MariaDbRow[]>("SELECT * FROM workflows ORDER BY updated_at DESC");
    const result = [];
    for (const wf of wfs) {
      const id = String(wf.id);
      const [fileRows] = await conn.query<MariaDbRow[]>(
        "SELECT id, status, created_at FROM files WHERE workflow_id = ?",
        [id],
      );
      const total = fileRows.length;
      const failed = fileRows.filter((f) => f.status === "blocked" || f.status === "rejected").length;
      const success = fileRows.filter((f) => f.status === "processed").length;
      const lastRun = fileRows.reduce<string | null>((acc, f) => {
        const c = fromSqlDateTime(f.created_at);
        if (!acc || c > acc) return c;
        return acc;
      }, null);
      const rate = total ? Math.round((success / total) * 100) : 0;
      result.push({
        ...mapWorkflow(wf),
        stats: { total, failed, lastRun, successRate: rate },
      });
    }
    return result;
  });
}

export async function mariadbGetFileDetailPayload(fileId: string) {
  return withMariaDb(async (conn) => {
    const file = await mariadbGetFileConn(conn, fileId);
    if (!file) return null;

    let wf: WorkflowRow | null = null;
    if (file.workflow_id) {
      const [wfRows] = await conn.query<MariaDbRow[]>("SELECT * FROM workflows WHERE id = ? LIMIT 1", [
        file.workflow_id,
      ]);
      wf = wfRows[0] ? mapWorkflow(wfRows[0]) : null;
    }

    const meta = file.metadata as { last_validation_run_id?: string };
    const runId = meta.last_validation_run_id;

    let run: ValidationRunRow | null = null;
    let errors: FileErrorRow[] = [];
    let checklist: ChecklistResultRow[] = [];
    let defs: ChecklistItemRow[] = [];

    if (runId) {
      const [runRows] = await conn.query<MariaDbRow[]>(
        "SELECT * FROM validation_runs WHERE id = ? LIMIT 1",
        [runId],
      );
      if (runRows[0]) {
        run = mapValidationRun(runRows[0]);
      }
      const [errRows] = await conn.query<MariaDbRow[]>(
        "SELECT * FROM file_errors WHERE validation_run_id = ? ORDER BY created_at ASC LIMIT 500",
        [runId],
      );
      errors = errRows.map(mapFileError);
      const [clRows] = await conn.query<MariaDbRow[]>(
        "SELECT * FROM checklist_results WHERE file_id = ? AND validation_run_id = ?",
        [fileId, runId],
      );
      checklist = clRows.map(mapChecklistResult);
    }

    if (file.workflow_id) {
      defs = await mariadbGetChecklistItemsConn(conn, file.workflow_id);
    }

    const [auditRows] = await conn.query<MariaDbRow[]>(
      "SELECT * FROM audit_logs WHERE file_id = ? ORDER BY created_at DESC LIMIT 100",
      [fileId],
    );
    const audit = auditRows.map(
      (a): AuditLogRow => ({
        id: String(a.id),
        file_id: a.file_id ? String(a.file_id) : null,
        workflow_id: a.workflow_id ? String(a.workflow_id) : null,
        action: String(a.action),
        details: parseJson(a.details, {}),
        created_at: fromSqlDateTime(a.created_at),
      }),
    );

    return { file, workflow: wf, validationRun: run, errors, checklist, checklistDefs: defs, audit };
  });
}

export async function mariadbListFilesForDashboard(filters: {
  workflowId?: string | null;
  status?: string | null;
  from?: string | null;
  to?: string | null;
}) {
  return withMariaDb(async (conn) => {
    let sql =
      "SELECT id, original_name, status, workflow_id, created_at, processed_at, intake_source FROM files WHERE 1=1";
    const params: unknown[] = [];
    if (filters.workflowId) {
      sql += " AND workflow_id = ?";
      params.push(filters.workflowId);
    }
    if (filters.status) {
      sql += " AND status = ?";
      params.push(filters.status);
    }
    if (filters.from) {
      sql += " AND created_at >= ?";
      params.push(toSqlDateTime(filters.from));
    }
    if (filters.to) {
      sql += " AND created_at <= ?";
      params.push(toSqlDateTime(filters.to));
    }
    sql += " ORDER BY created_at DESC LIMIT 5000";
    const [files] = await conn.query<MariaDbRow[]>(sql, params);

    const [dupRows] = await conn.query<MariaDbRow[]>(
      "SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'duplicate_prevented'",
    );
    const dupAudit = Number(dupRows[0]?.c ?? 0);
    const [errRows] = await conn.query<MariaDbRow[]>("SELECT code, severity FROM file_errors LIMIT 2000");
    const [wfs] = await conn.query<MariaDbRow[]>("SELECT * FROM workflows");

    return {
      files: files.map((f) => ({
        id: String(f.id),
        original_name: String(f.original_name),
        status: String(f.status),
        workflow_id: f.workflow_id ? String(f.workflow_id) : null,
        created_at: fromSqlDateTime(f.created_at),
        processed_at: f.processed_at ? fromSqlDateTime(f.processed_at) : null,
        intake_source: String(f.intake_source),
      })),
      dupAudit,
      errRows: errRows.map((e) => ({ code: String(e.code), severity: String(e.severity) })),
      workflows: wfs.map((w) => {
        const mapped = mapWorkflow(w);
        return {
          id: mapped.id,
          name: mapped.name,
          client_name: mapped.client_name,
          status: mapped.status,
          pass_rules: mapped.pass_rules,
        };
      }),
    };
  });
}

export async function mariadbDeleteFile(fileId: string): Promise<{ ok: boolean; storagePath?: string }> {
  return withMariaDbTransaction(async (conn) => {
    const [rows] = await conn.query<MariaDbRow[]>("SELECT storage_path FROM files WHERE id = ? LIMIT 1", [fileId]);
    if (!rows[0]) return { ok: false };
    const storagePath = String(rows[0].storage_path);
    const [runRows] = await conn.query<MariaDbRow[]>("SELECT id FROM validation_runs WHERE file_id = ?", [fileId]);
    const runIds = runRows.map((r) => String(r.id));
    if (runIds.length) {
      await conn.query(`DELETE FROM file_errors WHERE validation_run_id IN (${runIds.map(() => "?").join(",")})`, runIds);
    }
    await conn.query("DELETE FROM checklist_results WHERE file_id = ?", [fileId]);
    await conn.query("DELETE FROM validation_runs WHERE file_id = ?", [fileId]);
    await conn.query("DELETE FROM files WHERE id = ?", [fileId]);
    return { ok: true, storagePath };
  });
}

export async function mariadbRecoverValidatingFiles() {
  await withMariaDb(async (conn) => {
    await conn.query(
      "UPDATE files SET status = 'blocked', updated_at = UTC_TIMESTAMP(3) WHERE status = 'validating'",
    );
  });
}

export async function mariadbGetWorkflowDetail(workflowId: string) {
  return withMariaDb(async (conn) => {
    const [wfRows] = await conn.query<MariaDbRow[]>("SELECT * FROM workflows WHERE id = ? LIMIT 1", [workflowId]);
    if (!wfRows[0]) return null;
    const workflow = mapWorkflow(wfRows[0]);
    const columns = await mariadbGetRequiredColumnsConn(conn, workflowId);
    const checklist = await mariadbGetChecklistItemsConn(conn, workflowId);
    const [fileRows] = await conn.query<MariaDbRow[]>(
      "SELECT * FROM files WHERE workflow_id = ? ORDER BY created_at DESC LIMIT 100",
      [workflowId],
    );
    return {
      workflow,
      columns,
      checklist,
      files: fileRows.map(mapFile),
    };
  });
}

export async function mariadbCreateWorkflow(input: {
  workflow: WorkflowRow;
  columns: RequiredColumnRow[];
  checklist: ChecklistItemRow[];
}) {
  await withMariaDbTransaction(async (conn) => {
    const w = input.workflow;
    const passRules = mergeClientNameIntoPassRules(w.pass_rules || {}, w.client_name);
    // Always write client_name into pass_rules (works without 021).
    // Column is set only when present — check first so a failed INSERT cannot abort the txn.
    const [colRows] = await conn.query<MariaDbRow[]>(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workflows' AND COLUMN_NAME = 'client_name'`,
    );
    const hasClientCol = Number(colRows[0]?.c ?? 0) > 0;
    if (hasClientCol) {
      await conn.query(
        `INSERT INTO workflows (id, name, client_name, status, source_type, source_path, expected_file_type, destination_label, pass_rules, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          w.id,
          w.name,
          w.client_name,
          w.status,
          w.source_type,
          w.source_path,
          w.expected_file_type,
          w.destination_label,
          JSON.stringify(passRules),
          toSqlDateTime(w.created_at),
          toSqlDateTime(w.updated_at),
        ],
      );
    } else {
      await conn.query(
        `INSERT INTO workflows (id, name, status, source_type, source_path, expected_file_type, destination_label, pass_rules, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          w.id,
          w.name,
          w.status,
          w.source_type,
          w.source_path,
          w.expected_file_type,
          w.destination_label,
          JSON.stringify(passRules),
          toSqlDateTime(w.created_at),
          toSqlDateTime(w.updated_at),
        ],
      );
    }
    for (const c of input.columns) {
      await conn.query(
        `INSERT INTO required_columns (id, workflow_id, column_name, data_type, is_required, allowed_values, pattern, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          c.id,
          c.workflow_id,
          c.column_name,
          c.data_type,
          c.is_required ? 1 : 0,
          c.allowed_values ? JSON.stringify(c.allowed_values) : null,
          c.pattern,
          c.sort_order,
          toSqlDateTime(c.created_at),
        ],
      );
    }
    for (const item of input.checklist) {
      await conn.query(
        "INSERT INTO checklist_items (id, workflow_id, item_key, label, is_critical, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
        [item.id, item.workflow_id, item.item_key, item.label, item.is_critical ? 1 : 0, item.sort_order],
      );
    }
  });
}

export async function mariadbUpdateWorkflowFull(input: {
  workflow: WorkflowRow;
  columns: RequiredColumnRow[];
  checklist: ChecklistItemRow[];
}) {
  await withMariaDbTransaction(async (conn) => {
    const w = input.workflow;
    const passRules = mergeClientNameIntoPassRules(w.pass_rules || {}, w.client_name);
    const [colRows] = await conn.query<MariaDbRow[]>(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workflows' AND COLUMN_NAME = 'client_name'`,
    );
    const hasClientCol = Number(colRows[0]?.c ?? 0) > 0;
    if (hasClientCol) {
      await conn.query(
        `UPDATE workflows SET name = ?, client_name = ?, status = ?, source_type = ?, source_path = ?, expected_file_type = ?, destination_label = ?, pass_rules = ?, updated_at = ? WHERE id = ?`,
        [
          w.name,
          w.client_name,
          w.status,
          w.source_type,
          w.source_path,
          w.expected_file_type,
          w.destination_label,
          JSON.stringify(passRules),
          toSqlDateTime(w.updated_at),
          w.id,
        ],
      );
    } else {
      await conn.query(
        `UPDATE workflows SET name = ?, status = ?, source_type = ?, source_path = ?, expected_file_type = ?, destination_label = ?, pass_rules = ?, updated_at = ? WHERE id = ?`,
        [
          w.name,
          w.status,
          w.source_type,
          w.source_path,
          w.expected_file_type,
          w.destination_label,
          JSON.stringify(passRules),
          toSqlDateTime(w.updated_at),
          w.id,
        ],
      );
    }
    await conn.query("DELETE FROM required_columns WHERE workflow_id = ?", [w.id]);
    await conn.query("DELETE FROM checklist_items WHERE workflow_id = ?", [w.id]);
    for (const c of input.columns) {
      await conn.query(
        `INSERT INTO required_columns (id, workflow_id, column_name, data_type, is_required, allowed_values, pattern, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          c.id,
          c.workflow_id,
          c.column_name,
          c.data_type,
          c.is_required ? 1 : 0,
          c.allowed_values ? JSON.stringify(c.allowed_values) : null,
          c.pattern,
          c.sort_order,
          toSqlDateTime(c.created_at),
        ],
      );
    }
    for (const item of input.checklist) {
      await conn.query(
        "INSERT INTO checklist_items (id, workflow_id, item_key, label, is_critical, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
        [item.id, item.workflow_id, item.item_key, item.label, item.is_critical ? 1 : 0, item.sort_order],
      );
    }
  });
}

export async function mariadbGetReportsData() {
  return withMariaDb(async (conn) => {
    const [files] = await conn.query<MariaDbRow[]>(
      "SELECT id, original_name, status, workflow_id, created_at, processed_at FROM files ORDER BY created_at DESC LIMIT 5000",
    );
    const [wfs] = await conn.query<MariaDbRow[]>("SELECT id, name FROM workflows");
    const wfMap = new Map(wfs.map((w) => [String(w.id), String(w.name)]));
    return files.map((f) => ({
      id: String(f.id),
      original_name: String(f.original_name),
      status: String(f.status),
      workflow_id: f.workflow_id ? String(f.workflow_id) : null,
      workflow_name: f.workflow_id ? (wfMap.get(String(f.workflow_id)) ?? null) : null,
      created_at: fromSqlDateTime(f.created_at),
      processed_at: f.processed_at ? fromSqlDateTime(f.processed_at) : null,
    }));
  });
}

export async function mariadbGetFileErrorsForExport(fileId: string) {
  return withMariaDb(async (conn) => {
    const file = await mariadbGetFileConn(conn, fileId);
    if (!file) return null;
    const runId = (file.metadata as { last_validation_run_id?: string })?.last_validation_run_id;
    if (!runId) return { file, errors: [] as FileErrorRow[] };
    const [rows] = await conn.query<MariaDbRow[]>(
      "SELECT * FROM file_errors WHERE validation_run_id = ? ORDER BY row_index ASC",
      [runId],
    );
    return {
      file,
      errors: rows.map(mapFileError),
    };
  });
}
