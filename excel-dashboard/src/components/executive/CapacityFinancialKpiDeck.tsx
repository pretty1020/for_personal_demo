import { useCapacityFinancial } from '../../context/CapacityFinancialContext'
import { formatCompact } from './execChartFormat'

function KpiCard({
  label,
  value,
  variant = 'default',
}: {
  label: string
  value: string
  variant?: 'default' | 'planned' | 'actual' | 'margin' | 'cost'
}) {
  return (
    <div
      className={`exec-kpi-tile exec-kpi-tile--hero exec-kpi-tile--financial${
        variant === 'planned'
          ? ' exec-kpi-tile--planned'
          : variant === 'actual'
            ? ' exec-kpi-tile--actual'
            : variant === 'margin'
              ? ' exec-kpi-tile--margin'
              : variant === 'cost'
                ? ' exec-kpi-tile--cost'
                : ''
      }`}
    >
      <span className="exec-kpi-tile__label">{label}</span>
      <span className="exec-kpi-tile__value">{value}</span>
    </div>
  )
}

function formatActualCurrency(value: number, hasActualWeeks: boolean): string {
  if (!hasActualWeeks) return '—'
  return formatCompact(value, true)
}

function unitKpiLabel(prefix: 'Revenue' | 'Cost', unitLabel: string): string {
  if (unitLabel === 'FTE-week') return `${prefix} / FTE-week`
  if (unitLabel === 'transaction') return `${prefix} / transaction`
  return `${prefix} / hour`
}

export function CapacityFinancialKpiDeck() {
  const model = useCapacityFinancial()
  const hasActualWeeks = model.weeksWithActual > 0

  if (!model.hasScope) {
    return (
      <p className="saas-muted m-0 text-sm">
        Open Capacity, pick a client or team, and your revenue and cost numbers will appear here.
      </p>
    )
  }

  const fmtPct = (value: number | null) => (value != null ? `${value.toFixed(1)}%` : '—')

  return (
    <div className="ideal-fin-kpi-stack">
      <div className="exec-kpi-grid exec-kpi-grid--financial-deck exec-kpi-grid--financial-primary">
        <KpiCard label="Projected revenue" value={formatCompact(model.projectedRevenue, true)} variant="planned" />
        <KpiCard
          label="Actual revenue"
          value={formatActualCurrency(model.actualRevenue, hasActualWeeks)}
          variant="actual"
        />
        <KpiCard label="Projected cost" value={formatCompact(model.projectedCost, true)} variant="cost" />
        <KpiCard
          label="Actual cost"
          value={formatActualCurrency(model.actualCost, hasActualWeeks)}
          variant="cost"
        />
        <KpiCard label="Projected margin" value={formatCompact(model.projectedMargin, true)} variant="margin" />
        <KpiCard
          label="Actual margin"
          value={formatActualCurrency(model.actualMargin, hasActualWeeks)}
          variant="margin"
        />
        <KpiCard label="Margin % (projected)" value={fmtPct(model.projectedGmPct)} variant="margin" />
        <KpiCard label="Margin % (actual)" value={hasActualWeeks ? fmtPct(model.actualGmPct) : '—'} variant="margin" />
      </div>
      <div className="exec-kpi-grid exec-kpi-grid--financial-deck exec-kpi-grid--financial-secondary">
        <KpiCard label={unitKpiLabel('Revenue', model.unitLabel)} value={formatCompact(model.revPerUnit, true)} />
        <KpiCard label={unitKpiLabel('Cost', model.unitLabel)} value={formatCompact(model.costPerUnit, true)} />
        <KpiCard label="Salary & benefits" value={formatCompact(model.salaryCost, true)} />
        <KpiCard label="Training cost" value={formatCompact(model.trainingCost, true)} />
        <KpiCard label="OPEX" value={formatCompact(model.opex, true)} />
        <KpiCard label="Total cost" value={formatCompact(model.totalCost, true)} variant="cost" />
      </div>
    </div>
  )
}
