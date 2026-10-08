import type { Aggregation, ChartDraftState, ChartKind, ColumnFilters } from '../types/dashboard'
import type { SheetSnapshot } from '../types/dashboard'
import { pickScatterDefaults, pickCategoricalDefaults } from '../utils/chartDefaults'
import { ChartVisualization } from './ChartVisualization'

const CHART_TYPES: { id: ChartKind; label: string }[] = [
  { id: 'bar', label: 'Bar' },
  { id: 'line', label: 'Line' },
  { id: 'area', label: 'Area' },
  { id: 'pie', label: 'Pie' },
  { id: 'donut', label: 'Donut' },
  { id: 'scatter', label: 'Scatter' },
  { id: 'bubble', label: 'Bubble' },
]

const AGGS: { id: Aggregation; label: string }[] = [
  { id: 'sum', label: 'Sum' },
  { id: 'average', label: 'Average' },
  { id: 'count', label: 'Count' },
  { id: 'min', label: 'Min' },
  { id: 'max', label: 'Max' },
]

interface ChartBuilderPanelProps {
  snapshot: SheetSnapshot | null
  draft: ChartDraftState
  onDraftChange: (next: ChartDraftState) => void
  onAddToDashboard: () => void
  onResetDraft: () => void
  addDisabled?: boolean
}

