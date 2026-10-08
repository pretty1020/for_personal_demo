import type {
  CanonicalField,
  DatasetDetectionReport,
  DatasetKind,
  ExecutiveMergedModel,
  ExecutiveUnifiedRow,
  SheetSnapshot,
  WeeklyChangeRow,
} from '../types/dashboard'
import { normalizeHeaderLabel } from './slicerColumns'
import {
  addDays,
  majorityMonthForWeekRange,
  monthBucketFirstDay,
  startOfIsoWeek,
  weekRangeFromCell,
} from './weekAllocation'
import { aggregateKpisFromRows } from './executiveAnalytics'
import { tryCoerceDate } from './inferTypes'
import { parseOpsWeekColumnHeader } from './opsWeekHeaders'

function str(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  }
  return String(v).trim()
}

/** Same normalization used for merged Financial / executive rows — use when matching DBE tab names to staffing facts. */
export function normalizeExecutiveProjectCode(v: unknown): string {
  const raw = str(v)
  if (!raw) return ''
  // If Excel parsed the cell as a date/time, don't treat it as a project code.
  // (Common when the sheet has blank/garbage rows or mis-typed columns.)
  if (!raw.includes('|')) {
    const d = tryCoerceDate(v) ?? tryCoerceDate(raw)
    if (d && !Number.isNaN(d.getTime())) return ''
    if (/gmt[+-]\d{3,4}|\d{1,2}:\d{2}:\d{2}/i.test(raw)) return ''
  }
  return raw.toUpperCase().replace(/\s*\|\s*/g, '|').replace(/\s*-\s*/g, '-').trim()
}

function toNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'string') {
    const raw = v.trim()
    if (!raw) return null
    const t = raw
      .replace(/[,$€£\s]/g, '')
      .replace(/\(([^)]+)\)/, '-$1') // Excel-style accounting negatives: (123) -> -123
      .replace(/%/g, '')
    const n = Number.parseFloat(t)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function resolveOpsProjectCodeColumnKey(
  snap: SheetSnapshot,
  fm: Partial<Record<CanonicalField, string>>,
): string | null {
  const scoreKey = (k: string | null | undefined): number => {
    if (!k || !snap.columns.some((c) => c.key === k)) return 0
    let n = 0
    let hits = 0
    for (const r of snap.rows.slice(0, 100)) {
      const s = str(r[k])
      if (!s) continue
      n++
      if (s.includes('|') || /^missing$/i.test(s) || /\bCTR\b/i.test(s)) hits++
    }
    if (n < 4) return 0
    return (hits / n) * 100 + Math.min(n, 40)
  }

  const headerCandidates = [
    snap.columns.find((c) => normalizeHeaderLabel(c.header) === 'project code')?.key,
    snap.columns.find((c) => {
      const h = normalizeHeaderLabel(c.header)
      return h.includes('project') && h.includes('code')
    })?.key,
  ].filter(Boolean) as string[]

  let best: { k: string; sc: number } | null = null
  for (const k of [fm.project_code, ...headerCandidates]) {
    const sc = scoreKey(k)
    if (sc > 0 && (!best || sc > best.sc)) best = { k: k!, sc }
  }

  for (const col of snap.columns) {
    if (parseOpsWeekColumnHeader(col.header)) continue
    const sc = scoreKey(col.key)
    if (sc > 0 && (!best || sc > best.sc)) best = { k: col.key, sc }
  }

  return best?.k ?? fm.project_code ?? null
}

