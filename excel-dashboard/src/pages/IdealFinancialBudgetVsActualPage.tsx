import { CommitVsActualsSummary } from '../components/executive/CommitVsActualsSummary'
import { useIdealFinancial } from '../context/IdealFinancialContext'

export function IdealFinancialBudgetVsActualPage() {
  const { filteredRows, projectionWow, client, periodLabel } = useIdealFinancial()

  return (
    <>
      <p className="mb-4 text-sm text-slate-600">
        <strong>Budget vs Actual</strong> — week-on-week and client variance for{' '}
        <strong>{periodLabel}</strong>. Same charts and KPIs as Commit vs Actuals, with budget as the
        variance baseline.
      </p>
      <CommitVsActualsSummary
        rows={filteredRows}
        projectionWow={projectionWow}
        client={client}
        preferDataset="commit_vs_actuals"
        summaryLabel="Budget vs Actual"
        layout="budget"
      />
    </>
  )
}
