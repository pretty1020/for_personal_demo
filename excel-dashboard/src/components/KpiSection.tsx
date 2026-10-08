import { useEffect, useMemo, useState } from 'react'
import type { SheetSnapshot } from '../types/dashboard'
import {
  buildColumnProfile,
  displayLabelForMeasure,
  type MeasureKind,
} from '../utils/columnSemantics'

function fmt(n: number) {
  if (!Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(2)}k`
  if (Math.abs(n) < 100 && !Number.isInteger(n)) return n.toFixed(2)
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function fmtCurrency(n: number) {
  if (!Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(2)}k`
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

const KPI_SCAN_CAP = 12_000

function toTime(d: unknown): number {
  if (d instanceof Date && !Number.isNaN(d.getTime())) return d.getTime()
  return 0
}

function toISODateLocal(ms: number): string {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function median(nums: number[]): number {
  if (nums.length === 0) return NaN
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

function stdSample(nums: number[], mean: number): number {
  if (nums.length < 2) return 0
  const v = nums.reduce((a, x) => a + (x - mean) ** 2, 0) / (nums.length - 1)
  return Math.sqrt(v)
}

function periodGrowthPct(
  rows: Record<string, unknown>[],
  dateKey: string,
  measureKey: string,
): number | null {
  type P = { t: number; v: number }
  const pts: P[] = []
  for (const r of rows) {
    const t = toTime(r[dateKey])
    const v = r[measureKey]
    if (!t || typeof v !== 'number' || !Number.isFinite(v)) continue
    pts.push({ t, v })
  }
  if (pts.length < 6) return null
  pts.sort((a, b) => a.t - b.t)
  const mid = Math.floor(pts.length / 2)
  const a = pts.slice(0, mid)
  const b = pts.slice(mid)
  const m1 = a.reduce((s, x) => s + x.v, 0) / a.length
  const m2 = b.reduce((s, x) => s + x.v, 0) / b.length
  if (m1 === 0 && m2 === 0) return null
  if (m1 === 0) return null
  return ((m2 - m1) / Math.abs(m1)) * 100
}

function kpiTitle(kind: MeasureKind, header: string): string {
  const d = displayLabelForMeasure(kind, header)
  if (kind === 'revenue') return `Total · ${d}`
  if (kind === 'volume') return `Volume · ${d}`
  if (kind === 'cost') return `Cost · ${d}`
  if (kind === 'aht') return `AHT · ${d}`
  if (kind === 'sla') return `SLA · ${d}`
  if (kind === 'rate') return `Rate · ${d}`
  return d
}

/** Second line under the column header — category only, column name is shown separately. */
function kpiRoleCaption(kind: MeasureKind): string {
  if (kind === 'revenue') return 'Revenue-style measure'
  if (kind === 'volume') return 'Volume / count-style measure'
  if (kind === 'cost') return 'Cost / spend measure'
  if (kind === 'aht') return 'Duration / handle time'
  if (kind === 'sla') return 'SLA / availability'
  if (kind === 'rate') return 'Rate / ratio'
  if (kind === 'count_metric') return 'Count'
  return 'Numeric measure'
}

function isCurrencyLike(kind: MeasureKind, header: string): boolean {
  if (kind === 'revenue' || kind === 'cost') return true
  const h = header.toLowerCase()
  return (
    /salary|salaries|payroll|wage|compensation|benefit|amount|price|payment|balance|invoice|usd|\$|€|£|fee(?!\s*rate)/i.test(
      h,
    ) && !/count|rate\s*%|#/i.test(h)
  )
}

export function KpiSection(props: { snapshot: SheetSnapshot }) {
  const { snapshot } = props

  const profile = useMemo(() => buildColumnProfile(snapshot), [snapshot])
  const dateKey = profile.primaryDateKey
  const dateCol = dateKey ? snapshot.columns.find((c) => c.key === dateKey) : undefined

  const dateBounds = useMemo(() => {
    if (!dateKey) return null
    let minT = Infinity
    let maxT = -Infinity
    const n = Math.min(snapshot.rows.length, KPI_SCAN_CAP)
    for (let i = 0; i < n; i++) {
      const t = toTime(snapshot.rows[i]![dateKey])
      if (t > 0) {
        minT = Math.min(minT, t)
        maxT = Math.max(maxT, t)
      }
    }
    if (!Number.isFinite(minT) || !Number.isFinite(maxT)) return null
    return { minT, maxT }
  }, [snapshot.rows, dateKey])

  const [rangeFrom, setRangeFrom] = useState('')
  const [rangeTo, setRangeTo] = useState('')

  useEffect(() => {
    setRangeFrom('')
    setRangeTo('')
  }, [snapshot.name, dateKey])

  const filteredRows = useMemo(() => {
    if (!dateKey) return snapshot.rows
    if (!rangeFrom && !rangeTo) return snapshot.rows
    return snapshot.rows.filter((r) => {
      const t = toTime(r[dateKey])
      if (!t) return false
      if (rangeFrom) {
        const fromT = new Date(`${rangeFrom}T00:00:00`).getTime()
        if (t < fromT) return false
      }
      if (rangeTo) {
        const toT = new Date(`${rangeTo}T23:59:59.999`).getTime()
        if (t > toT) return false
      }
      return true
    })
  }, [snapshot.rows, dateKey, rangeFrom, rangeTo])

  const cards = useMemo(() => {
    const measures = profile.measureColumns.slice(0, 6)
    const scan = Math.min(filteredRows.length, KPI_SCAN_CAP)
    const dk = dateKey

    return measures.map((m) => {
      const vals: number[] = []
      for (let i = 0; i < scan; i++) {
        const v = filteredRows[i]![m.key]
        if (typeof v === 'number' && Number.isFinite(v)) vals.push(v)
      }
      const title = kpiTitle(m.kind, m.header)
      const roleCaption = kpiRoleCaption(m.kind)
      const money = isCurrencyLike(m.kind, m.header)
      const formatMetric = money ? fmtCurrency : fmt

      if (vals.length === 0) {
        return {
          key: m.key,
          header: m.header,
          roleCaption,
          title,
          kind: 'muted' as const,
          lines: [{ label: 'Status', value: 'No numeric values in range' }],
          foot: '',
        }
      }

      const sum = vals.reduce((a, b) => a + b, 0)
      const avg = sum / vals.length
      const min = Math.min(...vals)
      const max = Math.max(...vals)
      const med = median(vals)
      const sd = stdSample(vals, avg)
      const rowsForGrowth =
        filteredRows.length > KPI_SCAN_CAP ? filteredRows.slice(0, KPI_SCAN_CAP) : filteredRows
      const growth = dk != null ? periodGrowthPct(rowsForGrowth, dk, m.key) : null

      const lines: { label: string; value: string }[] = [
        { label: 'Total', value: formatMetric(sum) },
        { label: 'Average', value: formatMetric(avg) },
        { label: 'Median', value: formatMetric(med) },
        { label: 'Std dev', value: money ? fmtCurrency(sd) : fmt(sd) },
        { label: 'Min', value: formatMetric(min) },
        { label: 'Max', value: formatMetric(max) },
        { label: 'Count (n)', value: vals.length.toLocaleString() },
      ]
      if (growth != null && Number.isFinite(growth)) {
        lines.push({
          label: 'Growth (1st vs 2nd half by time)',
          value: `${growth >= 0 ? '+' : ''}${growth.toFixed(1)}%`,
        })
      }

      return {
        key: m.key,
        header: m.header,
        roleCaption,
        title,
        kind: 'accent' as const,
        lines,
        foot: '',
      }
    })
  }, [filteredRows, profile.measureColumns, dateKey, rangeFrom, rangeTo])

  if (cards.length === 0) {
    return (
      <section className="card empty-card" aria-label="Key metrics">
        <h2 className="card-title">KPI highlights</h2>
        <p className="empty-text">
          KPI cards appear when the sheet has numeric columns after empty rows/columns are removed.
        </p>
      </section>
    )
  }

  return (
    <section className="kpi-band" aria-label="Key metrics">
      <div className="card-header compact-header">
        <div>
          <h2 className="card-title">KPI highlights</h2>
          <p className="card-desc">
            Auto-detected measures with totals, spread, and optional period growth when a date column
            exists. Currency-style columns show $.
          </p>
        </div>
      </div>
      {dateKey && dateBounds ? (
        <div className="kpi-date-range card-inner-bar">
          <div className="kpi-date-range__labels">
            <span className="field-label-muted">Date filter for KPIs</span>
            <span className="kpi-date-range__col">
              Using “{dateCol?.header ?? dateKey}”
            </span>
          </div>
          <div className="kpi-date-range__inputs">
            <label className="field field--inline field--compact">
              <span className="field-label-muted">From</span>
              <input
                className="input input--sm"
                type="date"
                value={rangeFrom}
                min={toISODateLocal(dateBounds.minT)}
                max={toISODateLocal(dateBounds.maxT)}
                onChange={(e) => setRangeFrom(e.target.value)}
              />
            </label>
            <label className="field field--inline field--compact">
              <span className="field-label-muted">To</span>
              <input
                className="input input--sm"
                type="date"
                value={rangeTo}
                min={toISODateLocal(dateBounds.minT)}
                max={toISODateLocal(dateBounds.maxT)}
                onChange={(e) => setRangeTo(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn-secondary btn-mini"
              onClick={() => {
                setRangeFrom('')
                setRangeTo('')
              }}
            >
              All dates
            </button>
            <button
              type="button"
              className="btn-secondary btn-mini"
              onClick={() => {
                setRangeFrom(toISODateLocal(dateBounds.minT))
                setRangeTo(toISODateLocal(dateBounds.maxT))
              }}
            >
              Full span in sheet
            </button>
          </div>
        </div>
      ) : null}
      <div className="kpi-grid kpi-grid--rich">
        {cards.map((c) => (
          <article
            key={c.key}
            className={`kpi-card kpi-card--rich ${c.kind === 'muted' ? 'kpi-card--muted' : ''}`}
          >
            <header className="kpi-card__head">
              <h3 className="kpi-card__column">{c.header}</h3>
              <p className="kpi-card__role">{c.roleCaption}</p>
              <span className="sr-only">{c.title}</span>
            </header>
            <div className="kpi-stat-grid">
              {c.lines.map((l) => (
                <div key={l.label} className="kpi-stat-row">
                  <span className="kpi-stat-label">{l.label}</span>
                  <span className="kpi-stat-value">{l.value}</span>
                </div>
              ))}
            </div>
            {c.foot ? <p className="kpi-foot">{c.foot}</p> : null}
          </article>
        ))}
      </div>
    </section>
  )
}
