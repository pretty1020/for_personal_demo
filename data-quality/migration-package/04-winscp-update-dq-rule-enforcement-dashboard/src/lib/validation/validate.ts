import path from "node:path";
import type {
  ValidationEngineResult,
  ValidationIssue,
  WorkflowValidationConfig,
} from "@/lib/validation/types";
import type { DataQualityChecks, StructureChecks } from "@/types/database";
import { detectPivotLike } from "@/lib/validation/pivot";
import {
  detectMergedHeaderLike,
  parseCsv,
  parseXlsx,
} from "@/lib/validation/parse";
import {
  enforcedFail,
  isRulePresent,
  issueSeverityForRule,
  ruleKeyForIssueCode,
  type EngineRuleKey,
} from "@/lib/validation/active-rules";

const DATE_RE =
  /^\d{4}-\d{2}-\d{2}$|^\d{1,2}\/\d{1,2}\/\d{2,4}$|^\d{2}-\d{2}-\d{4}$/;

function isValidDate(s: string): boolean {
  if (!s) return true;
  if (!DATE_RE.test(s)) return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime());
}

function isValidNumber(s: string): boolean {
  if (!s) return true;
  const n = Number(String(s).replace(/,/g, ""));
  return !Number.isNaN(n);
}

function fileNameValid(name: string, pattern?: string): boolean {
  if (!pattern) return true;
  try {
    return new RegExp(pattern).test(name);
  } catch {
    return true;
  }
}

/** Push an issue only when its owning rule is still on the workflow (or baseline). */
function pushRuledIssue(
  issues: ValidationIssue[],
  config: WorkflowValidationConfig,
  issue: Omit<ValidationIssue, "severity"> & { severity?: ValidationIssue["severity"] },
  ruleKey?: EngineRuleKey | null,
): void {
  const key = ruleKey === undefined ? ruleKeyForIssueCode(issue.code) : ruleKey;
  const severity = issueSeverityForRule(config, key);
  if (severity == null) return;
  issues.push({ ...issue, severity: issue.severity === "info" ? "info" : severity });
}

