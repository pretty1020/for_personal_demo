import { useIdealFinancial } from '../context/IdealFinancialContext'
import { useDemoSession } from '../context/DemoSessionContext'
import { FinancialTopDeck } from '../components/executive/FinancialTopDeck'
import { CapacityAlignedFinancialPanel } from '../components/executive/CapacityAlignedFinancialPanel'
import { CapacityFinancialTrendChart } from '../components/executive/CapacityFinancialTrendChart'
import { IdealFinancialDashboardPanel } from '../components/executive/IdealFinancialDashboardPanel'

function FinancialExecutiveContent() {
  const {
    filteredRows,
    allFacts,
    projectionWow,
    trendGranularity,
    setTrendGranularity,
    clientOptions,
    weekOptions,
    weekStart,
    weekEnd,
    client,
    periodLabel,
    dateRangeActive,
  } = useIdealFinancial()

  return (
    <>
      <FinancialTopDeck
        periodLabel={periodLabel}
        dateRangeActive={dateRangeActive}
      />

      <CapacityFinancialTrendChart granularity={trendGranularity} />

      <IdealFinancialDashboardPanel
        rows={filteredRows}
        sourceRows={allFacts}
        projectionWow={projectionWow}
        granularity={trendGranularity}
        onGranularityChange={setTrendGranularity}
        clientOptions={clientOptions}
        weekOptions={weekOptions}
        weekStart={weekStart}
        weekEnd={weekEnd}
        headerClient={client}
        view="overview"
        hideKpis
        chartsCollapsedByDefault={false}
      />

      <CapacityAlignedFinancialPanel variant="table" />
    </>
  )
}

export function IdealFinancialOverview() {
  const { canViewFinancials } = useDemoSession()

  return (
    <div className="ideal-fin-executive">
      {!canViewFinancials ? (
        <section className="cap-executive-access-denied saas-card">
          <h3 className="m-0 text-base font-bold text-slate-900">Access restricted</h3>
          <p className="saas-muted m-0 mt-2 text-sm">
            Financials are limited to Manager and above. Ask your administrator if you need access.
          </p>
        </section>
      ) : (
        <FinancialExecutiveContent />
      )}
    </div>
  )
}
