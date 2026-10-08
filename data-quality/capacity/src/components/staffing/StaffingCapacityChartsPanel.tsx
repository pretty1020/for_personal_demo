import { useMemo, useRef, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import type { DerivedCapacityRow } from '../../planner/capacityPlanDerived'
import { downloadElementAsPng } from '../../planner/capacityPresentationExport'

type VolumeLabels = {
  forecastVolume: string
  actualVolume: string
  handledVolume: string
}

type Props = {
  rows: DerivedCapacityRow[]
  volumeLabels: VolumeLabels
  onClose: () => void
  /** Optional filename stem for PNG exports. */
  exportTitle?: string
}

function weekLabel(week: string): string {
  if (week.length < 10) return week
  const date = new Date(`${week.slice(0, 10)}T12:00:00`)
  if (Number.isNaN(date.getTime())) return week
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function productionFte(row: DerivedCapacityRow): number | null {
  return row.statusLabel === 'Actual' ? row.actual.productionFte : row.planned.productionFte
}

function requiredFte(row: DerivedCapacityRow): number | null {
  return row.planned.requiredFte
}

function forecastVolume(row: DerivedCapacityRow): number {
  return row.planned.volume
}

function offeredVolume(row: DerivedCapacityRow): number | null {
  return row.statusLabel === 'Actual' ? row.actual.offeredVolume : null
}

function handledVolume(row: DerivedCapacityRow): number | null {
  return row.statusLabel === 'Actual' ? row.actual.handledVolume : null
}

export function StaffingCapacityChartsPanel({ rows, volumeLabels, onClose, exportTitle }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [exporting, setExporting] = useState(false)
  const labels = useMemo(() => rows.map((row) => weekLabel(row.week)), [rows])
  const fileStem = (exportTitle || 'staffing_charts').replace(/[^\w.-]+/g, '_')

  const fteOption = useMemo((): EChartsOption => {
    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis' },
      legend: { data: ['Required Production FTE', 'Production FTE'], bottom: 0 },
      grid: { left: 48, right: 24, top: 28, bottom: 56 },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: { rotate: labels.length > 10 ? 35 : 0 },
      },
      yAxis: { type: 'value', name: 'FTE' },
      series: [
        {
          name: 'Required Production FTE',
          type: 'line',
          smooth: true,
          data: rows.map((row) => requiredFte(row)),
          itemStyle: { color: '#be185d' },
          lineStyle: { width: 3 },
        },
        {
          name: 'Production FTE',
          type: 'line',
          smooth: true,
          data: rows.map((row) => productionFte(row)),
          itemStyle: { color: '#0369a1' },
          lineStyle: { width: 3 },
        },
      ],
    }
  }, [labels, rows])

  const volumeOption = useMemo((): EChartsOption => {
    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis' },
      legend: {
        data: [volumeLabels.forecastVolume, volumeLabels.actualVolume, volumeLabels.handledVolume],
        bottom: 0,
      },
      grid: { left: 56, right: 24, top: 28, bottom: 56 },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: { rotate: labels.length > 10 ? 35 : 0 },
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          formatter: (value: number) =>
            value >= 1_000_000
              ? `${(value / 1_000_000).toFixed(1)}M`
              : value >= 1000
                ? `${Math.round(value / 1000)}k`
                : String(value),
        },
      },
      series: [
        {
          name: volumeLabels.forecastVolume,
          type: 'bar',
          data: rows.map((row) => forecastVolume(row)),
          itemStyle: { color: '#db2777' },
        },
        {
          name: volumeLabels.actualVolume,
          type: 'bar',
          data: rows.map((row) => offeredVolume(row)),
          itemStyle: { color: '#64748b' },
        },
        {
          name: volumeLabels.handledVolume,
          type: 'line',
          smooth: true,
          data: rows.map((row) => handledVolume(row)),
          itemStyle: { color: '#059669' },
          lineStyle: { width: 3 },
        },
      ],
    }
  }, [labels, rows, volumeLabels])

  const staffingOption = useMemo((): EChartsOption => {
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        valueFormatter: (value) =>
          value == null || !Number.isFinite(Number(value)) ? '—' : `${Number(value).toFixed(1)}%`,
      },
      legend: { data: ['Staffing %'], bottom: 0 },
      grid: { left: 48, right: 24, top: 28, bottom: 48 },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: { rotate: labels.length > 10 ? 35 : 0 },
      },
      yAxis: {
        type: 'value',
        axisLabel: { formatter: (value: number) => `${value}%` },
      },
      series: [
        {
          name: 'Staffing %',
          type: 'line',
          smooth: true,
          areaStyle: { opacity: 0.12, color: '#db2777' },
          data: rows.map((row) => {
            const required = requiredFte(row)
            const production = productionFte(row)
            if (required == null || required <= 0 || production == null) return null
            return Math.round((production / required) * 1000) / 10
          }),
          itemStyle: { color: '#9f1239' },
          lineStyle: { width: 3 },
        },
      ],
    }
  }, [labels, rows])

  const downloadChartsPng = async () => {
    if (!panelRef.current || exporting) return
    setExporting(true)
    try {
      await downloadElementAsPng(panelRef.current, `${fileStem}_charts`)
    } finally {
      setExporting(false)
    }
  }

  if (!rows.length) {
    return (
      <div className="cap-staffing-charts" ref={panelRef}>
        <div className="cap-staffing-charts__head">
          <div>
            <p className="cap-staffing-charts__eyebrow">Insights</p>
            <h3 className="m-0">Capacity charts</h3>
            <p className="saas-muted m-0">No weeks in the current filter to chart.</p>
          </div>
          <button type="button" className="saas-btn saas-btn--secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="cap-staffing-charts" aria-label="Capacity charts" ref={panelRef}>
      <div className="cap-staffing-charts__head">
        <div>
          <p className="cap-staffing-charts__eyebrow">Insights</p>
          <h3 className="m-0">Capacity charts</h3>
          <p className="saas-muted m-0">
            Trends for the {rows.length} week{rows.length === 1 ? '' : 's'} currently shown — ready for
            presentation export.
          </p>
        </div>
        <div className="cap-staffing-charts__actions">
          <button
            type="button"
            className="saas-btn"
            disabled={exporting}
            onClick={() => void downloadChartsPng()}
            title="Download charts as a PNG image for slides"
          >
            {exporting ? 'Preparing…' : 'Download charts PNG'}
          </button>
          <button type="button" className="saas-btn saas-btn--secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      <div className="cap-staffing-charts__grid">
        <article className="cap-panel cap-staffing-charts__card">
          <h4 className="cap-staffing-charts__title">Required Production FTE vs Production FTE</h4>
          <ReactECharts option={fteOption} style={{ height: 300 }} notMerge lazyUpdate />
        </article>
        <article className="cap-panel cap-staffing-charts__card">
          <h4 className="cap-staffing-charts__title">
            {volumeLabels.forecastVolume} vs {volumeLabels.actualVolume} vs {volumeLabels.handledVolume}
          </h4>
          <ReactECharts option={volumeOption} style={{ height: 300 }} notMerge lazyUpdate />
        </article>
        <article className="cap-panel cap-staffing-charts__card cap-staffing-charts__card--wide">
          <h4 className="cap-staffing-charts__title">Staffing % trend</h4>
          <ReactECharts option={staffingOption} style={{ height: 280 }} notMerge lazyUpdate />
        </article>
      </div>
    </div>
  )
}
