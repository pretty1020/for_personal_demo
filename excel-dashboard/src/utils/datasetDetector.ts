import type {
  CanonicalField,
  DatasetDetectionIssue,
  DatasetDetectionReport,
  DatasetKind,
  DetectedDataset,
  SheetSnapshot,
} from '../types/dashboard'
import { normalizeHeaderLabel } from './slicerColumns'
import { labelDatasetKind } from './datasetLabels'
import { countWeekLikeColumns, parseOpsWeekColumnHeader } from './opsWeekHeaders'

function normSheetName(s: string): string {
  return s
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
}

function scoreSheetForDataset(sheetName: string, dataset: DatasetKind): number {
  const n = normSheetName(sheetName)
  const has = (frag: string) => n.includes(frag)

  if (dataset === 'datasheet') {
    if (n === 'datasheet') return 1
    if (n.startsWith('datasheet')) return 0.92
    if (has('data') && has('sheet')) return 0.86
    return 0
  }
  if (dataset === 'commit_vs_actuals') {
    if (has('commit') && has('actual')) return 0.98
    if (has('commitvsactual') || has('commitactual')) return 0.96
    if (has('commit') && has('vs')) return 0.9
    return 0
  }
  if (dataset === 'budget_vs_trending') {
    if (has('budget') && (has('trend') || has('trending'))) return 0.95
    if (has('budgetvstrend')) return 0.95
    return 0
  }
  if (dataset === 'lw_cw_datasheet') {
    if ((has('lwcw') || (has('lw') && has('cw'))) && has('datasheet')) return 0.95
    if (has('lwcw') && has('data')) return 0.9
    return 0
  }
  // Single-tab datasets
  const single: Record<
    Exclude<DatasetKind, 'datasheet' | 'commit_vs_actuals' | 'budget_vs_trending' | 'lw_cw_datasheet'>,
    string[]
  > =
    {
      attrition: ['attrition'],
      shrinkage: ['shrink', 'shrinkage'],
      headcount: ['headcount', 'hc'],
      aht: ['aht', 'handle', 'avghandletime'],
      revenue: ['revenue', 'rev'],
      fte: ['fte'],
      commit: ['commit'],
      actuals: ['actual', 'actuals'],
    }
  const frags = (single as any)[dataset] as string[] | undefined
  if (!frags) return 0
  // Avoid stealing the combined Commit vs Actuals tab for single-scenario datasets.
  if ((dataset === 'commit' || dataset === 'actuals') && has('commit') && has('actual')) return 0
  for (const f of frags) {
    if (has(f)) return 0.9
  }
  return 0
}

const FIELD_ALIASES: Record<CanonicalField, string[]> = {
  project_code: ['project code', 'projectcode', 'project id', 'projectid'],
  // Ops tabs sometimes label client as "Campaign"
  client_name: ['client name', 'client', 'customer name', 'customer', 'account name', 'account', 'campaign'],
  project_name: ['project name', 'project', 'engagement', 'program name', 'program'],
  du: ['du', 'delivery unit', 'deliveryunit', 'd.u.'],
  location: ['location', 'country', 'site', 'region', 'loc'],
  scenario: ['scenario', 'category', 'version', 'plan type'],
  fy: ['fy', 'fiscal year', 'fiscalyear', 'year'],
  month: ['month', 'period', 'fiscal month', 'fiscalmonth'],
  // Do not map "Data Point" here — on Headcount/AHT/etc. that is a row label, not a week column.
  // Wide week columns use date-like headers (1/4/2026); those are detected separately in merge.
  week: ['week', 'wk', 'week ending', 'weekending', 'we'],
  date: ['date', 'as of', 'asof', 'day'],
}

function bestMatchColumnKey(snapshot: SheetSnapshot, field: CanonicalField): string | null {
  const aliases = FIELD_ALIASES[field].map(normalizeHeaderLabel)
  let best: { key: string; score: number } | null = null
  for (const c of snapshot.columns) {
    const h = normalizeHeaderLabel(c.header)
    let score = 0
    for (const a of aliases) {
      if (h === a) score = Math.max(score, 100 + a.length)
      else if (h.replace(/\s/g, '') === a.replace(/\s/g, '')) score = Math.max(score, 92 + a.length)
      else if (a.length >= 4 && h.includes(a)) score = Math.max(score, 40 + a.length)
      else if (a.length >= 3 && h.startsWith(a)) score = Math.max(score, 20 + a.length)
    }
    if (score > 0 && (!best || score > best.score)) best = { key: c.key, score }
  }
  if (best) return best.key

  // Value-pattern fallback for Project Code when headers are missing/messy (e.g. column A).
  if (field === 'project_code') {
    const pick = guessProjectCodeColumnByValues(snapshot)
    return pick
  }

  return null
}

