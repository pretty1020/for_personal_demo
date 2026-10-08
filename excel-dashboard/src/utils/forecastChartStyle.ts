import type { EChartsOption } from 'echarts'
import { fmtNum } from '../planner/format'
import { APP_THEME, chartTooltipStyle, modernChartMotion } from './appTheme'

/** Brand-aligned forecast series colours — visual only. */
export const FORECAST_CHART_COLOURS = {
  historical: '#1c1915',
  fitted: '#8c7348',
  forecast: '#9a3b2f',
  band: 'rgba(154, 59, 47, 0.12)',
  anomaly: '#9a3b2f',
  train: '#2c5648',
  futureZone: 'rgba(44, 86, 72, 0.08)',
} as const

export function forecastValueLabel(value: number, unit: 'number' | 'percent' | 'seconds'): string {
  if (!Number.isFinite(value)) return '—'
  if (unit === 'percent') return `${fmtNum(value * 100, 1)}%`
  if (unit === 'seconds') return `${fmtNum(value, 1)} sec`
  return fmtNum(value, 0)
}

function tickInterval(count: number): number | 'auto' {
  if (count <= 14) return 0
  if (count <= 28) return 1
  return Math.floor(count / 12)
}

export function forecastCategoryAxis(labels: string[]): EChartsOption['xAxis'] {
  return {
    type: 'category',
    data: labels,
    boundaryGap: false,
    axisLine: { lineStyle: { color: APP_THEME.axis.line } },
    axisTick: { alignWithLabel: true, lineStyle: { color: APP_THEME.axis.line } },
    axisLabel: {
      fontSize: 10,
      color: APP_THEME.axis.label,
      interval: tickInterval(labels.length),
      rotate: labels.length > 18 ? 40 : 0,
      hideOverlap: true,
    },
  }
}

export function forecastValueAxis(unit: 'number' | 'percent' | 'seconds'): EChartsOption['yAxis'] {
  return {
    type: 'value',
    axisLine: { show: true, lineStyle: { color: APP_THEME.axis.line, width: 1 } },
    axisTick: { show: true, length: 4, lineStyle: { color: APP_THEME.axis.line } },
    axisLabel: {
      fontSize: 10,
      color: APP_THEME.axis.label,
      formatter: (value: number) => forecastValueLabel(value, unit),
    },
    splitLine: {
      lineStyle: {
        color: '#e3dbd0',
        type: 'solid',
        width: 1,
      },
    },
  }
}

export function forecastDataZoom(startPct: number): EChartsOption['dataZoom'] {
  return [
    {
      type: 'inside',
      start: startPct,
      end: 100,
      zoomOnMouseWheel: true,
      moveOnMouseMove: true,
    },
    {
      type: 'slider',
      height: 30,
      bottom: 10,
      start: startPct,
      end: 100,
      borderColor: 'transparent',
      backgroundColor: 'rgba(241, 245, 249, 0.95)',
      fillerColor: 'rgba(44, 86, 72, 0.16)',
      handleIcon:
        'path://M10.7,11.9v-1.3H9.3v1.3c-4.9,0.3-8.8,4.4-8.8,9.4c0,5,3.9,9.1,8.8,9.4v1.3h1.3v-1.3c4.9-0.3,8.8-4.4,8.8-9.4C19.5,16.3,15.6,12.2,10.7,11.9z M13.3,24.4H6.7V23h6.6V24.4z M13.3,19.6H6.7v-1.4h6.6V19.6z',
      handleSize: '110%',
      handleStyle: {
        color: '#fff',
        borderColor: '#1c1915',
        borderWidth: 1,
        shadowBlur: 0,
        shadowColor: 'transparent',
      },
      moveHandleStyle: { color: '#8c7348', borderColor: '#8c7348' },
      dataBackground: {
        lineStyle: { color: 'rgba(148, 163, 184, 0.45)', width: 1 },
        areaStyle: { color: 'rgba(15, 76, 129, 0.07)' },
      },
      selectedDataBackground: {
        lineStyle: { color: '#1c1915', width: 1 },
        areaStyle: { color: 'rgba(28, 25, 21, 0.06)' },
      },
      textStyle: { color: '#64748b', fontSize: 10 },
    },
  ]
}

export function forecastLegend(names: string[]): EChartsOption['legend'] {
  return {
    top: 4,
    left: 'center',
    data: names,
    textStyle: { fontSize: 11, color: '#475569', fontWeight: 600 },
    itemWidth: 18,
    itemHeight: 10,
    itemGap: 16,
    icon: 'rect',
  }
}

export function forecastAxisTooltip(unit: 'number' | 'percent' | 'seconds'): EChartsOption['tooltip'] {
  return {
    trigger: 'axis',
    ...chartTooltipStyle(),
    axisPointer: {
      type: 'cross',
      crossStyle: { color: 'rgba(28, 25, 21, 0.28)', width: 1 },
      lineStyle: { color: 'rgba(28, 25, 21, 0.35)', type: 'solid', width: 1 },
      label: {
        backgroundColor: '#1c1915',
        color: '#fff',
        fontSize: 10,
        padding: [4, 6],
        borderRadius: 4,
        formatter: (params: { value?: unknown }) => {
          const raw = params.value
          if (typeof raw === 'number') return forecastValueLabel(raw, unit)
          return String(raw ?? '')
        },
      },
    },
    formatter: (params: unknown) => {
      const items = (Array.isArray(params) ? params : [params]) as Array<{
        axisValue?: string
        seriesName?: string
        value?: number | null
        color?: string
      }>
      if (!items.length) return ''
      const header = `<div style="font-weight:750;margin-bottom:6px;color:#0f172a">${items[0]?.axisValue ?? ''}</div>`
      const rows = items
        .filter((item) => item.seriesName && item.seriesName !== 'lower' && item.value != null)
        .map((item) => {
          const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${item.color ?? '#64748b'};margin-right:6px"></span>`
          return `<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin:3px 0">
            <span>${dot}${item.seriesName}</span>
            <strong style="font-variant-numeric:tabular-nums">${forecastValueLabel(Number(item.value), unit)}</strong>
          </div>`
        })
        .join('')
      return header + rows
    },
  }
}

export function forecastFutureMarkArea(labels: string[], firstFutureIndex: number) {
  if (firstFutureIndex < 0 || firstFutureIndex >= labels.length) return {}
  return {
    markArea: {
      silent: true,
      itemStyle: { color: FORECAST_CHART_COLOURS.futureZone },
      data: [
        [{ xAxis: labels[firstFutureIndex]! }, { xAxis: labels[labels.length - 1]! }],
      ] as [{ xAxis: string }, { xAxis: string }][],
    },
  }
}

export function forecastLineEmphasis() {
  return {
    focus: 'series' as const,
    lineStyle: { width: 3 },
    itemStyle: { borderWidth: 2, borderColor: '#fff' },
  }
}

/** Compose motion + tooltip without overriding series data. */
export function withForecastChartLook<T extends EChartsOption>(option: T): T {
  return {
    ...modernChartMotion(),
    ...option,
  }
}
