import type { ColumnSchema, SheetSnapshot } from '../types/dashboard'
import { cleanSheetSnapshot } from './cleanSheetData'
import { coerceCell, inferColumnType, inferDateGranularity } from './inferTypes'

function hasValue(v: unknown): boolean {
  return !(v === null || v === undefined || String(v).trim() === '')
}

export function slugKey(base: string, used: Set<string>): string {
  let s = base
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .replace(/^_+/, '')
  if (!s) s = 'col'
  let out = s
  let i = 1
  while (used.has(out)) {
    out = `${s}_${i}`
    i++
  }
  used.add(out)
  return out
}

function chooseHeaderRowIndex(matrix: (unknown | null)[][]): number {
  const headerHints = [
    'data point',
    'week',
    'week ending',
    'project code',
    'project id',
    'client',
    'campaign',
    'location',
    'lob',
    'region',
    'aht',
    'shrinkage',
    'attrition',
    'headcount',
    'hc requirement',
    'hc projection',
    'assumption',
    'actual',
  ]

  const scoreRow = (row: (unknown | null)[]) => {
    let populated = 0
    let stringish = 0
    let hintHits = 0
    for (const cell of row) {
      if (!hasValue(cell)) continue
      populated++
      const s = String(cell).trim().toLowerCase()
      if (s) stringish++
      for (const h of headerHints) {
        if (s === h || s.includes(h)) {
          hintHits++
          break
        }
      }
    }
    // Prefer rows that look like real headers (many string labels + known hints)
    return hintHits * 10 + stringish * 2 + populated
  }

  const maxScan = Math.min(30, matrix.length)
  let bestIdx = 0
  let bestScore = -1
  for (let i = 0; i < maxScan; i++) {
    const row = matrix[i] ?? []
    if (row.filter(hasValue).length < 2) continue
    const s = scoreRow(row)
    if (s > bestScore) {
      bestScore = s
      bestIdx = i
    }
  }
  // Fallback: first populated row
  if (bestScore >= 0) return bestIdx
  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i] ?? []
    const populated = row.filter(hasValue).length
    if (populated >= 1) return i
  }
  return 0
}

/**
 * Build headers without generic `Column_1` labels.
 * If header cell is blank, pick the first non-empty value from that column.
 */
export function buildHeaders(
  headerRow: unknown[],
  dataRows: (unknown | null)[][],
  colCount: number,
): string[] {
  const headers: string[] = []
  for (let c = 0; c < colCount; c++) {
    const h = headerRow[c]
    let label = hasValue(h) ? String(h).trim() : ''
    if (!label) {
      for (let r = 0; r < dataRows.length; r++) {
        const v = dataRows[r]?.[c]
        if (!hasValue(v)) continue
        label = String(v).trim()
        break
      }
    }
    if (!label) {
      label = `Field ${c + 1}`
    }
    headers.push(label)
  }
  return headers
}

/** Build typed snapshot + preserve raw matrix (every row from Excel). */
export function matrixToSnapshot(sheetName: string, matrix: (unknown | null)[][]): SheetSnapshot {
  const rawMatrix = matrix.map((row) => [...row])

  if (!matrix.length) {
    return {
      name: sheetName,
      columns: [],
      rows: [],
      rawMatrix,
    }
  }

  const colCount = matrix.reduce((m, row) => Math.max(m, row?.length ?? 0), 0)
  if (colCount === 0) {
    return { name: sheetName, columns: [], rows: [], rawMatrix }
  }

  const headerRowIndex = chooseHeaderRowIndex(matrix)
  const headerRow = matrix[headerRowIndex] ?? []
  const dataRows = matrix.slice(headerRowIndex + 1)
  const headers = buildHeaders(headerRow, dataRows, colCount)
  const used = new Set<string>()
  const columnKeys = headers.map((h) => slugKey(h, used))

  const samplesPerCol: unknown[][] = Array.from({ length: colCount }, () => [])

  for (const row of dataRows) {
    for (let c = 0; c < colCount; c++) {
      const v = row?.[c] ?? null
      if (v !== null && v !== undefined && v !== '') {
        samplesPerCol[c].push(v)
      }
    }
  }

  const columns: ColumnSchema[] = headers.map((header, i) => {
    const samples = samplesPerCol[i] ?? []
    const type = inferColumnType(header, samples)
    return {
      key: columnKeys[i],
      header,
      type,
      ...(type === 'date' ? { dateGranularity: inferDateGranularity(header, samples, type) } : {}),
    }
  })

  const rows: Record<string, unknown>[] = []
  for (const row of dataRows) {
    const obj: Record<string, unknown> = {}
    let any = false
    for (let c = 0; c < colCount; c++) {
      const key = columnKeys[c]
      const raw = row?.[c] ?? null
      const coerced = coerceCell(raw, columns[c].type)
      obj[key] = coerced
      if (coerced !== null && coerced !== '') any = true
    }
    if (any) rows.push(obj)
  }

  return cleanSheetSnapshot({
    name: sheetName,
    columns,
    rows,
    rawMatrix,
  })
}
