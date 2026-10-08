import { type ReactNode, useCallback, useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { ExecChartCardContext } from './ExecChartCardContext'

type ExecChartCardProps = {
  title?: string
  insight: string
  controls?: ReactNode
  children?: ReactNode
  renderChart?: (expanded: boolean) => ReactNode
  showDataLabels: boolean
  onToggleLabels: (v: boolean) => void
  expandTitle: string
  expandContent: ReactNode
  accent?: number
  defaultChartHidden?: boolean
}

export function ExecChartCard(props: ExecChartCardProps) {
  const {
    title,
    insight,
    controls,
    children,
    renderChart,
    showDataLabels,
    onToggleLabels,
    expandTitle,
    expandContent,
    accent = 0,
    defaultChartHidden = false,
  } = props
  const [open, setOpen] = useState(false)
  const [chartHidden, setChartHidden] = useState(defaultChartHidden)
  const [plotGeneration, setPlotGeneration] = useState(0)
  const headingId = useId()

  const close = () => {
    setOpen(false)
    setPlotGeneration((g) => g + 1)
  }

  const inlineVisible = !chartHidden || open

  const revealChart = useCallback(() => {
    setChartHidden(false)
    setPlotGeneration((g) => g + 1)
  }, [])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const chartFor = (expanded: boolean) =>
    renderChart ? renderChart(expanded) : children

  const inlineContext = {
    expanded: false,
    inlineVisible,
    plotGeneration,
  }

  const overlay =
    open && typeof document !== 'undefined'
      ? createPortal(
          <div
            className="exec-expand-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby={headingId}
            onClick={close}
          >
            <div className="exec-expand-dialog" role="document" onClick={(e) => e.stopPropagation()}>
              <header className="exec-expand-dialog__head">
                <h2 id={headingId} className="exec-expand-dialog__title">
                  {expandTitle}
                </h2>
                <div className="exec-expand-dialog__actions">
                  <button
                    type="button"
                    className="exec-chart-card__btn"
                    onClick={() => onToggleLabels(!showDataLabels)}
                  >
                    {showDataLabels ? 'Hide data labels' : 'Show data labels'}
                  </button>
                  <button type="button" className="exec-expand-close" onClick={close}>
                    Close
                  </button>
                </div>
              </header>
              {controls ? <div className="exec-expand-dialog__controls">{controls}</div> : null}
              <div className="exec-expand-body">
                <div className="exec-expand-split">
                  <div className="exec-expand-split__chart">
                    <ExecChartCardContext.Provider
                      value={{ expanded: true, inlineVisible: true, plotGeneration }}
                    >
                      <div className="exec-expand-chartframe">{chartFor(true)}</div>
                    </ExecChartCardContext.Provider>
                  </div>
                  <div className="exec-expand-split__table">
                    <div className="exec-expand-dialog__table-wrap">{expandContent}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null

  return (
    <article
      className={`exec-chart-card${open ? ' exec-chart-card--expanded' : ''}${chartHidden && !open ? ' exec-chart-card--plot-hidden' : ''}`}
      style={
        {
          '--exec-accent': ['#1c1915', '#2c5648', '#8c7348', '#4d6b5e'][accent % 4],
        } as React.CSSProperties
      }
    >
      <header className="exec-chart-card__head">
        <div>
          {title ? <h3 className="exec-chart-card__title">{title}</h3> : null}
          <p className="exec-chart-card__insight">{insight}</p>
        </div>
        <div className="exec-chart-card__actions">
          <button
            type="button"
            className="exec-chart-card__btn"
            onClick={() => {
              if (chartHidden) revealChart()
              else setChartHidden(true)
            }}
            aria-expanded={!chartHidden}
          >
            {chartHidden ? 'Show chart' : 'Hide chart'}
          </button>
          <button
            type="button"
            className="exec-chart-card__btn"
            onClick={() => onToggleLabels(!showDataLabels)}
          >
            {showDataLabels ? 'Hide data labels' : 'Show data labels'}
          </button>
          <button type="button" className="exec-chart-card__btn" onClick={() => setOpen(true)}>
            Expand
          </button>
        </div>
      </header>
      {controls ? <div className="exec-chart-card__controls">{controls}</div> : null}
      <div className={`exec-chart-card__plot${open ? ' exec-chart-card__plot--overlay-open' : ''}`}>
        {open ? (
          <div className="exec-chart-placeholder exec-chart-placeholder--overlay">
            <span className="exec-chart-placeholder__hint">Chart expanded — click Close to return</span>
          </div>
        ) : null}
        {chartHidden && !open ? (
          <div className="exec-chart-placeholder exec-chart-placeholder--collapsed">
            <span className="exec-chart-placeholder__hint">Chart hidden</span>
            <button type="button" className="exec-chart-card__btn mt-2" onClick={revealChart}>
              Show chart
            </button>
          </div>
        ) : null}
        <div
          className={[
            'exec-chart-card__plot-live',
            open ? 'exec-chart-card__plot-live--backstage' : '',
            chartHidden && !open ? 'exec-chart-card__plot-live--user-hidden' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-hidden={chartHidden && !open}
        >
          <ExecChartCardContext.Provider value={inlineContext}>
            {chartFor(false)}
          </ExecChartCardContext.Provider>
        </div>
      </div>
      {overlay}
    </article>
  )
}
