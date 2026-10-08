import type { ColumnSchema, SheetSnapshot } from '../types/dashboard'
import { applyFiscalCalendarRepair } from './fiscalMonthRepair'
import { coerceCell, inferColumnType, inferDateGranularity } from './inferTypes'

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === '' || (typeof value === 'string' && value.trim() === '')
}

/**
 * Drops columns that have no data in any row, and rows that are completely empty.
 * Re-infers column types on the cleaned sample. `rawMatrix` is left unchanged (original Excel grid).
 */
export function cleanSheetSnapshot(snapshot: SheetSnapshot): SheetSnapshot {
  if (snapshot.columns.length === 0 || snapshot.rows.length === 0) {
    return snapshot
  }

  const keys = snapshot.columns.map((c) => c.key)
  const keepKeys = keys.filter((k) => snapshot.rows.some((r) => !isBlank(r[k])))

  if (keepKeys.length === 0) {
    return {
      ...snapshot,
      columns: [],
      rows: [],
    }
  }

  const colByKey = new Map(snapshot.columns.map((c) => [c.key, c]))
  const slimRows = snapshot.rows
    .map((r) => {
      const o: Record<string, unknown> = {}
      for (const k of keepKeys) {
        o[k] = r[k]
      }
      return o
    })
    .filter((r) => keepKeys.some((k) => !isBlank(r[k])))

  if (slimRows.length === 0) {
    return { ...snapshot, columns: [], rows: [] }
  }

  const samples = keepKeys.map((k) => slimRows.map((r) => r[k]))
  const newColumns: ColumnSchema[] = keepKeys.map((k, i) => {
    const prev = colByKey.get(k)!
    const colSamples = samples[i] ?? []
    const type = inferColumnType(prev.header, colSamples)
    return {
      key: k,
      header: prev.header,
      type,
      ...(type === 'date' ? { dateGranularity: inferDateGranularity(prev.header, colSamples, type) } : {}),
    }
  })

  const rows = slimRows.map((r) => {
    const o: Record<string, unknown> = {}
    for (const c of newColumns) {
      o[c.key] = coerceCell(r[c.key], c.type)
    }
    return o
  })

  const repaired = applyFiscalCalendarRepair(newColumns, rows)

  return {
    name: snapshot.name,
    columns: repaired.columns,
    rows: repaired.rows,
    rawMatrix: snapshot.rawMatrix,
  }
}
