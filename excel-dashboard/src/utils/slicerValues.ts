import type { ColumnSchema, SheetSnapshot } from '../types/dashboard'
import { formatCellForDisplay } from './inferTypes'

const MAX_SCAN_ROWS = 12_000

export interface SlicerOptionsResult {
  values: string[]
  /** True if more distinct values exist than returned */
  truncated: boolean
}

/**
 * Distinct formatted values for slicer chips (separate from table facet caps).
 * Capped so very wide columns still get a usable slicer.
 */
export function getSlicerOptionValues(
  snapshot: SheetSnapshot,
  columnKey: string,
  col: ColumnSchema | undefined,
  maxValues = 500,
): SlicerOptionsResult {
  if (!col) return { values: [], truncated: false }
  const uniq = new Set<string>()
  const n = Math.min(snapshot.rows.length, MAX_SCAN_ROWS)
  for (let ri = 0; ri < n; ri++) {
    const raw = snapshot.rows[ri]![columnKey]
    const s = formatCellForDisplay(raw, col)
    if (s !== '') uniq.add(s)
    if (uniq.size > maxValues + 1) break
  }
  const truncated = uniq.size > maxValues
  const arr = [...uniq].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  return { values: arr.slice(0, maxValues), truncated }
}