function normalizeProjectCodeForHeuristic(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  if (!s) return null
  const upper = s.toUpperCase()
  // Remove typical separators and hidden chars; keep A-Z/0-9 only.
  const compact = upper.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/[^A-Z0-9]/g, '')
  if (!compact) return null
  // Avoid pure numbers (those are usually IDs/amounts, not codes) unless very short.
  if (/^\d+$/.test(compact) && compact.length >= 6) return null
  return compact
}

function guessProjectCodeColumnByValues(snapshot: SheetSnapshot): string | null {
  if (snapshot.columns.length === 0 || snapshot.rows.length === 0) return null
  let best: { key: string; score: number } | null = null

  const sampleN = Math.min(snapshot.rows.length, 800)

  for (let colIdx = 0; colIdx < snapshot.columns.length; colIdx++) {
    const c = snapshot.columns[colIdx]!
    const values: string[] = []
    let seenAny = 0
    let nonNull = 0
    for (let i = 0; i < sampleN; i++) {
      const raw = snapshot.rows[i]![c.key]
      if (raw === null || raw === undefined || raw === '') continue
      seenAny++
      const norm = normalizeProjectCodeForHeuristic(raw)
      if (!norm) continue
      nonNull++
      values.push(norm)
    }

    if (seenAny < 8 || nonNull < 8) continue
    const uniq = new Set(values)
    const uniqRate = uniq.size / Math.max(values.length, 1)
    const avgLen = values.reduce((a, b) => a + b.length, 0) / Math.max(values.length, 1)
    const plausibleLen = avgLen >= 3 && avgLen <= 22
    const hitRate = nonNull / Math.max(seenAny, 1)

    // Heuristic: mostly convertible to compact code, fairly unique, plausible length.
    let score = 0
    if (hitRate >= 0.75) score += 50 * hitRate
    if (uniqRate >= 0.55) score += 45 * Math.min(1, uniqRate)
    if (plausibleLen) score += 18
    // Column A bias (user’s workbook convention)
    if (colIdx === 0) score += 12

    if (score > 0 && (!best || score > best.score)) best = { key: c.key, score }
  }

  return best && best.score >= 55 ? best.key : null
}

/** When headers are missing but column A holds CTR|… codes or “Missing” placeholders (common on Headcount tab). */
function guessProjectCodeFirstColumnFallback(snapshot: SheetSnapshot): string | null {
  const c0 = snapshot.columns[0]
  if (!c0 || snapshot.rows.length === 0) return null

  const sampleN = Math.min(snapshot.rows.length, 400)
  let n = 0
  let ok = 0
  for (let i = 0; i < sampleN; i++) {
    const raw = snapshot.rows[i]![c0.key]
    const s = String(raw ?? '').trim()
    if (!s) continue
    n++
    const looksCode = /\|/.test(s) || /^MISSING$/i.test(s) || /\bCTR\b/i.test(s)
    const norm = normalizeProjectCodeForHeuristic(raw)
    if ((looksCode || norm) && norm !== null) ok++
  }

  if (n < 4 || ok / n < 0.45) return null
  return c0.key
}

export function requiredFieldsForDataset(dataset: DatasetKind): CanonicalField[] {
  // Minimal required fields for cross-dataset alignment; we’ll expand per-metric datasets later.
  const base: CanonicalField[] = ['project_code']
  if (
    dataset === 'datasheet' ||
    dataset === 'commit_vs_actuals' ||
    dataset === 'budget_vs_trending' ||
    dataset === 'lw_cw_datasheet'
  ) {
    return [...base, 'fy', 'month', 'scenario', 'client_name', 'location']
  }
  if (dataset === 'attrition' || dataset === 'shrinkage' || dataset === 'headcount' || dataset === 'aht') {
    return [...base, 'week']
  }
  return [...base, 'fy', 'month', 'scenario']
}

function requiredFieldsFor(dataset: DatasetKind): CanonicalField[] {
  return requiredFieldsForDataset(dataset)
}

