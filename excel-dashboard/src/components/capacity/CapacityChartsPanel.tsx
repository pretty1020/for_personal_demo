import { useCallback, useMemo, useState } from 'react'
import type { DerivedCapacityRow } from '../../planner/capacityPlanDerived'
import {
  InteractiveD3Chart,
  type InteractiveD3Series,
} from '../charts/InteractiveD3Chart'

const COLORS = {
  required: '#1c1915',
  production: '#2c5648',
  forecast: '#4d6b5e',
  offered: '#8c7348',
  handled: '#6d7f4e',
  planned: '#3d4f46',
  actual: '#9a6b2f',
  gapPos: 'rgba(154, 107, 47, 0.45)',
  gapNeg: 'rgba(44, 86, 72, 0.4)',
} as const

type ChartTab = 'staffing' | 'volume' | 'attrition' | 'aht' | 'absenteeism'

type Props = {
  rows: DerivedCapacityRow[]
  open: boolean
  onClose: () => void
}

function weekLabel(iso: string): string {
  const date = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function plannedAttritionHc(row: DerivedCapacityRow): number {
  if (row.planned.attritionHc != null) return row.planned.attritionHc
  return Math.round((row.planned.attritionPct ?? 0) * Math.max(row.planned.productionHc, 1))
}

function actualAttritionHc(row: DerivedCapacityRow): number | null {
  if (row.statusLabel !== 'Actual') return null
  return row.actual.attritionHc
}

function fmtChartNum(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return value.toFixed(1)
}

function fmtCompact(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000) return `${(value / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

function absenteeismPct(row: DerivedCapacityRow, which: 'planned' | 'actual'): number | null {
  const category = row.shrinkageCategories?.find((item) => item.id === 'absenteeism')
  if (!category) return null
  if (which === 'planned') return (category.plannedPct ?? 0) * 100
  if (row.statusLabel !== 'Actual' || category.actualPct == null) return null
  return category.actualPct * 100
}

function focusSummary(tab: ChartTab, row: DerivedCapacityRow): string {
  const week = row.week
  if (tab === 'staffing') {
    const required =
      row.statusLabel === 'Actual'
        ? (row.actual.requiredFte ?? row.planned.requiredFte)
        : row.planned.requiredFte
    const production =
      row.statusLabel === 'Actual' ? row.actual.productionFte : row.planned.productionFte
    const gap = (required ?? 0) - (production ?? 0)
    return `${week} · Required ${fmtChartNum(required)} FTE · Production ${fmtChartNum(production)} FTE · Gap ${fmtChartNum(gap)}`
  }
  if (tab === 'volume') {
    const offered =
      row.statusLabel === 'Actual'
        ? row.actual.offeredVolume
        : row.planned.offeredVolume || row.planned.volume
    const handled =
      row.statusLabel === 'Actual' ? row.actual.handledVolume : row.planned.handledVolume
    return `${week} · Forecast ${Math.round(row.planned.volume).toLocaleString()} · Offered ${Math.round(offered).toLocaleString()}${handled != null ? ` · Handled ${Math.round(handled).toLocaleString()}` : ''}`
  }
  if (tab === 'attrition') {
    const actual = actualAttritionHc(row)
    return `${week} · Planned attrition ${plannedAttritionHc(row)}${actual != null ? ` · Actual ${actual}` : ''}`
  }
  if (tab === 'aht') {
    const actual = row.statusLabel === 'Actual' ? row.actual.ahtSeconds : null
    return `${week} · Planned AHT ${row.planned.ahtSeconds ?? '—'}s${actual != null ? ` · Actual ${actual}s` : ''}`
  }
  const planned = absenteeismPct(row, 'planned')
  const actual = absenteeismPct(row, 'actual')
  return `${week} · Planned absenteeism ${planned != null ? `${planned.toFixed(1)}%` : '—'}${actual != null ? ` · Actual ${actual.toFixed(1)}%` : ''}`
}

export function CapacityChartsPanel({ rows, open, onClose }: Props) {
  const [tab, setTab] = useState<ChartTab>('staffing')
  const [focusedWeek, setFocusedWeek] = useState<string | null>(null)

  const chartRows = useMemo(() => {
    if (rows.length <= 52) return rows
    const historical = rows.filter((row) => row.timeline === 'historical_actual')
    const forward = rows.filter((row) => row.timeline === 'forward_plan')
    return [...historical.slice(-16), ...forward.slice(0, 36)]
  }, [rows])

  const weeks = useMemo(() => chartRows.map((row) => row.week), [chartRows])
  const labels = useMemo(() => weeks.map(weekLabel), [weeks])

  const staffingSeries = useMemo<InteractiveD3Series[]>(() => {
    const required = chartRows.map((row) =>
      row.statusLabel === 'Actual'
        ? (row.actual.requiredFte ?? row.planned.requiredFte ?? 0)
        : (row.planned.requiredFte ?? 0),
    )
    const production = chartRows.map((row) =>
      row.statusLabel === 'Actual' ? row.actual.productionFte : row.planned.productionFte,
    )
    const gap = required.map((req, i) => req - (production[i] ?? 0))
    return [
      {
        id: 'required',
        label: 'Required FTE',
        color: COLORS.required,
        type: 'area',
        values: required,
      },
      {
        id: 'production',
        label: 'Production FTE',
        color: COLORS.production,
        type: 'line',
        values: production,
      },
      {
        id: 'gap',
        label: 'Gap (Req − Prod)',
        color: COLORS.gapPos,
        type: 'bar',
        values: gap,
        barColor: (value) => (value > 0 ? COLORS.gapPos : COLORS.gapNeg),
      },
    ]
  }, [chartRows])

  const volumeSeries = useMemo<InteractiveD3Series[]>(() => {
    const forecast = chartRows.map((row) => row.planned.volume)
    const offered = chartRows.map((row) =>
      row.statusLabel === 'Actual'
        ? row.actual.offeredVolume
        : row.planned.offeredVolume || row.planned.volume,
    )
    const handled = chartRows.map((row) => {
      const snap = row.statusLabel === 'Actual' ? row.actual : row.planned
      return snap.handledVolume ?? null
    })
    return [
      {
        id: 'forecast',
        label: 'Forecast volume',
        color: COLORS.forecast,
        type: 'area',
        values: forecast,
      },
      {
        id: 'offered',
        label: 'Offered',
        color: COLORS.offered,
        type: 'bar',
        values: offered,
      },
      {
        id: 'handled',
        label: 'Handled',
        color: COLORS.handled,
        type: 'dash',
        values: handled,
      },
    ]
  }, [chartRows])

  const attritionSeries = useMemo<InteractiveD3Series[]>(
    () => [
      {
        id: 'planned',
        label: 'Planned attrition',
        color: COLORS.planned,
        type: 'line',
        values: chartRows.map((row) => plannedAttritionHc(row)),
      },
      {
        id: 'actual',
        label: 'Actual attrition',
        color: COLORS.actual,
        type: 'bar',
        values: chartRows.map((row) => actualAttritionHc(row)),
      },
    ],
    [chartRows],
  )

  const ahtSeries = useMemo<InteractiveD3Series[]>(
    () => [
      {
        id: 'planned',
        label: 'Planned AHT',
        color: COLORS.planned,
        type: 'area',
        values: chartRows.map((row) => row.planned.ahtSeconds),
      },
      {
        id: 'actual',
        label: 'Actual AHT',
        color: COLORS.actual,
        type: 'dash',
        values: chartRows.map((row) =>
          row.statusLabel === 'Actual' ? row.actual.ahtSeconds : null,
        ),
      },
    ],
    [chartRows],
  )

  const absenteeismSeries = useMemo<InteractiveD3Series[]>(
    () => [
      {
        id: 'planned',
        label: 'Planned absenteeism',
        color: COLORS.planned,
        type: 'area',
        values: chartRows.map((row) => {
          const category = row.shrinkageCategories?.find((item) => item.id === 'absenteeism')
          return (category?.plannedPct ?? 0) * 100
        }),
      },
      {
        id: 'actual',
        label: 'Actual absenteeism',
        color: COLORS.actual,
        type: 'bar',
        values: chartRows.map((row) => {
          if (row.statusLabel !== 'Actual') return null
          const category = row.shrinkageCategories?.find((item) => item.id === 'absenteeism')
          return category?.actualPct != null ? category.actualPct * 100 : null
        }),
      },
    ],
    [chartRows],
  )

  const active = useMemo(() => {
    if (tab === 'staffing') {
      return {
        series: staffingSeries,
        yLabel: 'FTE',
        formatValue: (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 1 }),
      }
    }
    if (tab === 'volume') {
      return {
        series: volumeSeries,
        yLabel: 'Contacts',
        formatValue: fmtCompact,
      }
    }
    if (tab === 'attrition') {
      return {
        series: attritionSeries,
        yLabel: 'HC',
        formatValue: (v: number) => String(Math.round(v)),
      }
    }
    if (tab === 'aht') {
      return {
        series: ahtSeries,
        yLabel: 'Seconds',
        formatValue: (v: number) => `${Math.round(v)}s`,
      }
    }
    return {
      series: absenteeismSeries,
      yLabel: '%',
      formatValue: (v: number) => `${v.toFixed(1)}%`,
    }
  }, [absenteeismSeries, ahtSeries, attritionSeries, staffingSeries, tab, volumeSeries])

  const highlightIndex = focusedWeek ? weeks.indexOf(focusedWeek) : -1

  const onPointClick = useCallback(
    (index: number) => {
      const week = weeks[index]
      if (!week) return
      setFocusedWeek((current) => (current === week ? null : week))
    },
    [weeks],
  )

  const focused = focusedWeek ? chartRows.find((row) => row.week === focusedWeek) : null

  const initialZoomStart = chartRows.length > 24 ? Math.max(0, 1 - 24 / chartRows.length) : 0

  if (!open) return null

  return (
    <section className="cap-charts-panel saas-card" aria-label="Capacity charts">
      <header className="cap-charts-panel__head">
        <div>
          <h3 className="cap-charts-panel__title m-0">
            Staffing · Volume · Attrition · AHT · Absenteeism
          </h3>
        </div>
        <button type="button" className="saas-btn saas-btn--secondary" onClick={onClose}>
          Hide charts
        </button>
      </header>

      <div className="cap-charts-panel__tabs" role="tablist" aria-label="Chart views">
        {(
          [
            ['staffing', 'Staffing'],
            ['volume', 'Volume'],
            ['attrition', 'Attrition'],
            ['aht', 'AHT'],
            ['absenteeism', 'Absenteeism'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`cap-charts-panel__tab${tab === id ? ' is-active' : ''}`}
            onClick={() => {
              setTab(id)
              setFocusedWeek(null)
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="cap-charts-panel__body">
        <InteractiveD3Chart
          key={tab}
          labels={labels}
          series={active.series}
          height={420}
          yLabel={active.yLabel}
          formatValue={active.formatValue}
          emptyMessage="No capacity weeks in scope to chart."
          initialZoomStart={initialZoomStart}
          initialZoomEnd={1}
          onPointClick={onPointClick}
          highlightIndex={highlightIndex >= 0 ? highlightIndex : null}
          ariaLabel={`Capacity ${tab} chart`}
        />
      </div>

      {focused ? (
        <p className="cap-charts-panel__focus" role="status">
          {focusSummary(tab, focused)}
        </p>
      ) : (
        <p className="cap-charts-panel__hint saas-muted m-0">
          Click a week to pin details. Toggle series in the legend, scroll to zoom, or use the
          range sliders — no page reload needed.
        </p>
      )}
    </section>
  )
}
