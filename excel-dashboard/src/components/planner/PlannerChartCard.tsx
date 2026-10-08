import { useMemo, useState, type ReactNode } from 'react'
import type { EChartsOption } from 'echarts'
import ReactECharts from 'echarts-for-react'

function withLabelVisibility(option: object, show: boolean): object {
  const raw = option as { series?: unknown }
  const series = raw.series
  if (!series) return option
  const list = Array.isArray(series) ? series : [series]
  return {
    ...raw,
    series: list.map((s) => ({
      ...(s as object),
      label: {
        ...((s as { label?: object }).label ?? {}),
        show,
        fontSize: 10,
      },
    })),
  }
}

type Props = {
  title: string
  option: object
  height?: number
  defaultHidden?: boolean
  footer?: ReactNode
}

export function PlannerChartCard({ title, option, height = 220, defaultHidden = true, footer }: Props) {
  const [hidden, setHidden] = useState(defaultHidden)
  const [labels, setLabels] = useState(false)
  const chartOption = useMemo(() => withLabelVisibility(option, labels) as EChartsOption, [option, labels])

  return (
    <article className={`exec-chart-card planner-chart-card${hidden ? ' exec-chart-card--plot-hidden' : ''}`}>
      <header className="exec-chart-card__head">
        <h3 className="exec-chart-card__title m-0">{title}</h3>
        <div className="exec-chart-card__actions">
          <button type="button" className="exec-chart-card__btn" onClick={() => setHidden((v) => !v)}>
            {hidden ? 'Show chart' : 'Hide chart'}
          </button>
          {!hidden ? (
            <button type="button" className="exec-chart-card__btn" onClick={() => setLabels((v) => !v)}>
              {labels ? 'Hide labels' : 'Show labels'}
            </button>
          ) : null}
        </div>
      </header>
      {hidden ? (
        <div className="exec-chart-placeholder exec-chart-placeholder--collapsed">
          <span className="exec-chart-placeholder__hint">Chart hidden — use Show chart to expand</span>
        </div>
      ) : (
        <div className="exec-chart-card__plot-live">
          <ReactECharts theme="ledger" option={chartOption} style={{ height }} notMerge />
          {footer}
        </div>
      )}
    </article>
  )
}
