import type { SheetSnapshot } from '../types/dashboard'
import { formatAxisLabel } from './inferTypes'

export type MeasureKind =
  | 'revenue'
  | 'volume'
  | 'cost'
  | 'aht'
  | 'sla'
  | 'rate'
  | 'count_metric'
  | 'generic'

/** Heuristic labels from header text (English). */
export function classifyMeasureHeader(header: string): MeasureKind {
  const h = header.toLowerCase()
  if (/revenue|sales|income|gmv|mrr|arr|topline/i.test(h) && !/cost/i.test(h)) return 'revenue'
  if (
    /cost|cogs|opex|expense|spend|fee(?!\s*rate)|salary|salaries|payroll|wage|compensation|benefit/i.test(
      h,
    ) &&
    !/revenue/i.test(h)
  ) {
    return 'cost'
  }
  if (/aht|handle\s*time|duration|ttfb|latency|response\s*time/i.test(h)) return 'aht'
  if (/sla|availability|uptime|success\s*rate|achievement|otif|fill\s*rate/i.test(h)) return 'sla'
  if (/%|margin|yield|conversion|utilization|cpu|ratio(?!\s*of)/i.test(h)) return 'rate'
  if (/volume|qty|quantity|units|calls|tickets|sessions|transactions|loads|headcount|users/i.test(h))
    return 'volume'
  if (/number of|nbr|\#\s*of|count(?!\s*ry)/i.test(h)) return 'count_metric'
  return 'generic'
}

export function displayLabelForMeasure(kind: MeasureKind, header: string): string {
  if (kind === 'revenue') return header.match(/revenue|sales|income|amount/i) ? header : `Revenue · ${header}`
  if (kind === 'volume') return header
  if (kind === 'cost') return header
  if (kind === 'aht') return header
  if (kind === 'sla') return header
  return header
}

export interface SheetColumnProfile {
  primaryDateKey: string | null
  /** Text columns suitable for grouping (limited cardinality heuristic). */
  categoryKeys: string[]
  /** Numeric columns with semantic tags, ordered by importance. */
  measureColumns: Array<{ key: string; header: string; kind: MeasureKind }>
}

const MAX_CATEGORY_CARDINALITY = 120

export function buildColumnProfile(snapshot: SheetSnapshot): SheetColumnProfile {
  const nums = snapshot.columns.filter((c) => c.type === 'number')
  const dates = snapshot.columns.filter((c) => c.type === 'date')
  const texts = snapshot.columns.filter((c) => c.type === 'text')

  const primaryDateKey = dates[0]?.key ?? null

  const categoryKeys: string[] = []
  const scan = Math.min(snapshot.rows.length, 8_000)
  for (const c of texts) {
    const uniq = new Set<string>()
    for (let i = 0; i < scan; i++) {
      const v = snapshot.rows[i]![c.key]
      const s = formatAxisLabel(v).trim()
      if (s && s.length < 200) uniq.add(s)
      if (uniq.size > MAX_CATEGORY_CARDINALITY) break
    }
    if (uniq.size > 0 && uniq.size <= MAX_CATEGORY_CARDINALITY && uniq.size <= Math.max(12, scan * 0.4)) {
      categoryKeys.push(c.key)
    }
    if (categoryKeys.length >= 4) break
  }

  const measureColumns = nums.map((c) => ({
    key: c.key,
    header: c.header,
    kind: classifyMeasureHeader(c.header),
  }))

  measureColumns.sort((a, b) => {
    const order = (k: MeasureKind) => {
      if (k === 'revenue') return 0
      if (k === 'volume') return 1
      if (k === 'cost') return 2
      if (k === 'aht' || k === 'sla') return 3
      return 4
    }
    return order(a.kind) - order(b.kind)
  })

  return {
    primaryDateKey,
    categoryKeys,
    measureColumns,
  }
}
