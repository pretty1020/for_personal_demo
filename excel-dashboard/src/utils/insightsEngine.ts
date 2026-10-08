import type { SheetSnapshot } from '../types/dashboard'
import type { SheetColumnProfile } from './columnSemantics'
import { formatAxisLabel } from './inferTypes'

export interface AutoInsight {
  text: string
  tone: 'info' | 'positive' | 'warning'
}

const SCAN = 12_000

function toTime(d: unknown): number {
  if (d instanceof Date && !Number.isNaN(d.getTime())) return d.getTime()
  return 0
}

function mean(a: number[]) {
  if (a.length === 0) return 0
  return a.reduce((x, y) => x + y, 0) / a.length
}

function stddev(a: number[]) {
  if (a.length < 2) return 0
  const m = mean(a)
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1))
}

/** Human-readable bullets from cleaned data + profile. */
export function generateAutoInsights(
  snapshot: SheetSnapshot,
  profile: SheetColumnProfile,
): AutoInsight[] {
  const out: AutoInsight[] = []
  const n = Math.min(snapshot.rows.length, SCAN)
  if (n === 0) return out

  const nums = profile.measureColumns
  const primaryY = nums[0]?.key
  const dateKey = profile.primaryDateKey
  const catKey = profile.categoryKeys[0]

  /* Latest vs previous period */
  if (dateKey && primaryY) {
    type Row = { t: number; v: number }
    const series: Row[] = []
    for (let i = 0; i < n; i++) {
      const r = snapshot.rows[i]!
      const t = toTime(r[dateKey])
      const v = r[primaryY]
      if (t && typeof v === 'number' && Number.isFinite(v)) series.push({ t, v })
    }
    series.sort((a, b) => a.t - b.t)
    if (series.length >= 8) {
      const mid = Math.floor(series.length / 2)
      const first = series.slice(0, mid)
      const second = series.slice(mid)
      const s1 = first.reduce((a, x) => a + x.v, 0)
      const s2 = second.reduce((a, x) => a + x.v, 0)
      const m1 = s1 / first.length
      const m2 = s2 / second.length
      const pct = m1 !== 0 ? ((m2 - m1) / Math.abs(m1)) * 100 : 0
      const label = snapshot.columns.find((c) => c.key === primaryY)?.header ?? 'Metric'
      if (Math.abs(pct) >= 1) {
        out.push({
          text: `${label} averaged ${pct >= 0 ? 'higher' : 'lower'} in the later period vs the earlier one (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% change vs prior mean).`,
          tone: pct >= 0 ? 'positive' : 'warning',
        })
      }
    }
  }

  /* Top category share */
  if (catKey && primaryY) {
    const agg = new Map<string, number>()
    for (let i = 0; i < n; i++) {
      const r = snapshot.rows[i]!
      const k = formatAxisLabel(r[catKey]) || '(blank)'
      const v = r[primaryY]
      if (typeof v !== 'number' || !Number.isFinite(v)) continue
      agg.set(k, (agg.get(k) ?? 0) + v)
    }
    const entries = [...agg.entries()].sort((a, b) => b[1] - a[1])
    if (entries.length >= 2) {
      const total = entries.reduce((s, [, v]) => s + v, 0)
      if (total !== 0) {
        const top = entries[0]!
        const share = (top[1] / total) * 100
        const catName = snapshot.columns.find((c) => c.key === catKey)?.header ?? 'Category'
        out.push({
          text: `Top ${catName}: "${top[0]}" contributes about ${share.toFixed(0)}% of the total for ${snapshot.columns.find((c) => c.key === primaryY)?.header ?? 'the main measure'} (scanned rows).`,
          tone: 'info',
        })
      }
      const bot = entries[entries.length - 1]!
      if (entries.length >= 3 && bot[1] < entries[0]![1] * 0.15) {
        out.push({
          text: `Lowest segment "${bot[0]}" is well below the leading category — worth reviewing drivers in that bucket.`,
          tone: 'warning',
        })
      }
    }
  }

  /* Variance */
  let bestVar = { key: '', cv: 0 }
  for (const m of nums.slice(0, 6)) {
    const vals: number[] = []
    for (let i = 0; i < n; i++) {
      const v = snapshot.rows[i]![m.key]
      if (typeof v === 'number' && Number.isFinite(v)) vals.push(v)
    }
    if (vals.length < 5) continue
    const sd = stddev(vals)
    const mu = mean(vals)
    const cv = mu !== 0 ? Math.abs(sd / mu) : sd
    if (cv > bestVar.cv) bestVar = { key: m.key, cv }
  }
  if (bestVar.key && bestVar.cv > 0.2) {
    const h = snapshot.columns.find((c) => c.key === bestVar.key)?.header ?? bestVar.key
    out.push({
      text: `“${h}” shows the highest relative spread (coefficient of variation among scanned numeric fields) — check outliers or segment mix.`,
      tone: 'info',
    })
  }

  /* Simple z-score outliers on primary measure */
  if (primaryY) {
    const vals: number[] = []
    for (let i = 0; i < n; i++) {
      const v = snapshot.rows[i]![primaryY]
      if (typeof v === 'number' && Number.isFinite(v)) vals.push(v)
    }
    if (vals.length >= 10) {
      const m = mean(vals)
      const sd = stddev(vals)
      let hi = 0
      if (sd > 1e-9) {
        for (const v of vals) {
          if (Math.abs((v - m) / sd) > 2.5) hi++
        }
      }
      if (hi > 0) {
        out.push({
          text: `About ${hi} value(s) in ${snapshot.columns.find((c) => c.key === primaryY)?.header ?? 'the main metric'} look like outliers (|z| > 2.5) in the scanned rows.`,
          tone: 'warning',
        })
      }
    }
  }

  if (out.length === 0) {
    out.push({
      text: 'Upload includes usable numeric fields — tune the chart builder for deeper slices.',
      tone: 'info',
    })
  }

  return out.slice(0, 8)
}
