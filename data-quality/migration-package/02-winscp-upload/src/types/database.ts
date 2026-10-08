export type WorkflowStatus = "active" | "disabled";
export type SourceType = "upload" | "watched_folder" | "simulated_path";
export type ExpectedFileType = "csv" | "xlsx";
export type ColumnDataType = "string" | "number" | "date" | "category";
export type FileIntakeSource = SourceType;
export type FileRecordStatus =
  | "pending"
  | "validating"
  | "blocked"
  | "pending_review"
  | "approved"
  | "rejected"
  | "processed"
  | "duplicate_blocked";

export type ErrorSeverity = "error" | "warning" | "info";

export interface WorkflowRow {
  id: string;
  name: string;
  status: WorkflowStatus;
  source_type: SourceType;
  source_path: string | null;
  expected_file_type: ExpectedFileType;
  destination_label: string;
  pass_rules: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface WorkflowRuleRow {
  id: string;
  workflow_id: string;
  rule_key: string;
  rule_value: Record<string, unknown>;
  created_at: string;
}

export interface RequiredColumnRow {
  id: string;
  workflow_id: string;
  column_name: string;
  data_type: ColumnDataType;
  is_required: boolean;
  allowed_values: string[] | null;
  pattern: string | null;
  sort_order: number;
  created_at: string;
}

export interface FileRow {
  id: string;
  workflow_id: string | null;
  original_name: string;
  storage_path: string;
  file_hash: string;
  mime_type: string | null;
  size_bytes: number;
  intake_source: FileIntakeSource;
  status: FileRecordStatus;
  metadata: Record<string, unknown>;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ValidationRunRow {
  id: string;
  file_id: string;
  started_at: string;
  completed_at: string | null;
  passed: boolean;
  can_proceed: boolean;
  summary: ValidationSummary;
  structure_result: StructureChecks;
  data_quality_result: DataQualityChecks;
  pivot_detection: PivotDetection;
}

export interface ValidationSummary {
  totalRows?: number;
  invalidValueCount?: number;
  duplicateRowCount?: number;
  missingRequiredCount?: number;
  warningCount?: number;
  errorCount?: number;
}

export interface CheckItem {
  id: string;
  label: string;
  passed: boolean;
}

export interface StructureChecks {
  fileTypeAllowed: boolean;
  fileReadable: boolean;
  sheetExists?: boolean;
  notPivotFormat: boolean;
  noMergedHeaders: boolean;
  requiredColumnsExist: boolean;
  noDuplicateColumnNames: boolean;
  validHeaderRow: boolean;
  notBlankDataset: boolean;
  delimiterOk?: boolean;
}

export interface DataQualityChecks {
  missingRequiredValues: boolean;
  invalidDates: boolean;
  invalidNumbers: boolean;
  invalidPatterns: boolean;
  duplicateRows: boolean;
  columnMismatch: boolean;
  invalidCategories: boolean;
}

export interface PivotDetection {
  score: number;
  signals: string[];
  likelyPivot: boolean;
}

export interface FileErrorRow {
  id: string;
  validation_run_id: string;
  severity: ErrorSeverity;
  code: string;
  message: string;
  row_index: number | null;
  column_name: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface ChecklistItemRow {
  id: string;
  workflow_id: string;
  item_key: string;
  label: string;
  is_critical: boolean;
  sort_order: number;
}

export interface ChecklistResultRow {
  id: string;
  file_id: string;
  validation_run_id: string;
  item_key: string;
  passed: boolean;
  acknowledged: boolean;
  updated_at: string;
}

export interface AuditLogRow {
  id: string;
  file_id: string | null;
  workflow_id: string | null;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  file_id: string | null;
  workflow_id: string | null;
  created_at: string;
}