export function validateBuffer(
  fileName: string,
  buffer: Buffer,
  config: WorkflowValidationConfig,
): ValidationEngineResult {
  const issues: ValidationIssue[] = [];
  const ext = path.extname(fileName).toLowerCase();
  let table;
  let fileReadable = true;
  let delimiterOk = true;

  try {
    if (config.expected_file_type === "csv") {
      if (ext !== ".csv") {
        issues.push({
          severity: "error",
          code: "FILE_TYPE",
          message: `Expected CSV but file extension is ${ext || "(none)"}`,
        });
      }
      table = parseCsv(buffer);
      const sniff = buffer.toString("utf8", 0, Math.min(buffer.length, 4096));
      const comma = (sniff.match(/,/g) || []).length;
      const semi = (sniff.match(/;/g) || []).length;
      if (semi > comma * 2 && comma < 3) {
        delimiterOk = false;
        issues.push({
          severity: "warning",
          code: "DELIMITER",
          message: "File may use an unexpected delimiter (many semicolons detected)",
        });
      }
    } else {
      if (![".xlsx", ".xls"].includes(ext)) {
        issues.push({
          severity: "error",
          code: "FILE_TYPE",
          message: `Expected XLSX but file extension is ${ext || "(none)"}`,
        });
      }
      table = parseXlsx(buffer);
    }
  } catch (e) {
    fileReadable = false;
    issues.push({
      severity: "error",
      code: "READ_ERROR",
      message: e instanceof Error ? e.message : "Unable to read file",
    });
    return buildEmptyResult(issues, fileReadable, delimiterOk, fileName, config);
  }

  const pivotRuleActive = isRulePresent(config, "no_pivot_format");
  // When the workflow no longer includes "No pivot / non-tabular format", skip detection
  // entirely so files are never flagged with PIVOT_LAYOUT for that workflow.
  const pivot = pivotRuleActive
    ? detectPivotLike(table)
    : { score: 0, signals: [] as string[], likelyPivot: false };

  if (pivotRuleActive && pivot.likelyPivot) {
    pushRuledIssue(
      issues,
      config,
      {
        code: "PIVOT_LAYOUT",
        message: "Detected non-tabular / pivot-like layout",
        details: { signals: pivot.signals },
      },
      "no_pivot_format",
    );
  } else if (pivotRuleActive && pivot.score >= 3) {
    issues.push({
      severity: "warning",
      code: "PIVOT_HINT",
      message: "Possible report-style layout",
      details: { signals: pivot.signals },
    });
  }

  const headers = table.headers.map((h) => h.trim()).filter((h) => h && h !== "__EMPTY");
  const dupHeaders =
    new Set(headers.map((h) => h.toLowerCase())).size !== headers.length;
  const mergedLike = detectMergedHeaderLike(table.headers);

  const requiredDefs = config.required_columns.filter((c) => c.is_required);
  const allowedNames = new Set(
    config.required_columns.map((c) => c.column_name.toLowerCase()),
  );
  const missingCols = requiredDefs.filter(
    (c) => !table.headers.some((h) => h.toLowerCase() === c.column_name.toLowerCase()),
  );
  const unknownHeaders = table.headers.filter(
    (h) => h && !allowedNames.has(h.toLowerCase()),
  );

  if (unknownHeaders.length && config.required_columns.length) {
    issues.push({
      severity: "warning",
      code: "COLUMN_MISMATCH",
      message: `Columns not defined in workflow schema: ${unknownHeaders.join(", ")}`,
    });
  }

  if (missingCols.length) {
    pushRuledIssue(
      issues,
      config,
      {
        code: "MISSING_COLUMNS",
        message: `Missing required columns: ${missingCols.map((c) => c.column_name).join(", ")}`,
      },
      "required_columns_complete",
    );
  }

  if (dupHeaders) {
    pushRuledIssue(
      issues,
      config,
      {
        code: "DUP_HEADERS",
        message: "Duplicate column names detected",
      },
      "required_columns_complete",
    );
  }

  if (mergedLike) {
    pushRuledIssue(
      issues,
      config,
      {
        code: "MERGED_HEADERS",
        message: "Invalid header row (blanks or merged header pattern)",
      },
      "required_columns_complete",
    );
  }

  const notBlank = table.rows.length > 0 && headers.length > 0;
  if (!notBlank) {
    pushRuledIssue(
      issues,
      config,
      {
        code: "BLANK_DATA",
        message: "Dataset is blank or has no data rows",
      },
      "required_columns_complete",
    );
  }

  let missingRequiredValues = false;
  let invalidDates = false;
  let invalidNumbers = false;
  let invalidPatterns = false;
  let invalidCategories = false;
  let duplicateRows = false;

  const rowFingerprints: Map<string, number[]> = new Map();
  const minRows = Number(config.pass_rules?.min_rows ?? 1);

  for (let i = 0; i < table.rows.length; i++) {
    const row = table.rows[i];
    const fp = JSON.stringify(
      config.required_columns.map((c) => {
        const v =
          row[c.column_name] ??
          row[Object.keys(row).find((k) => k.toLowerCase() === c.column_name.toLowerCase()) || ""] ??
          "";
        return String(v);
      }),
    );
    const arr = rowFingerprints.get(fp) || [];
    arr.push(i + 2);
    rowFingerprints.set(fp, arr);

    for (const col of config.required_columns) {
      const key = Object.keys(row).find(
        (k) => k.toLowerCase() === col.column_name.toLowerCase(),
      );
      const raw = key ? row[key] : "";
      if (col.is_required && (!raw || raw.trim() === "")) {
        missingRequiredValues = true;
        pushRuledIssue(
          issues,
          config,
          {
            code: "MISSING_VALUE",
            message: `Missing value for ${col.column_name}`,
            rowIndex: i + 2,
            column: col.column_name,
          },
          "no_missing_mandatory",
        );
      }
      if (!raw) continue;
      if (col.data_type === "number" && !isValidNumber(raw)) {
        invalidNumbers = true;
        pushRuledIssue(
          issues,
          config,
          {
            code: "INVALID_NUMBER",
            message: `Invalid number in ${col.column_name}`,
            rowIndex: i + 2,
            column: col.column_name,
          },
          "data_types_valid",
        );
      }
      if (col.data_type === "date" && !isValidDate(raw)) {
        invalidDates = true;
        pushRuledIssue(
          issues,
          config,
          {
            code: "INVALID_DATE",
            message: `Invalid date in ${col.column_name}`,
            rowIndex: i + 2,
            column: col.column_name,
          },
          "dates_valid",
        );
      }
      if (col.pattern) {
        try {
          if (!new RegExp(col.pattern).test(raw)) {
            invalidPatterns = true;
            pushRuledIssue(
              issues,
              config,
              {
                code: "INVALID_PATTERN",
                message: `Value does not match pattern for ${col.column_name}`,
                rowIndex: i + 2,
                column: col.column_name,
              },
              "data_types_valid",
            );
          }
        } catch {
          /* ignore bad pattern */
        }
      }
      if (col.data_type === "category" && col.allowed_values?.length) {
        const ok = col.allowed_values.some(
          (v) => v.toLowerCase() === raw.toLowerCase(),
        );
        if (!ok) {
          invalidCategories = true;
          pushRuledIssue(
            issues,
            config,
            {
              code: "INVALID_CATEGORY",
              message: `Invalid category in ${col.column_name}`,
              rowIndex: i + 2,
              column: col.column_name,
            },
            "data_types_valid",
          );
        }
      }
    }
  }

  const dupGroups = [...rowFingerprints.values()].filter((a) => a.length > 1);
  if (dupGroups.length) {
    duplicateRows = true;
    pushRuledIssue(
      issues,
      config,
      {
        code: "DUPLICATE_ROWS",
        message: `Duplicate rows detected (${dupGroups.length} groups)`,
        details: { groups: dupGroups.slice(0, 20) },
      },
      "no_duplicate_rows",
    );
  }

  if (table.rows.length < minRows) {
    pushRuledIssue(
      issues,
      config,
      {
        code: "MIN_ROWS",
        message: `Expected at least ${minRows} data rows`,
      },
      "required_columns_complete",
    );
  }

  const fnOk = fileNameValid(fileName, config.pass_rules?.file_name_pattern);
  if (!fnOk) {
    pushRuledIssue(
      issues,
      config,
      {
        code: "FILE_NAME",
        message: "File name does not match the configured pattern",
      },
      "file_naming_valid",
    );
  }

  const structure: StructureChecks = {
    fileTypeAllowed: ext === (config.expected_file_type === "csv" ? ".csv" : ".xlsx") || (config.expected_file_type === "xlsx" && ext === ".xls"),
    fileReadable,
    sheetExists: config.expected_file_type === "xlsx" ? table.rawRows.length > 0 : undefined,
    // If the pivot rule is not on the workflow, treat format as OK for structure reporting.
    notPivotFormat: pivotRuleActive ? !pivot.likelyPivot : true,
    noMergedHeaders: !mergedLike,
    requiredColumnsExist: missingCols.length === 0,
    noDuplicateColumnNames: !dupHeaders,
    validHeaderRow: headers.length > 0,
    notBlankDataset: notBlank,
    delimiterOk,
  };

  const dataQuality: DataQualityChecks = {
    missingRequiredValues: !missingRequiredValues,
    invalidDates: !invalidDates,
    invalidNumbers: !invalidNumbers,
    invalidPatterns: !invalidPatterns,
    duplicateRows: !duplicateRows,
    columnMismatch: unknownHeaders.length === 0,
    invalidCategories: !invalidCategories,
  };

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;

  // Only active + critical checklist rules can fail the run (removed / non-critical skipped).
  const criticalStructureFail =
    !structure.fileReadable ||
    enforcedFail(config, "required_columns_complete", !structure.requiredColumnsExist) ||
    enforcedFail(config, "required_columns_complete", !structure.noDuplicateColumnNames) ||
    enforcedFail(config, "required_columns_complete", !structure.noMergedHeaders) ||
    enforcedFail(config, "required_columns_complete", !structure.notBlankDataset) ||
    enforcedFail(config, "required_columns_complete", !structure.validHeaderRow) ||
    enforcedFail(config, "no_pivot_format", !structure.notPivotFormat);

  const criticalDataFail =
    enforcedFail(config, "no_missing_mandatory", !dataQuality.missingRequiredValues) ||
    enforcedFail(config, "dates_valid", !dataQuality.invalidDates) ||
    enforcedFail(config, "data_types_valid", !dataQuality.invalidNumbers) ||
    enforcedFail(config, "data_types_valid", !dataQuality.invalidPatterns) ||
    enforcedFail(config, "no_duplicate_rows", !dataQuality.duplicateRows) ||
    enforcedFail(config, "data_types_valid", !dataQuality.invalidCategories);

  const namingFail = enforcedFail(config, "file_naming_valid", !fnOk);
  const passed = !criticalStructureFail && !criticalDataFail && !namingFail;

  const checklistHints: Record<string, boolean> = {
    file_naming_valid: fnOk,
    required_columns_complete: missingCols.length === 0,
    no_pivot_format: pivotRuleActive ? !pivot.likelyPivot : true,
    no_missing_mandatory: !missingRequiredValues,
    data_types_valid:
      !invalidNumbers && !invalidDates && !invalidPatterns && !invalidCategories,
    dates_valid: !invalidDates,
    no_duplicate_rows: !duplicateRows,
    warnings_acknowledged: warningCount === 0,
  };

  const canProceed = passed;

  const summary = {
    totalRows: table.rows.length,
    invalidValueCount: issues.filter((i) =>
      ["INVALID_NUMBER", "INVALID_DATE", "INVALID_PATTERN", "INVALID_CATEGORY"].includes(
        i.code,
      ),
    ).length,
    duplicateRowCount: duplicateRows ? dupGroups.reduce((a, g) => a + g.length, 0) : 0,
    missingRequiredCount: issues.filter((i) => i.code === "MISSING_VALUE").length,
    warningCount,
    errorCount,
  };

  const previewRows = table.rows.slice(0, 25);

  return {
    passed,
    canProceed,
    summary,
    structure,
    dataQuality,
    pivot,
    issues,
    previewRows,
    checklistHints,
  };
}

