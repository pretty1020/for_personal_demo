import { subDays, subHours } from "date-fns";
import { randomUUID } from "node:crypto";
import type {
  AuditLogRow,
  ChecklistResultRow,
  FileErrorRow,
  FileRow,
  NotificationRow,
  ValidationRunRow,
} from "@/types/database";

/** AT&T workflow id (order intake sample CSVs). */
const WF_ORDER = "a1000000-0000-4000-8000-000000000001";
/** Fiserv workflow id (vendor sample CSV). */
const WF_VENDOR = "a1000000-0000-4000-8000-000000000002";

/** Stable demo rows for local JSON mode. */
export function buildStandaloneSampleRecords(anchor: Date): {
  files: FileRow[];
  validation_runs: ValidationRunRow[];
  file_errors: FileErrorRow[];
  checklist_results: ChecklistResultRow[];
  audit_logs: AuditLogRow[];
  notifications: NotificationRow[];
} {
  const iso = (d: Date) => d.toISOString();

  const f1 = "b2000000-0000-4000-8000-000000000001";
  const f2 = "b2000000-0000-4000-8000-000000000002";
  const f3 = "b2000000-0000-4000-8000-000000000003";
  const f4 = "b2000000-0000-4000-8000-000000000004";
  const f5 = "b2000000-0000-4000-8000-000000000005";

  const r1 = "c3000000-0000-4000-8000-000000000001";
  const r2 = "c3000000-0000-4000-8000-000000000002";
  const r3 = "c3000000-0000-4000-8000-000000000003";
  const r4 = "c3000000-0000-4000-8000-000000000004";

  const t2d = iso(subDays(anchor, 2));
  const t3d = iso(subDays(anchor, 3));
  const t4d = iso(subDays(anchor, 4));
  const t5d = iso(subDays(anchor, 5));
  const t1d = iso(subDays(anchor, 1));
  const t6h = iso(subHours(anchor, 6));

  const files: FileRow[] = [
    {
      id: f1,
      workflow_id: WF_ORDER,
      original_name: "valid_orders.csv",
      storage_path: "public/samples/valid_orders.csv",
      file_hash: "hash-valid-orders-demo",
      mime_type: "text/csv",
      size_bytes: 120,
      intake_source: "upload",
      status: "processed",
      metadata: {
        last_validation_run_id: r1,
        processed_path: "public/samples/valid_orders.csv",
      },
      processed_at: t1d,
      created_at: t2d,
      updated_at: t1d,
    },
    {
      id: f2,
      workflow_id: WF_ORDER,
      original_name: "missing_columns_orders.csv",
      storage_path: "public/samples/missing_columns_orders.csv",
      file_hash: "hash-missing-demo",
      mime_type: "text/csv",
      size_bytes: 80,
      intake_source: "upload",
      status: "blocked",
      metadata: { last_validation_run_id: r2 },
      processed_at: null,
      created_at: t3d,
      updated_at: t3d,
    },
    {
      id: f3,
      workflow_id: WF_ORDER,
      original_name: "pivot_like_report.csv",
      storage_path: "public/samples/pivot_like_report.csv",
      file_hash: "hash-pivot-demo",
      mime_type: "text/csv",
      size_bytes: 200,
      intake_source: "upload",
      status: "blocked",
      metadata: { last_validation_run_id: r3 },
      processed_at: null,
      created_at: t4d,
      updated_at: t4d,
    },
    {
      id: f4,
      workflow_id: WF_VENDOR,
      original_name: "vendors.csv",
      storage_path: "public/samples/vendors.csv",
      file_hash: "hash-vendors-demo",
      mime_type: "text/csv",
      size_bytes: 150,
      intake_source: "simulated_path",
      status: "pending_review",
      metadata: { last_validation_run_id: r4 },
      processed_at: null,
      created_at: t6h,
      updated_at: t6h,
    },
    {
      id: f5,
      workflow_id: WF_ORDER,
      original_name: "pending_scan.csv",
      storage_path: "public/samples/valid_orders.csv",
      file_hash: "hash-pending-demo",
      mime_type: "text/csv",
      size_bytes: 120,
      intake_source: "watched_folder",
      status: "pending",
      metadata: {},
      processed_at: null,
      created_at: iso(anchor),
      updated_at: iso(anchor),
    },
  ];

  const validation_runs: ValidationRunRow[] = [
    {
      id: r1,
      file_id: f1,
      started_at: t2d,
      completed_at: t2d,
      passed: true,
      can_proceed: true,
      summary: { totalRows: 4, errorCount: 0, warningCount: 0 },
      structure_result: {
        fileTypeAllowed: true,
        fileReadable: true,
        notPivotFormat: true,
        noMergedHeaders: true,
        requiredColumnsExist: true,
        noDuplicateColumnNames: true,
        validHeaderRow: true,
        notBlankDataset: true,
      },
      data_quality_result: {
        missingRequiredValues: true,
        invalidDates: true,
        invalidNumbers: true,
        invalidPatterns: true,
        duplicateRows: true,
        columnMismatch: true,
        invalidCategories: true,
      },
      pivot_detection: { score: 0, signals: [], likelyPivot: false },
    },
    {
      id: r2,
      file_id: f2,
      started_at: t3d,
      completed_at: t3d,
      passed: false,
      can_proceed: false,
      summary: { totalRows: 2, errorCount: 3, warningCount: 0 },
      structure_result: {
        fileTypeAllowed: true,
        fileReadable: true,
        notPivotFormat: true,
        noMergedHeaders: true,
        requiredColumnsExist: false,
        noDuplicateColumnNames: true,
        validHeaderRow: true,
        notBlankDataset: true,
      },
      data_quality_result: {
        missingRequiredValues: false,
        invalidDates: true,
        invalidNumbers: true,
        invalidPatterns: true,
        duplicateRows: true,
        columnMismatch: true,
        invalidCategories: true,
      },
      pivot_detection: { score: 0, signals: [], likelyPivot: false },
    },
    {
      id: r3,
      file_id: f3,
      started_at: t4d,
      completed_at: t4d,
      passed: false,
      can_proceed: false,
      summary: { totalRows: 4, errorCount: 2, warningCount: 0 },
      structure_result: {
        fileTypeAllowed: true,
        fileReadable: true,
        notPivotFormat: false,
        noMergedHeaders: true,
        requiredColumnsExist: true,
        noDuplicateColumnNames: true,
        validHeaderRow: true,
        notBlankDataset: true,
      },
      data_quality_result: {
        missingRequiredValues: true,
        invalidDates: true,
        invalidNumbers: true,
        invalidPatterns: true,
        duplicateRows: true,
        columnMismatch: true,
        invalidCategories: true,
      },
      pivot_detection: { score: 5, signals: ["grand total"], likelyPivot: true },
    },
    {
      id: r4,
      file_id: f4,
      started_at: t6h,
      completed_at: t6h,
      passed: true,
      can_proceed: true,
      summary: { totalRows: 3, errorCount: 0, warningCount: 0 },
      structure_result: {
        fileTypeAllowed: true,
        fileReadable: true,
        notPivotFormat: true,
        noMergedHeaders: true,
        requiredColumnsExist: true,
        noDuplicateColumnNames: true,
        validHeaderRow: true,
        notBlankDataset: true,
      },
      data_quality_result: {
        missingRequiredValues: true,
        invalidDates: true,
        invalidNumbers: true,
        invalidPatterns: true,
        duplicateRows: true,
        columnMismatch: true,
        invalidCategories: true,
      },
      pivot_detection: { score: 0, signals: [], likelyPivot: false },
    },
  ];

  const now = iso(anchor);
  const file_errors: FileErrorRow[] = [
    {
      id: randomUUID(),
      validation_run_id: r2,
      severity: "error",
      code: "MISSING_COLUMNS",
      message: "Missing required columns: order_date",
      row_index: null,
      column_name: null,
      details: {},
      created_at: t3d,
    },
    {
      id: randomUUID(),
      validation_run_id: r3,
      severity: "error",
      code: "PIVOT_LAYOUT",
      message: "Detected non-tabular / pivot-like layout",
      row_index: null,
      column_name: null,
      details: {},
      created_at: t4d,
    },
  ];

  const cr = (
    file_id: string,
    run_id: string,
    pairs: { key: string; passed: boolean }[],
  ): ChecklistResultRow[] =>
    pairs.map((p) => ({
      id: randomUUID(),
      file_id,
      validation_run_id: run_id,
      item_key: p.key,
      passed: p.passed,
      acknowledged: true,
      updated_at: now,
    }));

  const keys = [
    "file_naming_valid",
    "required_columns_complete",
    "no_pivot_format",
    "no_missing_mandatory",
    "data_types_valid",
    "dates_valid",
    "no_duplicate_rows",
    "warnings_acknowledged",
  ] as const;

  const allPass = keys.map((k) => ({ key: k, passed: true }));
  const missingFail = keys.map((k) => ({
    key: k,
    passed: !["required_columns_complete", "no_missing_mandatory"].includes(k),
  }));
  const pivotFail = keys.map((k) => ({
    key: k,
    passed: k !== "no_pivot_format",
  }));

  const checklist_results: ChecklistResultRow[] = [
    ...cr(f1, r1, allPass),
    ...cr(f2, r2, missingFail),
    ...cr(f3, r3, pivotFail),
    ...cr(f4, r4, allPass),
  ];

  const audit_logs: AuditLogRow[] = [
    {
      id: randomUUID(),
      file_id: null,
      workflow_id: WF_ORDER,
      action: "duplicate_prevented",
      details: { fileName: "valid_orders.csv" },
      created_at: t5d,
    },
    {
      id: randomUUID(),
      file_id: f1,
      workflow_id: WF_ORDER,
      action: "approved_processed",
      details: { dest: "/demo" },
      created_at: t1d,
    },
  ];

  const notifications: NotificationRow[] = [
    {
      id: randomUUID(),
      type: "validation_failure",
      title: "Validation failed",
      message: "missing_columns_orders.csv failed validation",
      read: false,
      file_id: f2,
      workflow_id: WF_ORDER,
      created_at: t1d,
    },
    {
      id: randomUUID(),
      type: "validation_passed",
      title: "Ready for review",
      message: "vendors.csv passed validation",
      read: true,
      file_id: f4,
      workflow_id: WF_VENDOR,
      created_at: t6h,
    },
  ];

  return { files, validation_runs, file_errors, checklist_results, audit_logs, notifications };
}
