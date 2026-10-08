import type { ColumnSchema, SheetSnapshot, TransformLogEntry, TransformationResult } from '../types/dashboard'
import { coerceCell, inferColumnType, inferDateGranularity, tryCoerceDate } from './inferTypes'
import { normalizeHeaderLabel } from './slicerColumns'

function stripHiddenChars(s: string): string {
  return s.replace(/[\u200B-\u200D\uFEFF]/g, '')
}

function normalizeHeaderDisplay(header: string): string {
  return stripHiddenChars(header).replace(/\s+/g, ' ').trim()
}

function normalizeProjectCode(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  const s = stripHiddenChars(String(raw)).trim()
  if (!s) return null
  /**
   * Preserve human-readable code format (pipes/hyphens) while normalizing:
   * - uppercase
   * - remove hidden chars
   * - collapse whitespace
   * - trim spaces around common separators
   */
  const upper = s.toUpperCase().replace(/\s+/g, ' ').trim()
  const tightened = upper
    .replace(/\s*\|\s*/g, '|')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s*_\s*/g, '_')
  return tightened || null
}

function shouldKeepPercentPoints(header: string): boolean {
  const h = normalizeHeaderLabel(header)
  // Business convention: shrinkage/attrition/rate columns are easier to read as percent points (e.g. 12.3).
  return (
    h.includes('shrink') ||
    h.includes('attrition') ||
    h.includes('util') ||
    h.includes('rate') ||
    h.includes('percent') ||
    h.includes('%')
  )
}

function tryParseNumberLoose(v: unknown, header: string): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (!t) return null
  const cleaned = t
    .replace(/[,$€£\s]/g, '')
    .replace(/\(([^)]+)\)/, '-$1') // (123) -> -123
  const pct = /%$/.test(t)
  const num = Number.parseFloat(cleaned.replace(/%/g, ''))
  if (!Number.isFinite(num)) return null
  if (pct) {
    // For shrinkage-like fields, keep in % points; otherwise keep legacy decimal.
    return shouldKeepPercentPoints(header) ? num : num / 100
  }
  return num
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (typeof v === 'string' && v.trim() === '')
}

function sheetKeySignature(row: Record<string, unknown>, keys: string[]): string {
  return keys.map((k) => String(row[k] ?? '')).join('||')
}

export interface TransformOptions {
  /** Column keys in each sheet that should be treated as Project Code. */
  projectCodeKeysBySheet?: Record<string, string[]>
  /** Optional per-sheet key columns for dedupe/drop-null (already mapped to column keys). */
  keyColumnsBySheet?: Record<string, string[]>
}

export function transformSnapshot(snapshot: SheetSnapshot, opts: TransformOptions, logs: TransformLogEntry[]): SheetSnapshot {
  if (snapshot.columns.length === 0 || snapshot.rows.length === 0) return snapshot

  const sheetName = snapshot.name

  // 1) Normalize header display text (do not change stable keys here).
  const normalizedColumns: ColumnSchema[] = snapshot.columns.map((c) => {
    const h = normalizeHeaderDisplay(c.header)
    return h === c.header ? c : { ...c, header: h }
  })
  if (normalizedColumns.some((c, idx) => c.header !== snapshot.columns[idx]?.header)) {
    logs.push({
      sheetName,
      action: 'normalize_headers',
      message: 'Normalized header spacing/hidden characters.',
    })
  }

  // 2) Trim all text cells (and strip hidden chars).
  const trimmedRows = snapshot.rows.map((r) => {
    const o: Record<string, unknown> = { ...r }
    for (const c of normalizedColumns) {
      const v = o[c.key]
      if (typeof v === 'string') {
        const next = stripHiddenChars(v).replace(/\s+/g, ' ').trim()
        o[c.key] = next === '' ? null : next
      }
    }
    return o
  })
  logs.push({
    sheetName,
    action: 'trim_text',
    message: 'Trimmed whitespace on text cells.',
  })

  // 3) Normalize Project Code on detected keys.
  const explicitProjectKeys = (opts.projectCodeKeysBySheet?.[sheetName] ?? []).filter(Boolean)
  const guessedProjectKeys = explicitProjectKeys.length ? [] : guessProjectCodeKeysByValues(snapshot, normalizedColumns)
  const projectKeys = explicitProjectKeys.length ? explicitProjectKeys : guessedProjectKeys
  const projectKeySet = new Set(projectKeys)
  let projectTouched = 0
  const projRows =
    projectKeys.length === 0
      ? trimmedRows
      : trimmedRows.map((r) => {
          const o: Record<string, unknown> = { ...r }
          for (const k of projectKeys) {
            const prev = o[k]
            const next = normalizeProjectCode(prev)
            if (next !== null && next !== prev) projectTouched++
            o[k] = next
          }
          return o
        })
  if (projectKeys.length > 0) {
    logs.push({
      sheetName,
      action: 'normalize_project_code',
      message: `Normalized Project Code on ${projectKeys.length} column(s).`,
      details: { touchedCells: projectTouched },
    })
  }

  // 4) Improve coercion: attempt numeric/date coercion even when inferred type was text, based on samples.
  const colSamples = normalizedColumns.map((c) => projRows.map((r) => r[c.key]).filter((v) => !isBlank(v)).slice(0, 800))
  const coercedColumns: ColumnSchema[] = normalizedColumns.map((c, i) => {
    // Project Code must never be treated as a date/number (prevents Date.parse("26001") -> year 26001).
    if (projectKeySet.has(c.key)) {
      return { ...c, type: 'text' }
    }
    const samples = colSamples[i] ?? []
    const inferred = inferColumnType(c.header, samples)
    if (inferred === c.type) return c
    const dateGranularity = inferred === 'date' ? inferDateGranularity(c.header, samples, inferred) : undefined
    return { ...c, type: inferred, ...(inferred === 'date' ? { dateGranularity } : {}) }
  })

  const coercedRows = projRows.map((r) => {
    const o: Record<string, unknown> = { ...r }
    for (const c of coercedColumns) {
      const v = o[c.key]
      if (projectKeySet.has(c.key)) {
        // Preserve readable Project Code format (e.g. CTR|MIC-PH-26002)
        o[c.key] = normalizeProjectCode(v)
        continue
      }
      if (c.type === 'number' && typeof v === 'string') {
        const n = tryParseNumberLoose(v, c.header)
        if (n !== null) {
          o[c.key] = n
          continue
        }
      }
      if (c.type === 'date' && typeof v === 'string') {
        const d = tryCoerceDate(v)
        if (d) {
          o[c.key] = d
          continue
        }
      }
      o[c.key] = coerceCell(v, c.type)
    }
    return o
  })
  logs.push({
    sheetName,
    action: 'coerce_numbers',
    message: 'Coerced numeric cells with currency/percent formatting.',
  })
  logs.push({
    sheetName,
    action: 'coerce_dates',
    message: 'Coerced date-like cells to Date objects where possible.',
  })

  // 5) Drop rows that are missing any key fields (if provided).
  const keyCols = (opts.keyColumnsBySheet?.[sheetName] ?? []).filter(Boolean)
  let filtered = coercedRows
  if (keyCols.length > 0) {
    const before = filtered.length
    filtered = filtered.filter((r) => keyCols.every((k) => !isBlank(r[k])))
    if (filtered.length !== before) {
      logs.push({
        sheetName,
        action: 'drop_null_key_rows',
        message: `Dropped rows missing key fields (${keyCols.join(', ')}).`,
        beforeRows: before,
        afterRows: filtered.length,
      })
    }
  }

  // 6) Dedupe rows by key columns if provided, else by full row signature (stable).
  const dedupeKeys = keyCols.length > 0 ? keyCols : coercedColumns.map((c) => c.key)
  const beforeDedupe = filtered.length
  const seen = new Set<string>()
  const deduped: typeof filtered = []
  for (const r of filtered) {
    const sig = sheetKeySignature(r, dedupeKeys)
    if (seen.has(sig)) continue
    seen.add(sig)
    deduped.push(r)
  }
  if (deduped.length !== beforeDedupe) {
    logs.push({
      sheetName,
      action: 'dedupe_rows',
      message: `Removed duplicate rows (${beforeDedupe - deduped.length}).`,
      beforeRows: beforeDedupe,
      afterRows: deduped.length,
      details: { dedupeBy: keyCols.length > 0 ? 'keyColumns' : 'fullRow' },
    })
  }

  return {
    name: sheetName,
    columns: coercedColumns.map((c) => ({
      ...c,
      header: normalizeHeaderDisplay(c.header),
    })),
    rows: deduped,
    rawMatrix: snapshot.rawMatrix,
  }
}