function buildEmptyResult(
  issues: ValidationIssue[],
  fileReadable: boolean,
  delimiterOk: boolean,
  fileName: string,
  config: WorkflowValidationConfig,
): ValidationEngineResult {
  const fnOk = fileNameValid(fileName, config.pass_rules?.file_name_pattern);
  return {
    passed: false,
    canProceed: false,
    summary: { totalRows: 0, errorCount: issues.length, warningCount: 0 },
    structure: {
      fileTypeAllowed: false,
      fileReadable,
      notPivotFormat: true,
      noMergedHeaders: true,
      requiredColumnsExist: false,
      noDuplicateColumnNames: true,
      validHeaderRow: false,
      notBlankDataset: false,
      delimiterOk,
    },
    dataQuality: {
      missingRequiredValues: false,
      invalidDates: false,
      invalidNumbers: false,
      invalidPatterns: false,
      duplicateRows: false,
      columnMismatch: false,
      invalidCategories: false,
    },
    pivot: { score: 0, signals: [], likelyPivot: false },
    issues,
    previewRows: [],
    checklistHints: {
      file_naming_valid: fnOk,
      required_columns_complete: false,
      no_pivot_format: true,
      no_missing_mandatory: false,
      data_types_valid: false,
      dates_valid: false,
      no_duplicate_rows: false,
      warnings_acknowledged: true,
    },
  };
}
