import type { ChartDraft } from '../types/dashboard'
import type { SheetSnapshot } from '../types/dashboard'
import { ChartVisualization } from './ChartVisualization'

interface DashboardCanvasProps {
  charts: ChartDraft[]
  snapshots: Record<string, SheetSnapshot>
  onRemove: (id: string) => void
  onClear: () => void
}

export function DashboardCanvas(props: DashboardCanvasProps) {
  const { charts, snapshots, onRemove, onClear } = props

  return (
    <section className="card card--dashboard" aria-label="Dashboard canvas">
      <div className="card-header">
        <div>
          <h2 className="card-title">Dashboard canvas</h2>
          <p className="card-desc">
            Stack multiple charts. Each tile remembers the sheet it was built from.
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary"
          onClick={onClear}
          disabled={charts.length === 0}
        >
          Clear all
        </button>
      </div>

      {charts.length === 0 ? (
        <div className="empty-canvas">
          <p className="empty-title">Your canvas is ready</p>
          <p className="muted">
            Configure a chart in the builder, then choose <strong>Add to dashboard</strong>. Mix
            bar, line, pie, and scatter plots to tell the full story.
          </p>
        </div>
      ) : (
        <div className="dashboard-grid">
          {charts.map((chart) => {
            const snap = snapshots[chart.sheetName]
            return (
              <article key={chart.id} className="dash-tile">
                <header className="dash-tile-head">
                  <div>
                    <p className="dash-tile-title">{chart.title || 'Untitled chart'}</p>
                    <p className="dash-tile-meta">
                      {chart.chartType.toUpperCase()} · Sheet: {chart.sheetName}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Remove ${chart.title}`}
                    onClick={() => onRemove(chart.id)}
                  >
                    ✕
                  </button>
                </header>
                <div className="dash-tile-body">
                  {snap ? (
                    <ChartVisualization snapshot={snap} draft={chart} height={300} />
                  ) : (
                    <div className="chart-fallback">
                      <p className="muted">
                        This chart references sheet “{chart.sheetName}”, which is not loaded.
                        Re-open that sheet once to cache it locally.
                      </p>
                    </div>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
