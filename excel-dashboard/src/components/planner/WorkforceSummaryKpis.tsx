import { KpiCard } from './KpiCard'
import type { ExecutiveSummary } from '../../planner/types'
import { fmtCurrency, fmtNum, fmtPct } from '../../planner/format'
import { METRIC_LABELS } from '../../planner/metricLabels'
import { staffingPctTone, summaryHeadcountKpis } from '../../planner/workforceMetrics'

type Props = {
  summary: ExecutiveSummary
  /** When set, shown on production headcount card (e.g. linked scenario name). */
  scenarioHint?: string
  compact?: boolean
  hideFinancial?: boolean
}

export function WorkforceSummaryKpis({ summary, compact, hideFinancial }: Props) {
  const hc = summaryHeadcountKpis(summary)
  const gridClass = compact ? 'exec-kpi-grid exec-kpi-grid--dense' : 'exec-kpi-grid exec-kpi-grid--dense saas-kpi-grid'

  return (
    <section className={gridClass} aria-label="Workforce summary">
      <KpiCard label={METRIC_LABELS.requiredHeadcount} value={fmtNum(hc.requiredHeadcount, 1)} />
      <KpiCard label={METRIC_LABELS.productionHeadcount} value={fmtNum(hc.productionHeadcount, 1)} />
      <KpiCard
        label={METRIC_LABELS.staffingPct}
        value={hc.staffingPct == null ? '—' : fmtPct(hc.staffingPct, 1)}
        tone={staffingPctTone(hc.productionFte, hc.requiredHeadcount)}
      />
      <KpiCard label={METRIC_LABELS.occupancy} value={fmtPct(summary.occupancy)} />
      <KpiCard label={METRIC_LABELS.productivity} value={fmtPct(summary.productivity)} />
      {!hideFinancial ? (
        <>
          <KpiCard label="Revenue projection" value={fmtCurrency(summary.revenueProjection)} />
          <KpiCard label="Cost projection" value={fmtCurrency(summary.costProjection)} />
          <KpiCard label={METRIC_LABELS.grossMargin} value={fmtCurrency(summary.grossMargin)} tone="good" />
          <KpiCard label={METRIC_LABELS.profitability} value={fmtCurrency(summary.profitability)} />
          <KpiCard label={METRIC_LABELS.costLeakage} value={fmtCurrency(summary.totalLeakage)} tone="warn" />
        </>
      ) : null}
      <KpiCard label="Hiring plan" value={fmtNum(summary.hiringTotal, 0)} />
    </section>
  )
}
