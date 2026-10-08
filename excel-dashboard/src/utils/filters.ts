import type { ColumnFilters, ColumnFilterValue, ColumnSchema, SheetSnapshot } from '../types/dashboard'
import { formatCellForDisplay } from './inferTypes'

function matchesOneFilter(cell: unknown, col: ColumnSchema | undefined, needle: ColumnFilterValue): boolean {
  if (cell === null || cell === undefined) return false

  const display = formatCellForDisplay(cell, col)
  if (Array.isArray(needle)) {
    if (needle.length === 0) return true
    return needle.some((n) => display === n)
  }
  const raw = typeof needle === 'string' ? needle.trim() : ''
  if (!raw) return true
  return display.toLowerCase().includes(raw.toLowerCase())
}

function rowMatchesFilters(
  row: Record<string, unknown>,
  filters: ColumnFilters,
  columns: ColumnSchema[],
): boolean {
  const colByKey = new Map(columns.map((c) => [c.key, c]))
  for (const [key, needle] of Object.entries(filters)) {
    if (needle === undefined || needle === '') continue
    if (Array.isArray(needle) && needle.length === 0) continue

    const cell = row[key]
    const col = colByKey.get(key)
    if (!matchesOneFilter(cell, col, needle)) return false
  }
  return true
}

export function applyFilters(snapshot: SheetSnapshot, filters: ColumnFilters): SheetSnapshot {
  const rows = snapshot.rows.filter((r) => rowMatchesFilters(r, filters, snapshot.columns))
  return {
    ...snapshot,
    rows,
  }
}
