import { useMemo, useState } from 'react'

import type { EChartsOption } from 'echarts'

import ReactECharts from 'echarts-for-react'

import { clampOccupancyPct, SCHED_CHART_COLORS } from '../../planner/scheduling/schedulingMetrics'
import type { SchedulingResult } from '../../planner/scheduling/types'
import { withModernChartLook } from '../../utils/echartsCompact'

type Props = {
  result: SchedulingResult
  fteWeeklyHours?: number
  shiftLengthHours?: number
  intervalMinutes?: number
  selectedDay?: string | null
  onSelectDay?: (dayKey: string) => void
}

const CHART_THEME = {
  text: '#334155',
  grid: '#e2e8f0',
  muted: '#94a3b8',
}

export function SchedulingDailyCharts({
  result,
  fteWeeklyHours = 45,
  shiftLengthHours = 8,
  intervalMinutes = 30,
  selectedDay,
  onSelectDay,
}: Props) {
  const [showOccupancy, setShowOccupancy] = useState(false)
  const [showServiceLevel, setShowServiceLevel] = useState(true)
  const [showErlangSl, setShowErlangSl] = useState(false)

  const intervalDivisor = 60 / intervalMinutes
  const dailyFormula = `SUM(Net FTE intervals) ÷ ${shiftLengthHours} ÷ ${intervalDivisor}`
  const weeklyFormula = `SUM(Net FTE intervals) ÷ ${fteWeeklyHours} ÷ ${intervalDivisor}`

  const dailyOption = useMemo<EChartsOption>(() => {
    const days = result.days.map((day) => day.dateLabel)

    return {
      color: [SCHED_CHART_COLORS.required, SCHED_CHART_COLORS.scheduled, SCHED_CHART_COLORS.staffing],
      grid: { left: 52, right: 48, top: 48, bottom: 52 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#fff',
        borderColor: '#e2e8f0',
        textStyle: { color: CHART_THEME.text },
        valueFormatter: (value) => (typeof value === 'number' ? value.toFixed(1) : String(value ?? '')),
      },
      legend: { top: 0, textStyle: { color: CHART_THEME.text }, data: ['Required FTE', 'Net FTE after shrinkage', 'Staffing %'] },
      xAxis: {
        type: 'category',
        data: days,
        axisLabel: { rotate: 22, fontSize: 11, color: CHART_THEME.muted },
        axisLine: { lineStyle: { color: CHART_THEME.grid } },
      },
      yAxis: [
        {
          type: 'value',
          name: 'Daily FTE',
          nameTextStyle: { color: CHART_THEME.muted },
          splitLine: { lineStyle: { color: CHART_THEME.grid, type: 'solid' } },
          axisLabel: { color: CHART_THEME.muted },
        },
        {
          type: 'value',
          name: 'Staffing %',
          min: 0,
          max: 150,
          splitLine: { show: false },
          axisLabel: { color: CHART_THEME.muted, formatter: '{value}%' },
        },
      ],
      series: [
        {
          name: 'Required FTE',
          type: 'bar',
          barMaxWidth: 32,
          itemStyle: { borderRadius: 0, color: SCHED_CHART_COLORS.required },
          data: result.days.map((day) => day.dailyRequiredTotal),
        },
        {
          name: 'Net FTE after shrinkage',
          type: 'bar',
          barMaxWidth: 32,
          itemStyle: { borderRadius: 0, color: SCHED_CHART_COLORS.scheduled },
          data: result.days.map((day) => day.dailyNetFteTotal ?? 0),
        },
        {
          name: 'Staffing %',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          symbolSize: 7,
          lineStyle: { width: 2.5, color: SCHED_CHART_COLORS.staffing },
          itemStyle: { color: SCHED_CHART_COLORS.staffing },
          data: result.days.map((day) => day.dailyStaffingPct ?? 0),
        },
      ],
    }
  }, [result.days])

  const weekPatternOption = useMemo<EChartsOption>(() => {
    const labels: string[] = []
    const required: number[] = []
    const scheduled: number[] = []

    for (const day of result.days) {
      for (const row of day.intervals) {
        if (row.requiredFte <= 0.01 && (row.netFteAfterShrinkage ?? row.netFte ?? 0) <= 0.01) continue
        labels.push(`${day.dateLabel.slice(0, 3)} ${row.interval}`)
        required.push(row.requiredFte)
        scheduled.push(row.netFteAfterShrinkage ?? row.netFte ?? 0)
      }
      labels.push('|')
      required.push(NaN)
      scheduled.push(NaN)
    }

    return {
      color: [SCHED_CHART_COLORS.reqLine, SCHED_CHART_COLORS.scheduled],
      grid: { left: 52, right: 24, top: 48, bottom: 40 },
      tooltip: { trigger: 'axis', backgroundColor: '#fff', borderColor: '#e2e8f0' },
      legend: { top: 0, data: ['Required', 'Scheduled'] },
      xAxis: { type: 'category', data: labels, axisLabel: { show: false } },
      yAxis: {
        type: 'value',
        name: 'Headcount / interval',
        splitLine: { lineStyle: { color: CHART_THEME.grid, type: 'solid' } },
      },
      series: [
        {
          name: 'Required',
          type: 'line',
          symbol: 'circle',
          symbolSize: 4,
          showSymbol: false,
          lineStyle: { width: 2.5, color: SCHED_CHART_COLORS.reqLine },
          itemStyle: { color: SCHED_CHART_COLORS.reqLine },
          data: required,
        },
        {
          name: 'Scheduled',
          type: 'line',
          symbol: 'none',
          lineStyle: { width: 2, color: SCHED_CHART_COLORS.scheduled },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(14, 165, 233, 0.28)' },
                { offset: 1, color: 'rgba(14, 165, 233, 0.04)' },
              ],
            },
          },
          data: scheduled,
        },
      ],
    }
  }, [result.days])

  const activeDay = result.days.find((day) => day.day === selectedDay) ?? result.days[0] ?? null

  const intervalOption = useMemo<EChartsOption>(() => {
    if (!activeDay) return {}

    const hoopRows = activeDay.intervals.filter((row) => row.requiredFte > 0 || row.scheduledFte > 0)
    const legend = ['Required', 'Scheduled']
    const series: EChartsOption['series'] = [
      {
        name: 'Required',
        type: 'line',
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2.5, color: SCHED_CHART_COLORS.required },
        areaStyle: { color: 'rgba(79, 70, 229, 0.08)' },
        data: hoopRows.map((row) => row.requiredFte),
      },
      {
        name: 'Scheduled',
        type: 'line',
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2.5, color: SCHED_CHART_COLORS.scheduled },
        areaStyle: { color: 'rgba(14, 165, 233, 0.1)' },
        data: hoopRows.map((row) => row.scheduledFte),
      },
    ]

    if (showOccupancy) {
      legend.push('Occupancy %')
      series.push({
        name: 'Occupancy %',
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        symbolSize: 4,
        lineStyle: { width: 2, type: 'dotted', color: SCHED_CHART_COLORS.occupancy },
        data: hoopRows.map((row) => clampOccupancyPct(row.occupancyPct)),
      })
    }
    if (showServiceLevel) {
      legend.push(showErlangSl ? 'Projected SL (Erlang) %' : 'Projected SL %')
      series.push({
        name: showErlangSl ? 'Projected SL (Erlang) %' : 'Projected SL %',
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        symbolSize: 4,
        lineStyle: { width: 2, color: SCHED_CHART_COLORS.serviceLevel },
        data: hoopRows.map((row) =>
          showErlangSl ? (row.projectedSlErlangPct ?? null) : (row.projectedSlPct ?? null),
        ),
      })
    }

    const hasOptionalAxis = showOccupancy || showServiceLevel

    return {
      color: [
        SCHED_CHART_COLORS.required,
        SCHED_CHART_COLORS.scheduled,
        SCHED_CHART_COLORS.adherence,
        SCHED_CHART_COLORS.occupancy,
        SCHED_CHART_COLORS.serviceLevel,
      ],
      grid: { left: 52, right: hasOptionalAxis ? 56 : 24, top: 48, bottom: 56 },
      tooltip: { trigger: 'axis', backgroundColor: '#fff', borderColor: '#e2e8f0' },
      legend: { top: 0, data: legend },
      xAxis: {
        type: 'category',
        data: hoopRows.map((row) => row.interval),
        axisLabel: { rotate: 50, fontSize: 10, interval: 2, color: CHART_THEME.muted },
      },
      yAxis: [
        {
          type: 'value',
          name: 'Headcount',
          splitLine: { lineStyle: { color: CHART_THEME.grid, type: 'solid' } },
        },
        ...(hasOptionalAxis
          ? [
              {
                type: 'value' as const,
                name: '%',
                min: 0,
                max: 150,
                splitLine: { show: false },
                axisLabel: { formatter: '{value}%' },
              },
            ]
          : []),
      ],
      series,
    }
  }, [activeDay, showOccupancy, showServiceLevel, showErlangSl])

  return (
    <div className="sched-charts">
      <article className="sched-chart-card sched-chart-card--wide" data-sched-chart="week-pattern">
        <header className="sched-chart-card__head">
          <h3 className="sched-chart-card__title">Week — Required vs Scheduled</h3>
          <p className="saas-muted m-0 text-xs">
            Pattern distribution across the week. Weekly = {weeklyFormula}. Daily = {dailyFormula}.
          </p>
        </header>
        <ReactECharts theme="ledger"
          option={withModernChartLook(weekPatternOption)}
          style={{ height: 300 }}
          notMerge
          opts={{ renderer: 'canvas' }}
        />
      </article>

      <article className="sched-chart-card" data-sched-chart="daily">
        <header className="sched-chart-card__head">
          <h3 className="sched-chart-card__title">Daily FTE comparison</h3>
          <p className="saas-muted m-0 text-xs">
            Required {result.totals.weeklySumRequired?.toFixed(1)} FTE · Net FTE after shrinkage{' '}
            {result.totals.weeklySumScheduled?.toFixed(1)} FTE (week totals — not roster HC).
          </p>
        </header>
        <ReactECharts theme="ledger"
          option={withModernChartLook(dailyOption)}
          style={{ height: 300 }}
          notMerge
          opts={{ renderer: 'canvas' }}
        />
      </article>

      {activeDay ? (
        <article className="sched-chart-card sched-chart-card--wide" data-sched-chart="interval">
          <header className="sched-chart-card__head">
            <div>
              <h3 className="sched-chart-card__title">Interval detail — {activeDay.dateLabel}</h3>
              <p className="saas-muted m-0 text-xs">Required and Scheduled with projected SL by default. Toggle optional metrics.</p>
              <div className="sched-chart-toggles" role="group" aria-label="Optional interval metrics">
                <label className="sched-chart-toggle">
                  <input
                    type="checkbox"
                    checked={showServiceLevel}
                    onChange={(event) => setShowServiceLevel(event.target.checked)}
                  />
                  Projected SL
                </label>
                <button
                  type="button"
                  className={`sched-erlang-toggle sched-chart-erlang-btn${showErlangSl ? ' is-active' : ''}`}
                  disabled={!showServiceLevel}
                  onClick={() => setShowErlangSl((prev) => !prev)}
                >
                  Erlang C
                </button>
                <label className="sched-chart-toggle">
                  <input
                    type="checkbox"
                    checked={showOccupancy}
                    onChange={(event) => setShowOccupancy(event.target.checked)}
                  />
                  Occupancy
                </label>
              </div>
            </div>
            {onSelectDay ? (
              <select
                className="cap-field__input sched-chart-card__select"
                value={activeDay.day}
                onChange={(event) => onSelectDay(event.target.value)}
              >
                {result.days.map((day) => (
                  <option key={day.day} value={day.day}>
                    {day.dateLabel}
                    {day.isClosed ? ' (closed)' : ''}
                  </option>
                ))}
              </select>
            ) : null}
          </header>
          <ReactECharts theme="ledger"
            option={withModernChartLook(intervalOption)}
            style={{ height: 300 }}
            notMerge
            opts={{ renderer: 'canvas' }}
          />
        </article>
      ) : null}
    </div>
  )
}
