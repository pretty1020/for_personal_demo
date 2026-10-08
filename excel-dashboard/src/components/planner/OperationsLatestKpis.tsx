import { KpiCard } from './KpiCard'
import { fmtCurrency, fmtNum, fmtPct } from '../../planner/format'
import { plannerLatestPeriod } from '../../planner/displayKpis'
import { METRIC_LABELS } from '../../planner/metricLabels'
import type { SimulationResult } from '../../planner/types'

/** Latest-period operational metrics — complements WorkforceSummaryKpis on Operations tab. */
export function OperationsLatestKpis({ result }: { result: SimulationResult }) {
  const last = plannerLatestPeriod(result)
  if (!last) return null

  return (
    <section className="exec-kpi-grid exec-kpi-grid--dense" aria-label="Latest period operations">
      <KpiCard label="Forecast volume" value={fmtNum(last.forecastVolume)} />
      <KpiCard label="Productive hours" value={fmtNum(last.productiveHours, 0)} />
      <KpiCard label="Service level" value={fmtPct(last.serviceLevel)} />
      <KpiCard label="Backfill required" value={fmtNum(last.backfillRequired, 0)} />
      <KpiCard label={METRIC_LABELS.revenue} value={fmtCurrency(last.revenue)} />
      <KpiCard label={METRIC_LABELS.costLeakage} value={fmtCurrency(last.leakages.total)} tone="warn" />
    </section>
  )
}
