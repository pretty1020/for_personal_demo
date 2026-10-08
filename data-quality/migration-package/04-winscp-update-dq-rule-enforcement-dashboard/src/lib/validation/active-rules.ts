import { DEFAULT_CHECKLIST_ITEMS } from "@/lib/workflows/defaults";
import type { WorkflowValidationConfig } from "@/lib/validation/types";

/** Engine checklist keys that can block validation when present + critical. */
export type EngineRuleKey =
  | "file_naming_valid"
  | "required_columns_complete"
  | "no_pivot_format"
  | "no_missing_mandatory"
  | "data_types_valid"
  | "dates_valid"
  | "no_duplicate_rows"
  | "warnings_acknowledged";

const DEFAULT_CRITICAL = new Set(
  DEFAULT_CHECKLIST_ITEMS.filter((i) => i.is_critical).map((i) => i.item_key),
);

function normalizeRuleKey(key: string): string {
  return key.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

const PIVOT_RULE_KEYS = new Set([
  "no_pivot_format",
  "pivot_layout",
  "no_pivot",
  "pivot",
]);

function ruleKeysMatch(a: string, b: string): boolean {
  const na = normalizeRuleKey(a);
  const nb = normalizeRuleKey(b);
  if (na === nb) return true;
  return PIVOT_RULE_KEYS.has(na) && PIVOT_RULE_KEYS.has(nb);
}

/**
 * Whether the workflow currently includes this audit rule.
 * When checklist_rules is omitted (legacy callers), default engine keys are treated as present.
 * Pivot rule also matches common aliases (Pivot_layout, etc.).
 */
export function isRulePresent(
  config: WorkflowValidationConfig,
  itemKey: string,
): boolean {
  const rules = config.checklist_rules;
  if (rules === undefined) {
    return DEFAULT_CHECKLIST_ITEMS.some((i) => ruleKeysMatch(i.item_key, itemKey));
  }
  return rules.some((r) => ruleKeysMatch(r.item_key, itemKey));
}

/**
 * Enforce only when the rule is in the active list AND marked critical.
 * Removed or non-critical rules must not fail the engine pass.
 */
export function isRuleEnforced(
  config: WorkflowValidationConfig,
  itemKey: EngineRuleKey,
): boolean {
  const rules = config.checklist_rules;
  if (rules === undefined) {
    return DEFAULT_CRITICAL.has(itemKey);
  }
  const hit = rules.find((r) => ruleKeysMatch(r.item_key, itemKey));
  return Boolean(hit?.is_critical);
}

/** True when an enforced rule's check failed. */
export function enforcedFail(
  config: WorkflowValidationConfig,
  itemKey: EngineRuleKey,
  failed: boolean,
): boolean {
  return failed && isRuleEnforced(config, itemKey);
}

/**
 * Map error codes to the checklist rule that owns them.
 * Codes without a mapping are baseline (always emit as errors when they occur).
 */
export function ruleKeyForIssueCode(code: string): EngineRuleKey | null {
  switch (code) {
    case "PIVOT_LAYOUT":
      return "no_pivot_format";
    case "MISSING_COLUMNS":
    case "DUP_HEADERS":
    case "MERGED_HEADERS":
    case "BLANK_DATA":
    case "MIN_ROWS":
      return "required_columns_complete";
    case "MISSING_VALUE":
      return "no_missing_mandatory";
    case "INVALID_DATE":
      return "dates_valid";
    case "INVALID_NUMBER":
    case "INVALID_PATTERN":
    case "INVALID_CATEGORY":
      return "data_types_valid";
    case "DUPLICATE_ROWS":
      return "no_duplicate_rows";
    case "FILE_NAME":
      return "file_naming_valid";
    default:
      return null;
  }
}

/**
 * Decide whether to emit an issue for a rule-owned check.
 * Returns null = skip (rule removed). Non-critical → warning.
 */
export function issueSeverityForRule(
  config: WorkflowValidationConfig,
  itemKey: EngineRuleKey | null,
): "error" | "warning" | null {
  if (itemKey == null) return "error";
  if (!isRulePresent(config, itemKey)) return null;
  if (!isRuleEnforced(config, itemKey)) return "warning";
  return "error";
}
