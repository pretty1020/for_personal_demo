import type {
  DataQualityChecks,
  PivotDetection,
  StructureChecks,
  ValidationSummary,
} from "@/types/database";

export interface ParsedTable {
  headers: string[];
  rows: Record<string, string>[];
  rawRows: string[][];
  sheetName?: string;
  delimiterGuess?: string;
}

export interface ValidationIssue {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  rowIndex?: number;
  column?: string;
  details?: Record<string, unknown>;
}

export interface ValidationEngineResult {
  passed: boolean;
  canProceed: boolean;
  summary: ValidationSummary;
  structure: StructureChecks;
  dataQuality: DataQualityChecks;
  pivot: PivotDetection;
  issues: ValidationIssue[];
  previewRows: Record<string, string>[];
  checklistHints: Record<string, boolean>;
}

export interface WorkflowValidationConfig {
  expected_file_type: "csv" | "xlsx";
  required_columns: {
    column_name: string;
    data_type: "string" | "number" | "date" | "category";
    is_required: boolean;
    allowed_values?: string[] | null;
    pattern?: string | null;
  }[];
  pass_rules?: {
    min_rows?: number;
    max_duplicate_ratio?: number;
    file_name_pattern?: string;
  };
  /**
   * Active workflow audit rules (checklist_items).
   * Only keys present here are evaluated for enforcement;
   * only those with is_critical=true can block validation.
   * Omit for legacy callers (defaults to all default engine keys as critical).
   * Pass [] when the workflow has no checklist rules.
   */
  checklist_rules?: {
    item_key: string;
    is_critical: boolean;
  }[];
}