export function ChartBuilderPanel(props: ChartBuilderPanelProps & { externalFilters?: ColumnFilters }) {
  const {
    snapshot,
    draft,
    onDraftChange,
    onAddToDashboard,
    onResetDraft,
    addDisabled,
    externalFilters,
  } = props

  const scatterLike = draft.chartType === 'scatter' || draft.chartType === 'bubble'

  const xCandidates = snapshot
    ? scatterLike
      ? snapshot.columns.filter((c) => c.type === 'number')
      : snapshot.columns.filter((c) => c.type !== 'number')
    : []

  const yCandidates = snapshot ? snapshot.columns.filter((c) => c.type === 'number') : []

  const catCandidates = snapshot
    ? snapshot.columns.filter((c) => c.type !== 'number')
    : []

  const sizeCandidates = snapshot ? snapshot.columns.filter((c) => c.type === 'number') : []

  const filtersDisabled = !snapshot || snapshot.rows.length === 0

  const changeType = (ct: ChartKind) => {
    if (!snapshot) {
      onDraftChange({ ...draft, chartType: ct })
      return
    }

    if (ct === 'scatter' || ct === 'bubble') {
      const picked = pickScatterDefaults(snapshot)
      onDraftChange({
        ...draft,
        chartType: ct,
        xColumn: picked.x,
        yColumn: picked.y,
        sizeColumn: ct === 'bubble' ? picked.size : '',
        categoryColumn: '',
      })
      return
    }

    const picked = pickCategoricalDefaults(snapshot)
    onDraftChange({
      ...draft,
      chartType: ct,
      xColumn: picked.x,
      yColumn: picked.y,
      sizeColumn: '',
    })
  }

  const setFilter = (key: string, value: string) => {
    const next = { ...draft.filters } as ColumnFilters
    if (!value.trim()) delete next[key]
    else next[key] = value
    onDraftChange({ ...draft, filters: next })
  }

  return (
    <section className="card card--builder" aria-label="Chart builder">
      <div className="card-header">
        <div>
          <h2 className="card-title">Chart builder</h2>
          <p className="card-desc">
            Choose axes, aggregation, and optional grouping. Filters apply to this sheet only.
          </p>
        </div>
        <div className="builder-actions">
          <button type="button" className="btn-secondary" onClick={onResetDraft}>
            Reset builder
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={onAddToDashboard}
            disabled={
              !snapshot ||
              snapshot.columns.length === 0 ||
              snapshot.rows.length === 0 ||
              Boolean(addDisabled)
            }
          >
            Add to dashboard
          </button>
        </div>
      </div>

      <div className="builder-grid">
        <div className="builder-controls">
          <label className="field">
            <span className="field-label">Chart title</span>
            <input
              className="input"
              value={draft.title}
              onChange={(e) => onDraftChange({ ...draft, title: e.target.value })}
              placeholder="e.g. Revenue by region"
            />
          </label>
          <div className="builder-mini-actions">
            <button
              type="button"
              className="btn-ghost btn-mini"
              onClick={() =>
                onDraftChange({ ...draft, showDataLabels: !draft.showDataLabels })
              }
            >
              {draft.showDataLabels ? 'Hide data labels' : 'Show data labels'}
            </button>
          </div>

          <label className="check-row builder-chart-opt">
            <input
              type="checkbox"
              checked={draft.includePivotTotalRows ?? false}
              onChange={(e) =>
                onDraftChange({ ...draft, includePivotTotalRows: e.target.checked })
              }
            />
            <span>
              Include pivot Total / Grand Total rows in chart (off by default — charts use detail
              rows only)
            </span>
          </label>

          <label className="field">
            <span className="field-label">Chart type</span>
            <select
              className="select"
              value={draft.chartType}
              onChange={(e) => changeType(e.target.value as ChartKind)}
              disabled={!snapshot}
            >
              {CHART_TYPES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>

          <div className="control-row">
            <label className="field">
              <span className="field-label">
                {scatterLike ? 'X metric (numeric)' : 'X axis (text / date)'}
              </span>
              <select
                className="select"
                value={draft.xColumn}
                onChange={(e) => onDraftChange({ ...draft, xColumn: e.target.value })}
                disabled={!snapshot}
              >
                <option value="">Select column…</option>
                {xCandidates.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.header} ({c.type})
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field-label">Y metric (numeric)</span>
              <select
                className="select"
                value={draft.yColumn}
                onChange={(e) => onDraftChange({ ...draft, yColumn: e.target.value })}
                disabled={!snapshot}
              >
                <option value="">Select column…</option>
                {yCandidates.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.header}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {!scatterLike ? (
            <div className="control-row">
              <label className="field">
                <span className="field-label">Group / category (optional)</span>
                <select
                  className="select"
                  value={draft.categoryColumn}
                  onChange={(e) => onDraftChange({ ...draft, categoryColumn: e.target.value })}
                  disabled={!snapshot}
                >
                  <option value="">None</option>
                  {catCandidates.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.header}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span className="field-label">Aggregation</span>
                <select
                  className="select"
                  value={draft.aggregation}
                  onChange={(e) =>
                    onDraftChange({ ...draft, aggregation: e.target.value as Aggregation })
                  }
                  disabled={!snapshot}
                >
                  {AGGS.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : (
            <div className="control-row">
              {draft.chartType === 'bubble' ? (
                <label className="field">
                  <span className="field-label">Bubble size (numeric)</span>
                  <select
                    className="select"
                    value={draft.sizeColumn}
                    onChange={(e) => onDraftChange({ ...draft, sizeColumn: e.target.value })}
                    disabled={!snapshot}
                  >
                    <option value="">Auto</option>
                    {sizeCandidates.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.header}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="field">
                <span className="field-label">Aggregation</span>
                <select className="select" value={draft.aggregation} disabled>
                  {AGGS.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <div className="filters-card">
            <div className="filters-head">
              <p className="filters-title">Column filters</p>
              <p className="filters-hint">Matches cell text per column (case-insensitive).</p>
            </div>
            <div className="filters-grid">
              {snapshot
                ? snapshot.columns.map((c) => (
                    <label key={c.key} className="field field--compact">
                      <span className="field-label-muted">{c.header}</span>
                      <input
                        className="input"
                        disabled={filtersDisabled}
                        value={draft.filters[c.key] ?? ''}
                        placeholder="Contains…"
                        onChange={(e) => setFilter(c.key, e.target.value)}
                      />
                    </label>
                  ))
                : null}
            </div>
          </div>
        </div>

        <div className="builder-preview">
          {!snapshot ? (
            <div className="chart-fallback">
              <p className="chart-fallback-title">Live preview</p>
              <p className="muted">Upload a workbook and pick a sheet to preview a chart.</p>
            </div>
          ) : snapshot.columns.length === 0 || snapshot.rows.length === 0 ? (
            <div className="chart-fallback">
              <p className="chart-fallback-title">Live preview</p>
              <p className="muted">This sheet looks empty — try another tab or add data.</p>
            </div>
          ) : (
            <ChartVisualization
              snapshot={snapshot}
              draft={draft}
              externalFilters={externalFilters}
              title="Live preview"
            />
          )}
        </div>
      </div>
    </section>
  )
}
