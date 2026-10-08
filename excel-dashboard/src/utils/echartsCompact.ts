import * as echarts from 'echarts'
import { APP_THEME, chartTooltipStyle, modernChartMotion } from './appTheme'

/** Shared ECharts theme: ink axes, tick marks, square marks, paper grid. */
export const LEDGER_CHART_THEME = 'ledger'

echarts.registerTheme(LEDGER_CHART_THEME, {
  color: ['#1c1915', '#2c5648', '#8c7348', '#6e675f', '#4d6b5e', '#9a6b2f', '#3d4f46'],
  backgroundColor: 'transparent',
  textStyle: { fontFamily: 'IBM Plex Sans, sans-serif', color: APP_THEME.axis.label },
  categoryAxis: {
    axisLine: { show: true, lineStyle: { color: '#1c1915', width: 1 } },
    axisTick: { show: true, alignWithLabel: true, length: 4, lineStyle: { color: '#1c1915' } },
    axisLabel: { color: APP_THEME.axis.label, fontSize: 11 },
    splitLine: { show: false },
  },
  valueAxis: {
    axisLine: { show: true, lineStyle: { color: '#1c1915', width: 1 } },
    axisTick: { show: true, length: 4, lineStyle: { color: '#1c1915' } },
    axisLabel: { color: APP_THEME.axis.label, fontSize: 11 },
    splitLine: { lineStyle: { color: '#e3dbd0', width: 1, type: 'solid' } },
  },
  line: { symbol: 'circle', symbolSize: 5, lineStyle: { width: 1.5 } },
  bar: { itemStyle: { borderRadius: 0 } },
})

export const CHART_HEIGHT_COMPACT = 220
export const CHART_HEIGHT_STANDARD = 240

function tickInterval(count: number): number | 'auto' {
  if (count <= 12) return 0
  if (count <= 24) return 1
  return Math.floor(count / 10)
}

export function compactCategoryAxis(labels: string[]) {
  return {
    type: 'category' as const,
    data: labels,
    axisLabel: {
      fontSize: 11,
      color: APP_THEME.axis.label,
      interval: tickInterval(labels.length),
      rotate: labels.length > 16 ? 45 : 0,
    },
    axisLine: { lineStyle: { color: APP_THEME.axis.line } },
    axisTick: { alignWithLabel: true, lineStyle: { color: APP_THEME.axis.line } },
  }
}

export function compactValueAxis(opts?: {
  percent?: boolean
  min?: number
  max?: number
  currency?: boolean
}) {
  const formatValue = (v: number) => {
    if (opts?.percent) return `${(v * 100).toFixed(0)}%`
    if (opts?.currency) {
      const abs = Math.abs(v)
      if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
      if (abs >= 1_000) return `$${(v / 1_000).toFixed(0)}k`
      return `$${v}`
    }
    return String(v)
  }
  return {
    type: 'value' as const,
    min: opts?.min,
    max: opts?.max,
    axisLabel: {
      fontSize: 11,
      color: APP_THEME.axis.label,
      formatter: opts?.percent || opts?.currency ? formatValue : undefined,
    },
    splitLine: {
      lineStyle: {
        color: '#e3dbd0',
        type: 'solid' as const,
        width: 1,
      },
    },
  }
}

export function compactLegend(names: string[]) {
  return {
    data: names,
    bottom: 0,
    textStyle: { fontSize: 11, color: '#475569' },
    itemWidth: 14,
    itemHeight: 8,
    itemGap: 12,
    icon: 'rect' as const,
  }
}

export function compactGrid(bottom = 48) {
  return { left: 54, right: 16, top: 32, bottom, containLabel: false }
}

export function compactAxisTooltip() {
  return {
    trigger: 'axis' as const,
    ...chartTooltipStyle(),
    axisPointer: {
      type: 'line' as const,
      lineStyle: { color: 'rgba(28, 25, 21, 0.35)', width: 1, type: 'solid' as const },
      shadowStyle: { color: 'rgba(28, 25, 21, 0.04)' },
    },
  }
}

export function compactPieLegend() {
  return {
    orient: 'horizontal' as const,
    bottom: 0,
    textStyle: { fontSize: 11, color: '#475569' },
    itemWidth: 10,
    itemHeight: 10,
  }
}

/** Layer modern motion/tooltip defaults onto an existing option without changing series values. */
export function withModernChartLook<T extends object>(option: T): T {
  const record = option as T & Record<string, unknown>
  const existingTooltip =
    record.tooltip && typeof record.tooltip === 'object' && !Array.isArray(record.tooltip)
      ? (record.tooltip as Record<string, unknown>)
      : {}
  const existingAxisPointer =
    existingTooltip.axisPointer && typeof existingTooltip.axisPointer === 'object'
      ? (existingTooltip.axisPointer as Record<string, unknown>)
      : undefined
  const useAxisPointer =
    existingTooltip.trigger === 'axis' ||
    (existingTooltip.trigger == null && existingAxisPointer != null)

  return {
    ...modernChartMotion(),
    ...option,
    tooltip: {
      ...chartTooltipStyle(),
      ...existingTooltip,
      ...(useAxisPointer
        ? {
            axisPointer: {
              type: 'line',
              lineStyle: { color: 'rgba(28, 25, 21, 0.35)', width: 1 },
              ...existingAxisPointer,
            },
          }
        : {}),
    },
  }
}
