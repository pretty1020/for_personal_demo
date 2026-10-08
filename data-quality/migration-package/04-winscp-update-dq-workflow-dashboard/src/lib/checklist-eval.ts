import type { ChecklistItemRow, ChecklistResultRow } from "@/types/database";
import { DEFAULT_CHECKLIST_ITEMS } from "@/lib/workflows/defaults";

export const ENGINE_CHECKLIST_KEYS = new Set(
  DEFAULT_CHECKLIST_ITEMS.map((item) => item.item_key),
);

export function isEngineChecklistKey(itemKey: string) {
  return ENGINE_CHECKLIST_KEYS.has(itemKey);
}

/** @deprecated Use resolveChecklistResult */
export function checklistAutoPass(
  hints: Record<string, boolean>,
  itemKey: string,
  warningCount: number,
) {
  return resolveChecklistResult(hints, itemKey, warningCount).passed;
}

/** Compute initial passed/acknowledged for a checklist row after validation. */
export function resolveChecklistResult(
  hints: Record<string, boolean>,
  itemKey: string,
  warningCount: number,
): { passed: boolean; acknowledged: boolean } {
  if (itemKey === "warnings_acknowledged") {
    // Warnings do not block "Passed" on the Dashboard — auto-ack so processed
    // status still applies when validation otherwise passed.
    void warningCount;
    return { passed: true, acknowledged: true };
  }
  if (isEngineChecklistKey(itemKey)) {
    const ok = Boolean(hints[itemKey]);
    return { passed: ok, acknowledged: ok };
  }
  // Custom/manual items require operator review before processing
  return { passed: false, acknowledged: false };
}

export function summarizeChecklistResults(
  defs: Pick<ChecklistItemRow, "item_key" | "label" | "is_critical">[],
  results: Pick<ChecklistResultRow, "item_key" | "passed" | "acknowledged">[],
): string | null {
  const open: string[] = [];
  for (const def of defs) {
    const row = results.find((r) => r.item_key === def.item_key);
    if (!row?.passed || !row.acknowledged) {
      open.push(def.label);
    }
  }
  if (!open.length) return null;
  return `Open checklist: ${open.slice(0, 8).join(", ")}${open.length > 8 ? "…" : ""}`;
}

export function checklistGateOk(
  defs: Pick<ChecklistItemRow, "item_key" | "label" | "is_critical">[],
  results: Pick<ChecklistResultRow, "item_key" | "passed" | "acknowledged">[],
) {
  const reasons: string[] = [];
  for (const def of defs) {
    if (!def.is_critical) continue;
    const row = results.find((r) => r.item_key === def.item_key);
    if (!row?.passed || !row.acknowledged) {
      reasons.push(`Checklist not satisfied: ${def.label}`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}

export function needsManualChecklistReview(
  items: Pick<ChecklistItemRow, "item_key" | "is_critical">[],
  results: Pick<ChecklistResultRow, "item_key" | "passed" | "acknowledged">[],
) {
  for (const item of items) {
    if (!item.is_critical || isEngineChecklistKey(item.item_key)) continue;
    const row = results.find((r) => r.item_key === item.item_key);
    if (!row?.passed || !row.acknowledged) return true;
  }
  return false;
}
