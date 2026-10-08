import type { SlicerRole } from './slicerColumns'
import { SLICER_SPECS } from './slicerColumns'

/**
 * Combine auto header matching with per-role manual picks.
 * `manual[role]` missing → use auto; `''` → no slicer; non-empty string → that column key.
 */
export function mergeSlicerColumnKeys(
  auto: Partial<Record<SlicerRole, string>>,
  manual: Partial<Record<SlicerRole, string>>,
): Partial<Record<SlicerRole, string>> {
  const out: Partial<Record<SlicerRole, string>> = {}
  for (const spec of SLICER_SPECS) {
    const m = manual[spec.role]
    if (m === '') continue
    if (m && m.length > 0) {
      out[spec.role] = m
      continue
    }
    if (auto[spec.role]) out[spec.role] = auto[spec.role]
  }
  return out
}
