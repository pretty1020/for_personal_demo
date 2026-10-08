import type { SheetSnapshot } from '../types/dashboard'
import { formatCellForDisplay } from './inferTypes'

export type ColumnFacet =
  | { mode: 'select'; values: string[] }
  | { mode: 'text' }
  | { mode: 'daterange' }

const MAX_SELECT_VALUES = 220
/** Scan at most this many rows per column so sheet switches stay responsive on huge sheets. */
const MAX_ROWS_TO_SCAN_FOR_FACETS = 8_000

export function computeColumnFacets(snapshot: SheetSnapshot): Record<string, ColumnFacet> {
  const out: Record<string, ColumnFacet> = {}
  for (const col of snapshot.columns) {
    /* Day-level dates: from/to pickers. Month bucket columns: text/select on "Jan 2026" labels. */
    if (col.type === 'date' && col.dateGranularity !== 'month') {
      out[col.key] = { mode: 'daterange' }
      continue
    }
    const uniq = new Set<string>()
    const n = Math.min(snapshot.rows.length, MAX_ROWS_TO_SCAN_FOR_FACETS)
    for (let ri = 0; ri < n; ri++) {
      const r = snapshot.rows[ri]!
      const s = formatCellForDisplay(r[col.key], col)
      if (s !== '') uniq.add(s)
      if (uniq.size > MAX_SELECT_VALUES + 1) break
    }
    if (uniq.size > MAX_SELECT_VALUES) {
      out[col.key] = { mode: 'text' }
    } else {
      out[col.key] = {
        mode: 'select',
        values: [...uniq].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
      }
    }
  }
  return out
}
