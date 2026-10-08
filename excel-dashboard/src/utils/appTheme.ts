/** Chart and UI theme — ink, pine, and brass */
export const APP_THEME = {
  primary: '#2c5648',
  primaryDark: '#1c1915',
  accent: '#8c7348',
  lime: '#6d7f4e',
  success: '#2f6b4f',
  warning: '#9a6b2f',
  danger: '#9c3b32',
  slate: '#6e675f',
  chart: ['#1c1915', '#2c5648', '#8c7348', '#6d7f4e', '#4d6b5e', '#9c3b32'],
  axis: { line: '#1c1915', label: '#6e675f' },
} as const

export const CHART_SERIES = APP_THEME.chart

export function chartTooltipStyle() {
  return {
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderColor: '#e3dbd0',
    borderWidth: 1,
    padding: [10, 12] as [number, number],
    extraCssText: 'border-radius:6px;box-shadow:0 8px 24px rgba(28,25,21,0.08);',
    textStyle: {
      color: '#1c1915',
      fontSize: 12,
      fontFamily: "'IBM Plex Sans', 'Segoe UI', sans-serif",
    },
  }
}

/** Shared motion + typography defaults — does not alter series data. */
export function modernChartMotion() {
  return {
    animation: true,
    animationDuration: 680,
    animationDurationUpdate: 420,
    animationEasing: 'cubicOut' as const,
    animationEasingUpdate: 'cubicInOut' as const,
    textStyle: {
      fontFamily: "'IBM Plex Sans', 'Segoe UI', sans-serif",
    },
  }
}