function resolveOpsClientColumnKey(
  snap: SheetSnapshot,
  fm: Partial<Record<CanonicalField, string>>,
): string | null {
  const scoreKey = (k: string | null | undefined): number => {
    if (!k || !snap.columns.some((c) => c.key === k)) return 0
    let n = 0
    for (const r of snap.rows.slice(0, 60)) {
      if (str(r[k])) n++
    }
    return n
  }

  const headerCandidates = [
    snap.columns.find((c) => normalizeHeaderLabel(c.header) === 'campaign')?.key,
    snap.columns.find((c) => normalizeHeaderLabel(c.header) === 'client name')?.key,
    snap.columns.find((c) => {
      const h = normalizeHeaderLabel(c.header)
      return h === 'client' || h.includes('customer')
    })?.key,
  ].filter(Boolean) as string[]

  let best: { k: string; sc: number } | null = null
  for (const k of [fm.client_name, ...headerCandidates]) {
    const sc = scoreKey(k)
    if (sc >= 4 && (!best || sc > best.sc)) best = { k: k!, sc }
  }
  return best?.k ?? fm.client_name ?? null
}

function monthBucketFromCell(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-01`
  }
  if (typeof v === 'number' && Number.isInteger(v) && v >= 199001 && v <= 210012) {
    const m = v % 100
    const y = Math.floor(v / 100)
    if (m >= 1 && m <= 12) return `${y}-${String(m).padStart(2, '0')}-01`
  }
  const s = String(v).trim()
  if (!s) return null
  const p = Date.parse(s)
  if (!Number.isNaN(p)) {
    const d = new Date(p)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
  }
  return null
}

function slugMeasureName(header: string): string {
  return normalizeHeaderLabel(header).replace(/\s+/g, '_')
}

function canonicalizeAhtVariant(v: string): 'Planned' | 'Actuals' | 'Cap' | null {
  const t = normalizeHeaderLabel(String(v ?? '')).toLowerCase()
  if (!t) return null
  if (/\bcap\b|capacity|limit|ceiling/.test(t)) return 'Cap'
  if (/\bactuals?\b|\bactual\b|\bact\b|result|achieved|real/.test(t)) return 'Actuals'
  if (/\bplanned\b|\bplan\b|target|budget|std|sla|goal|bench|objective|assumpt|assump/.test(t)) return 'Planned'
  return null
}

function pickAhtVariantFromTexts(texts: string[]): 'Planned' | 'Actuals' | 'Cap' | null {
  // Priority matters: avoid accidentally picking "Planned" when "Actuals" is also present.
  const norms = texts.map((t) => normalizeHeaderLabel(t).toLowerCase())
  if (norms.some((t) => /\bactuals?\b|\bactual\b|\bact\b/.test(t))) return 'Actuals'
  if (norms.some((t) => /\bcap\b|capacity|limit|ceiling/.test(t))) return 'Cap'
  if (norms.some((t) => /\bplanned\b|\bplan\b|target|budget/.test(t))) return 'Planned'
  return null
}

function canonicalizeHeadcountVariant(v: string): 'Requirement' | 'Projection' | null {
  const t = normalizeHeaderLabel(String(v ?? '')).toLowerCase()
  if (!t) return null
  if (/\breq\b|requirement|required|demand|needed/.test(t)) return 'Requirement'
  if (/\bproj\b|projection|forecast|plan/.test(t)) return 'Projection'
  return null
}

function pickHeadcountVariantFromTexts(texts: string[]): 'Requirement' | 'Projection' | null {
  const norms = texts.map((t) => normalizeHeaderLabel(t).toLowerCase())
  if (norms.some((t) => /\bproj\b|projection|forecast|plan/.test(t))) return 'Projection'
  if (norms.some((t) => /\breq\b|requirement|required|demand|needed/.test(t))) return 'Requirement'
  return null
}

const WEEKLY_DATASETS: DatasetKind[] = ['attrition', 'shrinkage', 'headcount', 'aht']

export type ExecCategory = 'Actuals' | 'Commit' | 'Budget' | 'Projections'

function inferFyFromMonthBucket(mb: string | null): string | null {
  if (!mb || mb.length < 4) return null
  const y = Number.parseInt(mb.slice(0, 4), 10)
  if (!Number.isFinite(y)) return null
  return `FY${String(y).slice(2)}`
}

function normalizeCategory(raw: string | null | undefined): ExecCategory | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  const l = s.toLowerCase()
  if (/\bactual\b|\bactuals\b|\bact\b/.test(l)) return 'Actuals'
  if (/\bcommit\b/.test(l)) return 'Commit'
  if (/\bbudget\b|\bbud\b/.test(l)) return 'Budget'
  // Treat "trending" / "forecast" / "plan" labels as Projections in category dropdowns.
  if (
    /\bproj\b|\bprojection\b|\bprojections\b|\bforecast\b|\bfcst\b|\btrend\b|\btrending\b|\bplan\b|\bplanned\b/.test(
      l,
    )
  )
    return 'Projections'
  return null
}

function categoryFromDatasetAndScenario(dataset: DatasetKind, rawScenario: string | null): ExecCategory | null {
  const n = normalizeCategory(rawScenario)
  if (n) return n
  // If a sheet has no scenario/category column mapped, keep dashboards usable by assigning a sensible default.
  // This avoids the “All categories show but selecting one yields 0 rows” failure mode.
  if (!rawScenario) {
    if (dataset === 'budget_vs_trending') return 'Budget'
    if (dataset === 'commit_vs_actuals') return null
    if (dataset === 'datasheet' || dataset === 'lw_cw_datasheet') return 'Actuals'
  }
  if (dataset === 'commit') return 'Commit'
  if (dataset === 'actuals') return 'Actuals'
  if (dataset === 'budget_vs_trending') return 'Budget'
  return null
}

export function buildExecutiveMergedModel(input: {
  snapshots: Record<string, SheetSnapshot>
  report: DatasetDetectionReport
}): ExecutiveMergedModel {
  const { snapshots, report } = input
  const factRows: ExecutiveUnifiedRow[] = []
  const notes: string[] = []

  for (const d of report.detected) {
    const snap = snapshots[d.sheetName]
    if (!snap) continue
    const fm = d.fieldMap
    const sheetLabel = normalizeHeaderLabel(d.sheetName)
    const effectiveDataset: DatasetKind =
      sheetLabel.includes('aht')
        ? 'aht'
        : sheetLabel.includes('headcount') || /\bhc\b/.test(sheetLabel)
          ? 'headcount'
          : sheetLabel.includes('shrinkage')
            ? 'shrinkage'
            : sheetLabel.includes('attrition')
              ? 'attrition'
              : d.dataset
    const fmEffective: Partial<Record<CanonicalField, string>> = { ...fm }
    if (WEEKLY_DATASETS.includes(effectiveDataset)) {
      const rpc = resolveOpsProjectCodeColumnKey(snap, fm)
      const rcl = resolveOpsClientColumnKey(snap, fm)
      if (rpc) fmEffective.project_code = rpc
      if (rcl) fmEffective.client_name = rcl
    }

    const pcKey = fmEffective.project_code ?? null
    if (!pcKey) {
      // For ops weekly tabs, allow blank Project Code rather than skipping the entire sheet.
      if (WEEKLY_DATASETS.includes(effectiveDataset)) {
        notes.push(
          `Note: ${effectiveDataset} “${d.sheetName}” has no Project Code mapping; capturing rows with blank Project Code.`,
        )
      } else {
        notes.push(`Skipped ${d.dataset}: no Project Code column on “${d.sheetName}”.`)
        continue
      }
    }

    const dimKeys = new Set(
      Object.values(fmEffective).filter((x): x is string => Boolean(x)),
    )

    const weekCols =
      WEEKLY_DATASETS.includes(effectiveDataset)
        ? snap.columns.filter((c) => {
            const dt = parseOpsWeekColumnHeader(c.header)
            return Boolean(dt && !Number.isNaN(dt.getTime()))
          })
        : []
    const forceWide = WEEKLY_DATASETS.includes(effectiveDataset)
    const looksWideOps = forceWide ? weekCols.length >= 1 : weekCols.length >= 4

    for (const row of snap.rows) {
      // If no Project Code, keep it blank (do not drop the row).
      const project_code = pcKey ? normalizeExecutiveProjectCode(row[pcKey]) : ''

      // Wide ops tabs: week columns are headers (e.g. 1/4/2026, 1/11/2026) and rows carry
      // a "Data Point" descriptor (e.g. HC Requirement / Total Shrinkage) plus Assumption/Actual.
      // Unpivot into one fact row per (project, week).
      if (looksWideOps && WEEKLY_DATASETS.includes(effectiveDataset)) {
        const inferAht = effectiveDataset === 'aht'
        const inferHc = effectiveDataset === 'headcount'

        const dataPointKey =
          snap.columns.find((c) => normalizeHeaderLabel(c.header) === 'data point')?.key ??
          // Some ops exports use Metric/Measure instead of "Data Point"
          snap.columns.find((c) => {
            const h = normalizeHeaderLabel(c.header)
            return h === 'metric' || h === 'measure' || h === 'kpi'
          })?.key ??
          null
        let variantKey =
          snap.columns.find((c) => normalizeHeaderLabel(c.header) === effectiveDataset)?.key ??
          snap.columns.find((c) => normalizeHeaderLabel(c.header).includes(effectiveDataset))?.key ??
          null
        // AHT sometimes uses "Handle Time" instead of "AHT"
        if (!variantKey && inferAht) {
          variantKey =
            snap.columns.find((c) => /handle\s*time|avg\s*handle/i.test(normalizeHeaderLabel(c.header)))?.key ??
            snap.columns.find((c) => normalizeHeaderLabel(c.header) === 'aht')?.key ??
            null
        }
        // Headcount sheets frequently label the variant column as "HC" or similar.
        if (!variantKey && inferHc) {
          variantKey =
            snap.columns.find((c) => /\bhc\b|headcount/.test(normalizeHeaderLabel(c.header)))?.key ??
            null
        }
        if (!variantKey && d.dataset === 'shrinkage') {
          variantKey =
            snap.columns.find((c) => /shrink/.test(normalizeHeaderLabel(c.header)))?.key ??
            null
        }
        if (!variantKey && d.dataset === 'attrition') {
          variantKey =
            snap.columns.find((c) => /attrition|attr\b/.test(normalizeHeaderLabel(c.header)))?.key ??
            null
        }

        const dataPointVal = dataPointKey ? str(row[dataPointKey]) : ''
        const variantVal = variantKey ? str(row[variantKey]) : ''
        const weekKeySet = new Set(weekCols.map((c) => c.key))
        const scanTextCells = (): string[] => {
          const out: string[] = []
          for (const c of snap.columns) {
            if (weekKeySet.has(c.key)) continue
            if (pcKey && c.key === pcKey) continue
            const v = row[c.key]
            if (v == null) continue
            if (typeof v === 'number' || v instanceof Date) continue
            const s = str(v)
            if (s) out.push(s)
          }
          return out
        }
        // Prefer the explicit variant label when available (e.g. "Planned/Actuals/Cap", "Requirement/Projection").
        const metricName = variantVal || dataPointVal || 'value'
        // For AHT wide tabs, enforce EXACT keys so charts can reliably bind:
        // `aht_planned`, `aht_actuals`, `aht_cap` (no slugging surprises).
        const canonAht =
          inferAht
            ? canonicalizeAhtVariant(variantVal) ??
              canonicalizeAhtVariant(dataPointVal) ??
              canonicalizeAhtVariant(`${dataPointVal} ${variantVal}`) ??
              pickAhtVariantFromTexts(scanTextCells()) ??
              null
            : null
        const canonHc =
          inferHc
            ? canonicalizeHeadcountVariant(dataPointVal) ??
              canonicalizeHeadcountVariant(variantVal) ??
              canonicalizeHeadcountVariant(`${dataPointVal} ${variantVal}`) ??
              pickHeadcountVariantFromTexts(scanTextCells()) ??
              null
            : null
        const metricKey = canonAht
          ? `aht_${canonAht.toLowerCase()}`
          : canonHc
            ? `headcount_${canonHc.toLowerCase()}`
            : `${effectiveDataset}_${slugMeasureName(metricName)}`
        let captured = 0

        for (const wc of weekCols) {
          const dt = parseOpsWeekColumnHeader(wc.header)
          if (!dt || Number.isNaN(dt.getTime())) continue
          const ws = startOfIsoWeek(dt)
          const we = addDays(ws, 6)
          const week_start = ws.toISOString().slice(0, 10)
          const { year, month } = majorityMonthForWeekRange(ws, we)
          const month_bucket = monthBucketFirstDay(year, month)

          const n = toNum(row[wc.key])
          if (n === null) continue
          captured++

          factRows.push({
            dataset: effectiveDataset,
            sheetName: d.sheetName,
            project_code,
            fy: fmEffective.fy != null ? (row[fmEffective.fy] as string | number) : inferFyFromMonthBucket(month_bucket),
            month_bucket,
            week_start,
            scenario: categoryFromDatasetAndScenario(
              effectiveDataset,
              fmEffective.scenario != null ? str(row[fmEffective.scenario]) || null : null,
            ),
            client_name:
              fmEffective.client_name != null ? str(row[fmEffective.client_name]) || null : null,
            location: fmEffective.location != null ? str(row[fmEffective.location]) || null : null,
            metrics: { [metricKey]: n },
          })
        }
        if (captured === 0) {
          notes.push(
            `Unpivoted ${d.dataset} wide sheet “${d.sheetName}” but captured 0 numeric week cells for key “${metricName}”. Check numeric formatting in week columns.`,
          )
        }
        continue
      }

      const metrics: Record<string, number> = {}
      for (const col of snap.columns) {
        if (dimKeys.has(col.key)) continue
        if (col.type !== 'number') continue
        const n = toNum(row[col.key])
        if (n === null) continue
        const mk = `${d.dataset}_${slugMeasureName(col.header)}`
        metrics[mk] = (metrics[mk] ?? 0) + n
      }

      let month_bucket =
        fm.month != null ? monthBucketFromCell(row[fm.month]) : null

      let week_start: string | null = null
      if (fm.week != null) {
        const wr = weekRangeFromCell(row[fm.week])
        if (wr) {
          week_start = wr.start.toISOString().slice(0, 10)
          if (!month_bucket && WEEKLY_DATASETS.includes(d.dataset)) {
            const { year, month } = majorityMonthForWeekRange(wr.start, wr.end)
            month_bucket = monthBucketFirstDay(year, month)
          }
        }
      }

      factRows.push({
        dataset: d.dataset,
        sheetName: d.sheetName,
        project_code,
        fy: fmEffective.fy != null ? (row[fmEffective.fy] as string | number) : inferFyFromMonthBucket(month_bucket),
        month_bucket,
        week_start,
        scenario: categoryFromDatasetAndScenario(
          d.dataset,
          fmEffective.scenario != null ? str(row[fmEffective.scenario]) || null : null,
        ),
        client_name:
          fmEffective.client_name != null ? str(row[fmEffective.client_name]) || null : null,
        location: fmEffective.location != null ? str(row[fmEffective.location]) || null : null,
        metrics,
      })
    }
  }

  // No client-name backfill: client values must come from uploaded data only.

  const monthlyFromWeekly: ExecutiveUnifiedRow[] = []
  for (const r of factRows) {
    if (!WEEKLY_DATASETS.includes(r.dataset)) continue
    if (!r.month_bucket) continue
    monthlyFromWeekly.push({
      ...r,
      month_bucket: r.month_bucket,
    })
  }

  const weeklyChanges = buildWeeklyChangesFromLwCw(snapshots, report, 'Actuals')

  if (factRows.length === 0) {
    notes.push('No fact rows merged — check dataset detection and required fields.')
  }

  return { factRows, monthlyFromWeekly, weeklyChanges, notes }
}

function findLwCwSheet(report: DatasetDetectionReport): string | null {
  const m = report.detected.find((d) => d.dataset === 'lw_cw_datasheet')
  return m?.sheetName ?? null
}

export function buildWeeklyChangesFromLwCw(
  snapshots: Record<string, SheetSnapshot>,
  report: DatasetDetectionReport,
  category: ExecCategory = 'Actuals',
): WeeklyChangeRow[] {
  const name = findLwCwSheet(report)
  if (!name) return []
  const snap = snapshots[name]
  if (!snap || snap.rows.length === 0) return []

  let lwKey: string | null = null
  let cwKey: string | null = null
  let metricKey: string | null = snap.columns[0]?.key ?? null

  const catToken = category.toLowerCase()

  for (const c of snap.columns) {
    const h = normalizeHeaderLabel(c.header)
    const hn = h.replace(/\s/g, '')
    const hl = c.header.toLowerCase()

    // Preferred: LW/CW columns that also contain the chosen category label (Actual/Commit/Budget/Projections).
    if (!lwKey && (hn.includes('lw') || hl.includes('last') || hl.includes('prior')) && hl.includes(catToken)) {
      lwKey = c.key
    }
    if (!cwKey && (hn.includes('cw') || hl.includes('current') || hl.includes('this')) && hl.includes(catToken)) {
      cwKey = c.key
    }

    if (/^(lw|lastweek|last_week|py|prior)$/.test(h.replace(/\s/g, '')) || /^last\s*week$/.test(h)) {
      lwKey = c.key
    }
    if (/^(cw|currentweek|current_week|actual|actuals)$/.test(h.replace(/\s/g, '')) || /^current\s*week$/.test(h)) {
      cwKey = c.key
    }
    if (/^metric|^measure|^name|^kpi$/i.test(c.header.trim())) {
      metricKey = c.key
    }
  }

  // Fallback: columns containing lw / cw
  if (!lwKey || !cwKey) {
    for (const c of snap.columns) {
      const h = c.header.toLowerCase()
      if (h.includes('last') && h.includes('week')) lwKey = c.key
      if (h.includes('current') && h.includes('week')) cwKey = c.key
    }
  }

  if (!lwKey || !cwKey || !metricKey) {
    return []
  }

  const out: WeeklyChangeRow[] = []
  for (const r of snap.rows) {
    const metric = str(r[metricKey])
    if (!metric) continue
    const lw = toNum(r[lwKey])
    const cw = toNum(r[cwKey])
    if (lw === null && cw === null) continue
    const variance = lw !== null && cw !== null ? cw - lw : null
    const variancePct =
      lw !== null && lw !== 0 && cw !== null ? ((cw - lw) / Math.abs(lw)) * 100 : null
    let direction: WeeklyChangeRow['direction'] = 'flat'
    if (variance !== null) {
      if (variance > 0) direction = 'up'
      else if (variance < 0) direction = 'down'
    }
    out.push({
      metric,
      lastWeek: lw,
      currentWeek: cw,
      variance,
      variancePct,
      direction,
    })
  }
  return out
}

/** Apply FY / Month / Location / Client / Scenario filters client-side */
export function filterExecutiveRows<T extends { fy: string | number | null; month_bucket: string | null; scenario: string | null; client_name: string | null; location: string | null }>(
  rows: T[],
  filters: {
    fy: string
    month: string
    location: string
    client: string
    scenario: string
  },
): T[] {
  return rows.filter((r) => {
    if (filters.fy && String(r.fy ?? '') !== filters.fy) return false
    if (filters.month && r.month_bucket) {
      const prefix = filters.month.slice(0, 7)
      if (!r.month_bucket.startsWith(prefix)) return false
    }
    if (filters.scenario && (r.scenario ?? '') !== filters.scenario) return false
    if (filters.client && (r.client_name ?? '') !== filters.client) return false
    if (filters.location && (r.location ?? '') !== filters.location) return false
    return true
  })
}

/** Sums dollar metrics; averages detected GM% / margin-rate column (see `aggregateKpisFromRows`). */
export function aggregateKpis(rows: ExecutiveUnifiedRow[]): Record<string, number> {
  return aggregateKpisFromRows(rows)
}
