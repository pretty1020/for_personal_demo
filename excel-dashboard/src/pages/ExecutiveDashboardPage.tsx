import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CompanyHierarchyPanel } from '../components/executive/CompanyHierarchyPanel'
import { ExecutivePeriodFilter } from '../components/executive/ExecutivePeriodFilter'
import { ExecutivePortfolioKpiDeck } from '../components/executive/ExecutivePortfolioKpiDeck'
import { IndustryFilterSelect } from '../components/filters/IndustryFilterSelect'
import { useDemoSession } from '../context/DemoSessionContext'
import { usePlanner } from '../context/PlannerContext'
import { useExecutivePortfolioPeriod } from '../hooks/useExecutivePortfolioPeriod'
import { buildCompanyHierarchy } from '../planner/companyHierarchy'
import { resolveClientIndustry } from '../planner/clientRegistry'
import { deriveCapacityRowsForScenario } from '../planner/capacityLookup'
import {
  buildClientPortfolioSummaries,
  buildExecutivePortfolioTotals,
} from '../planner/executivePortfolioTotals'
import { fmtNum, fmtPct } from '../planner/format'

export function ExecutiveDashboardPage() {
  const navigate = useNavigate()
  const { canCreatePlans } = useDemoSession()
  const {
    scenarios,
    getScenarioLedger,
    getScenarioForecast,
    getScenarioRoster,
    getScenarioCapacityPlanOverrides,
    saveAsCapacityPlanView,
    selectScenario,
  } = usePlanner()
  const [industryFilter, setIndustryFilter] = useState('')
  const visibleScenarios = useMemo(() => scenarios.filter((scenario) => !scenario.isBaseline), [scenarios])
  const filteredScenarios = useMemo(() => {
    if (!industryFilter) return visibleScenarios
    return visibleScenarios.filter((scenario) => {
      const industry =
        resolveClientIndustry(scenario.plan.clientId) || resolveClientIndustry(scenario.plan.client)
      return industry.toLowerCase() === industryFilter.toLowerCase()
    })
  }, [industryFilter, visibleScenarios])
  const hierarchy = useMemo(() => buildCompanyHierarchy(filteredScenarios), [filteredScenarios])

  const deps = useMemo(
    () => ({
      getScenarioLedger,
      getScenarioForecast,
      getScenarioCapacityPlanOverrides,
      getScenarioRoster,
    }),
    [getScenarioCapacityPlanOverrides, getScenarioForecast, getScenarioLedger, getScenarioRoster],
  )

  const portfolioCapacityRows = useMemo(
    () =>
      filteredScenarios.flatMap((scenario) =>
        deriveCapacityRowsForScenario(
          getScenarioLedger(scenario.id),
          scenario,
          getScenarioForecast(scenario.id, 52),
          getScenarioCapacityPlanOverrides(scenario.id),
        ),
      ),
    [filteredScenarios, getScenarioCapacityPlanOverrides, getScenarioForecast, getScenarioLedger],
  )

  const period = useExecutivePortfolioPeriod(portfolioCapacityRows)

  const executiveTotals = useMemo(
    () => buildExecutivePortfolioTotals(filteredScenarios, deps, period.weekStart, period.weekEnd),
    [deps, filteredScenarios, period.weekEnd, period.weekStart],
  )
  const clientSummaries = useMemo(
    () => buildClientPortfolioSummaries(filteredScenarios, deps, period.weekStart, period.weekEnd),
    [deps, filteredScenarios, period.weekEnd, period.weekStart],
  )

  const openLob = (scenarioId: string) => {
    selectScenario(scenarioId)
    saveAsCapacityPlanView(scenarioId)
    navigate('/capacity-plan')
  }

  const openCombined = (clientName: string) => {
    navigate(`/capacity-plan?scope=combined:${encodeURIComponent(clientName)}`)
  }

  return (
    <div className="portfolio-exec">
      <section className="portfolio-exec__hero">
        <div className="portfolio-exec__hero-copy">
          <h1 className="portfolio-exec__title">Executive Summary</h1>
          <p className="portfolio-exec__lead m-0">
            {executiveTotals.clientCount} client{executiveTotals.clientCount === 1 ? '' : 's'} ·{' '}
            {executiveTotals.scenarioCount} LOB{executiveTotals.scenarioCount === 1 ? '' : 's'}
            {period.weekStart && period.weekEnd ? ` · ${period.rangeLabel}` : ''}
          </p>
        </div>
        <div className="portfolio-exec__hero-actions">
          <button type="button" className="saas-btn portfolio-exec__btn-home" onClick={() => navigate('/workspace')}>
            Back to portfolio
          </button>
          <button
            type="button"
            className="saas-btn saas-btn--secondary portfolio-exec__btn-setup"
            onClick={() => navigate('/setup')}
          >
            New client
          </button>
        </div>
      </section>

      <ExecutivePeriodFilter
        periodKind={period.periodKind}
        onPeriodKindChange={period.setPeriodKind}
        calendarYear={period.calendarYear}
        yearOptions={period.yearOptions}
        onCalendarYearChange={period.setCalendarYear}
        month={period.month}
        monthOptions={period.monthOptions}
        onMonthChange={period.setMonth}
        quarter={period.quarter}
        onQuarterChange={period.setQuarter}
        weekStart={period.weekStart}
        weekEnd={period.weekEnd}
        weekOptions={period.weekOptions}
        onWeekStartChange={period.setWeekStart}
        onWeekEndChange={period.setWeekEnd}
        rangeLabel={period.rangeLabel}
      />

      <div className="portfolio-exec__filters">
        <IndustryFilterSelect
          value={industryFilter}
          onChange={setIndustryFilter}
          className="saas-field portfolio-exec__filter-field"
          selectClassName="cap-field__input"
        />
      </div>

      <section className="portfolio-exec__highlights" aria-label="Portfolio highlights">
        <article className="portfolio-exec__highlight">
          <span className="portfolio-exec__highlight-label">Clients / LOBs</span>
          <strong className="portfolio-exec__highlight-value">
            {executiveTotals.clientCount} / {executiveTotals.scenarioCount}
          </strong>
        </article>
        <article className="portfolio-exec__highlight">
          <span className="portfolio-exec__highlight-label">Staffing %</span>
          <strong className="portfolio-exec__highlight-value">
            {executiveTotals.staffingPct != null ? fmtPct(executiveTotals.staffingPct) : '—'}
          </strong>
        </article>
        <article className="portfolio-exec__highlight">
          <span className="portfolio-exec__highlight-label">Req / Prod FTE</span>
          <strong className="portfolio-exec__highlight-value">
            {fmtNum(executiveTotals.requiredFte, 1)} / {fmtNum(executiveTotals.productionFte, 1)}
          </strong>
        </article>
        <article className="portfolio-exec__highlight">
          <span className="portfolio-exec__highlight-label">Margin</span>
          <strong className="portfolio-exec__highlight-value">
            ${fmtNum(executiveTotals.grossMargin, 0)}
            {executiveTotals.grossMarginPct != null ? ` (${fmtPct(executiveTotals.grossMarginPct)})` : ''}
          </strong>
        </article>
      </section>

      <ExecutivePortfolioKpiDeck totals={executiveTotals} />

      <CompanyHierarchyPanel
        hierarchy={hierarchy}
        clientSummaries={clientSummaries}
        emptyMessage={
          industryFilter
            ? `No clients in ${industryFilter}. Clear the industry filter or add a client in that sector.`
            : undefined
        }
        onOpenLob={openLob}
        onOpenCombined={openCombined}
        onAddLob={
          canCreatePlans
            ? (clientId) => navigate(`/setup?clientId=${encodeURIComponent(clientId)}`)
            : undefined
        }
      />
    </div>
  )
}