export function detectDatasetsFromSnapshots(input: {
  sheetNames: string[]
  snapshots: Record<string, SheetSnapshot>
}): DatasetDetectionReport {
  const { sheetNames, snapshots } = input
  const kinds: DatasetKind[] = [
    'datasheet',
    'commit_vs_actuals',
    'budget_vs_trending',
    'lw_cw_datasheet',
    'attrition',
    'shrinkage',
    'headcount',
    'aht',
    'revenue',
    'fte',
    'commit',
    'actuals',
  ]

  const detected: DetectedDataset[] = []
  const issues: DatasetDetectionIssue[] = []

  for (const dataset of kinds) {
    let best: { sheetName: string; score: number } | null = null
    for (const name of sheetNames) {
      const s = scoreSheetForDataset(name, dataset)
      if (s > 0 && (!best || s > best.score)) best = { sheetName: name, score: s }
    }
    if (!best) {
      issues.push({
        kind: 'missing_sheet',
        dataset,
        message: `Missing sheet for ${labelDatasetKind(dataset)}.`,
      })
      continue
    }

    const snap = snapshots[best.sheetName]
    if (!snap) continue

    const required = requiredFieldsFor(dataset)
    const fieldMap: Partial<Record<CanonicalField, string>> = {}
    for (const f of required) {
      const k = bestMatchColumnKey(snap, f)
      if (k) fieldMap[f] = k
    }

    const OPS_WEEKLY: DatasetKind[] = ['attrition', 'shrinkage', 'headcount', 'aht']
    if (OPS_WEEKLY.includes(dataset) && countWeekLikeColumns(snap) >= 3) {
      const wk = snap.columns.find((c) => parseOpsWeekColumnHeader(c.header))
      if (wk) fieldMap.week = wk.key
    }

    const missingRequired = required.filter((f) => !fieldMap[f])
    if (best.score < 0.7) {
      issues.push({
        kind: 'low_confidence',
        dataset,
        sheetName: best.sheetName,
        message: `Low confidence matching “${best.sheetName}” → ${labelDatasetKind(dataset)}.`,
      })
    }
    for (const f of missingRequired) {
      issues.push({
        kind: 'missing_required_field',
        dataset,
        sheetName: best.sheetName,
        field: f,
        message: `Sheet “${best.sheetName}” is missing required field: ${f.replace(/_/g, ' ')}.`,
      })
    }

    detected.push({
      dataset,
      sheetName: best.sheetName,
      confidence: best.score,
      fieldMap,
      missingRequired,
    })
  }

  // PnL (Datasheet) sanity checks for GM and GM% presence (user requirement: AI=GM, AJ=GM%).
  const ds = detected.find((d) => d.dataset === 'datasheet')
  if (ds) {
    const snap = snapshots[ds.sheetName]
    if (snap) {
      const headers = snap.columns.map((c) => normalizeHeaderLabel(c.header))
      const hasGm = headers.some((h) => h === 'gm' || h.includes('gross margin') || (h.includes('margin') && !h.includes('%')))
      const hasGmPct = headers.some(
        (h) =>
          h === 'gm%' ||
          h === 'gm %' ||
          h.includes('gm%') ||
          (h.includes('margin') && (h.includes('%') || h.includes('pct') || h.includes('percent'))),
      )
      if (!hasGm) {
        issues.push({
          kind: 'missing_required_field',
          dataset: 'datasheet',
          sheetName: ds.sheetName,
          field: 'date',
          message: `Datasheet is missing GM column (expected “GM” in column AI).`,
        })
      }
      if (!hasGmPct) {
        issues.push({
          kind: 'missing_required_field',
          dataset: 'datasheet',
          sheetName: ds.sheetName,
          field: 'date',
          message: `Datasheet is missing GM% column (expected “GM%” in column AJ).`,
        })
      }
    }
  }

  // Duplicate-sheet check (same sheet picked for multiple datasets)
  const bySheet = new Map<string, DatasetKind[]>()
  for (const d of detected) {
    if (!bySheet.has(d.sheetName)) bySheet.set(d.sheetName, [])
    bySheet.get(d.sheetName)!.push(d.dataset)
  }
  for (const [sheetName, ds] of bySheet.entries()) {
    if (ds.length <= 1) continue
    issues.push({
      kind: 'duplicate_sheet',
      sheetName,
      message: `Sheet “${sheetName}” matched multiple datasets: ${ds.join(', ')}.`,
    })
  }

  // Ops weekly tabs: ensure Project Code maps even when the header row is blank/unusual but column A has CTR|… values.
  const OPS_WEEKLY: DatasetKind[] = ['attrition', 'shrinkage', 'headcount', 'aht']
  for (const d of detected) {
    if (!OPS_WEEKLY.includes(d.dataset)) continue
    const snap = snapshots[d.sheetName]
    if (!snap || d.fieldMap.project_code) continue
    const key = guessProjectCodeColumnByValues(snap) ?? guessProjectCodeFirstColumnFallback(snap)
    if (key) {
      d.fieldMap.project_code = key
      const missingIdx = d.missingRequired.indexOf('project_code')
      if (missingIdx !== -1) d.missingRequired.splice(missingIdx, 1)
    }
  }

  return { detected, issues }
}

