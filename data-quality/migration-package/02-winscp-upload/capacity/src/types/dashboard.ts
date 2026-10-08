export type ColumnType = 'text' | 'number' | 'date'

export type Aggregation = 'sum' | 'average' | 'count' | 'min' | 'max'

export type ChartKind =
  | 'bar'
  | 'line'
  | 'area'
  | 'pie'
  | 'donut'
  | 'scatter'
  | 'bubble'

export interface ColumnSchema {
  /** Stable key derived from sanitized header */
  key: string
  /** Display label */
  header: string
  type: ColumnType
  /**
   * For `date` columns: how values should be shown (month buckets vs full timestamps).
   * Inferred from header text and value patterns (e.g. YYYYMM, first-of-month dates).
   */
  dateGranularity?: 'day' | 'month'
}

export interface SheetSnapshot {
  name: string
  columns: ColumnSchema[]
  /** Normalized rows: values coerced per column schema */
  rows: Record<string, unknown>[]
  /**
   * Full grid as returned from SheetJS (`sheet_to_json` with `header: 1`).
   * Row 0 is the first row from Excel — use for as-is / pivot-like display.
   */
  rawMatrix: (unknown | null)[][]
}

/** Full workbook parse result (all sheets, local-only). */
export interface ParsedWorkbookBundle {
  fileName: string
  sheetNames: string[]
  snapshots: Record<string, SheetSnapshot>
}

export interface ParsedWorkbookMeta {
  fileName: string
  sheetNames: string[]
}

/** Table / chart filters: string uses legacy “contains” behavior in charts; `string[]` is OR (exact display match per value). */
export type ColumnFilterValue = string | string[]

export interface ColumnFilters {
  [columnKey: string]: ColumnFilterValue
}

export type DatasetKind =
  | 'datasheet'
  | 'commit_vs_actuals'
  | 'budget_vs_trending'
  | 'lw_cw_datasheet'
  | 'attrition'
  | 'shrinkage'
  | 'headcount'
  | 'aht'
  | 'revenue'
  | 'fte'
  | 'commit'
  | 'actuals'

export type CanonicalField =
  | 'project_code'
  | 'client_name'
  | 'project_name'
  | 'du'
  | 'location'
  | 'scenario'
  | 'fy'
  | 'month'
  | 'week'
  | 'date'

export interface DatasetDetectionIssue {
  kind: 'missing_required_field' | 'missing_sheet' | 'low_confidence' | 'duplicate_sheet'
  message: string
  dataset?: DatasetKind
  sheetName?: string
  field?: CanonicalField
}

export interface DetectedDataset {
  dataset: DatasetKind
  /** Workbook tab name that matched this dataset */
  sheetName: string
  /** 0..1 match confidence */
  confidence: number
  /** Canonical fields → column key in the matched sheet */
  fieldMap: Partial<Record<CanonicalField, string>>
  /** Canonical fields required for this dataset but missing from the sheet */
  missingRequired: CanonicalField[]
}

export interface DatasetDetectionReport {
  detected: DetectedDataset[]
  issues: DatasetDetectionIssue[]
}

export type TransformActionKind =
  | 'normalize_headers'
  | 'trim_text'
  | 'normalize_project_code'
  | 'coerce_numbers'
  | 'coerce_dates'
  | 'drop_null_key_rows'
  | 'dedupe_rows'

export interface TransformLogEntry {
  sheetName: string
  action: TransformActionKind
  message: string
  beforeRows?: number
  afterRows?: number
  details?: Record<string, string | number | boolean | null>
}

export interface TransformationResult {
  snapshots: Record<string, SheetSnapshot>
  logs: TransformLogEntry[]
}

/** Normalized grain for executive merge (one row per source row before heavy aggregation). */
export interface ExecutiveUnifiedRow {
  dataset: DatasetKind
  sheetName: string
  project_code: string
  fy: string | number | null
  /** YYYY-MM-01 when known */
  month_bucket: string | null
  /** ISO date string Monday of week */
  week_start: string | null
  scenario: string | null
  client_name: string | null
  location: string | null
  /** Sum/average-friendly metrics keyed by sanitized measure name */
  metrics: Record<string, number>
}

export interface WeeklyChangeRow {
  metric: string
  lastWeek: number | null
  currentWeek: number | null
  variance: number | null
  variancePct: number | null
  direction: 'up' | 'down' | 'flat'
}

export interface ExecutiveMergedModel {
  factRows: ExecutiveUnifiedRow[]
  /** Weekly operational rows rolled to calendar month via majority-days rule */
  monthlyFromWeekly: ExecutiveUnifiedRow[]
  weeklyChanges: WeeklyChangeRow[]
  notes: string[]
}

export interface ChartDraft {
  id: string
  /** Sheet this visualization was authored against */
  sheetName: string
  title: string
  chartType: ChartKind
  xColumn: string
  yColumn: string
  categoryColumn: string
  sizeColumn: string
  aggregation: Aggregation
  filters: ColumnFilters
  /** Optional labels on marks/slices */
  showDataLabels: boolean
  /**
   * When false (default), pivot-style Total / Grand Total rows are excluded from chart aggregation.
   */
  includePivotTotalRows?: boolean
}

export type ChartDraftState = Omit<ChartDraft, 'id' | 'sheetName'>
