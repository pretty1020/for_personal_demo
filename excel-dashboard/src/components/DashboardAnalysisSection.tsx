import { useState } from 'react'
import type { ChartDraft, ChartDraftState } from '../types/dashboard'
import type { SheetSnapshot } from '../types/dashboard'
import type { ColumnFilters } from '../types/dashboard'
import { AutoChartsSection } from './AutoChartsSection'
import { AutoInsightsPanel } from './AutoInsightsPanel'
import { ChartBuilderPanel } from './ChartBuilderPanel'
import { DashboardCanvas } from './DashboardCanvas'
import { KpiSection } from './KpiSection'

/** Keeps chart/KPI code in one lazy-loaded chunk (ECharts loads only when this mounts). */
export function DashboardAnalysisSection(props: {
  snapshot: SheetSnapshot
  snapshots: Record<string, SheetSnapshot>
  draft: ChartDraftState
  onDraftChange: (next: ChartDraftState) => void
  onAddToDashboard: () => void
  onResetDraft: () => void
  addDisabled: boolean
  dashCharts: ChartDraft[]
  onRemoveChart: (id: string) => void
  onClearCharts: () => void
  externalFilters?: ColumnFilters
}) {
  const {
    snapshot,
    snapshots,
    draft,
    onDraftChange,
    onAddToDashboard,
    onResetDraft,
    addDisabled,
    dashCharts,
    onRemoveChart,
    onClearCharts,
    externalFilters,
  } = props
  const [showAutoInsights, setShowAutoInsights] = useState(true)
  const [showAutoCharts, setShowAutoCharts] = useState(true)

  return (
    <div className="dashboard-analysis-stack">
      <KpiSection snapshot={snapshot} />
      <div className="analysis-quick-controls">
        <button
          type="button"
          className="btn-ghost btn-mini"
          onClick={() => setShowAutoInsights((v) => !v)}
        >
          {showAutoInsights ? 'Hide Auto insights' : 'Show Auto insights'}
        </button>
        <button
          type="button"
          className="btn-ghost btn-mini"
          onClick={() => setShowAutoCharts((v) => !v)}
        >
          {showAutoCharts ? 'Hide Auto charts' : 'Show Auto charts'}
        </button>
      </div>
      {showAutoInsights ? <AutoInsightsPanel snapshot={snapshot} /> : null}
      {showAutoCharts ? <AutoChartsSection snapshot={snapshot} /> : null}
      <ChartBuilderPanel
        snapshot={snapshot}
        draft={draft}
        onDraftChange={onDraftChange}
        onAddToDashboard={onAddToDashboard}
        onResetDraft={onResetDraft}
        addDisabled={addDisabled}
        externalFilters={externalFilters}
      />
      <DashboardCanvas
        charts={dashCharts}
        snapshots={snapshots}
        onRemove={onRemoveChart}
        onClear={onClearCharts}
      />
    </div>
  )
}
