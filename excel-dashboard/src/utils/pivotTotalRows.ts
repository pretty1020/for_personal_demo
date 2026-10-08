import type { ColumnSchema } from '../types/dashboard'
import { formatCellForDisplay } from './inferTypes'

/**
 * Detects pivot-style subtotal / grand total / quarter total rows so charts can omit them by default.
 */
export function rowLooksLikePivotTotal(row: Record<string, unknown>, columns: ColumnSchema[]): boolean {
  for (const c of columns) {
    const v = row[c.key]
    if (v === null || v === undefined) continue
    const s = formatCellForDisplay(v, c).trim().toLowerCase()
    if (!s) continue
    if (/\bgrand\s+total\b/.test(s)) return true
    if (/\bsubtotal\b/.test(s)) return true
    if (/\bfy\s*\d{2,4}\s*[-–]\s*q\s*[1-4]\s*total\b/i.test(s)) return true
    if (/^total$/i.test(s)) return true
    if (/\btotal\s*$/i.test(s) && /fy|quarter|\bq\s*[1-4]\b/i.test(s)) return true
  }
  return false
}