export function transformWorkbookSnapshots(input: {
  sheetNames: string[]
  snapshots: Record<string, SheetSnapshot>
  options?: TransformOptions
}): TransformationResult {
  const { sheetNames, snapshots, options } = input
  const logs: TransformLogEntry[] = []
  const out: Record<string, SheetSnapshot> = {}
  for (const name of sheetNames) {
    const snap = snapshots[name]
    if (!snap) continue
    out[name] = transformSnapshot(snap, options ?? {}, logs)
  }
  return { snapshots: out, logs }
}

/** Utility to pick likely Project Code keys by scanning headers for dataset detection. */
export function guessProjectCodeKeys(snapshot: SheetSnapshot): string[] {
  const out: string[] = []
  for (const c of snapshot.columns) {
    const h = normalizeHeaderLabel(c.header)
    if (h === 'project code' || h === 'projectcode' || h === 'project id' || h === 'projectid') out.push(c.key)
    else if (h.includes('project') && h.includes('code')) out.push(c.key)
  }
  return out
}

function guessProjectCodeKeysByValues(snapshot: SheetSnapshot, columns: ColumnSchema[]): string[] {
  if (snapshot.rows.length === 0 || columns.length === 0) return []
  const sampleN = Math.min(snapshot.rows.length, 800)

  const scoreCol = (key: string, idx: number): number => {
    let seenAny = 0
    let ok = 0
    const uniq = new Set<string>()
    let lenSum = 0
    for (let i = 0; i < sampleN; i++) {
      const raw = snapshot.rows[i]![key]
      if (raw === null || raw === undefined || raw === '') continue
      seenAny++
      const n = normalizeProjectCode(raw)
      if (!n) continue
      // Reject long pure numbers
      if (/^\d+$/.test(n) && n.length >= 6) continue
      ok++
      uniq.add(n)
      lenSum += n.length
    }
    if (seenAny < 8 || ok < 8) return 0
    const hitRate = ok / Math.max(seenAny, 1)
    const uniqRate = uniq.size / Math.max(ok, 1)
    const avgLen = lenSum / Math.max(ok, 1)
    const plausibleLen = avgLen >= 3 && avgLen <= 22
    let score = 0
    if (hitRate >= 0.75) score += 50 * hitRate
    if (uniqRate >= 0.55) score += 45 * Math.min(1, uniqRate)
    if (plausibleLen) score += 18
    if (idx === 0) score += 12
    return score
  }

  let best: { key: string; score: number } | null = null
  for (let idx = 0; idx < columns.length; idx++) {
    const k = columns[idx]!.key
    const s = scoreCol(k, idx)
    if (s > 0 && (!best || s > best.score)) best = { key: k, score: s }
  }

  return best && best.score >= 55 ? [best.key] : []
}

