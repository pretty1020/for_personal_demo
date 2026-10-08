import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { CompanyHierarchyPanel } from '../components/executive/CompanyHierarchyPanel'
import { ExecutivePortfolioKpiDeck } from '../components/executive/ExecutivePortfolioKpiDeck'
import { IndustryFilterSelect } from '../components/filters/IndustryFilterSelect'
import { scrollToUserGuide, UserGuideSection } from '../components/home/UserGuideSection'
import { useDemoSession } from '../context/DemoSessionContext'
import { usePlanner } from '../context/PlannerContext'
import { buildCompanyHierarchy } from '../planner/companyHierarchy'
import { resolveClientIndustry } from '../planner/clientRegistry'
import {
  buildClientPortfolioSummaries,
  buildExecutivePortfolioTotals,
} from '../planner/executivePortfolioTotals'

const FEATURE_JUMPS = [
  { id: 'landing-forecasting', label: 'Forecasting' },
  { id: 'landing-scheduling', label: 'Scheduling' },
  { id: 'landing-financial', label: 'Financial · Leakages' },
  { id: 'landing-scenarios', label: 'Scenarios' },
  { id: 'landing-assistant', label: 'AI Assistant' },
] as const

const SCHEDULING_POINTS = [
  'Pulls required FTE and volume directly from your capacity plan',
  'Builds optimized shift coverage against forecasted demand',
  'Keeps schedules aligned as capacity assumptions change',
] as const

const FORECAST_POINTS = [
  'Project volume, AHT, and attrition from historical actuals',
  'Compare models and lock the forecast that feeds capacity',
  'Refresh plans when demand shifts — schedules stay in sync',
] as const

const FINANCIAL_POINTS = [
  'Revenue, cost, and margin on the same capacity assumptions',
  'Surface leakages from understaffing, overstaffing, non-billable shrinkages, AHT, attrition, and volume',
  'Trace dollars lost back to staffing drivers you can fix',
] as const

const SCENARIO_POINTS = [
  'Create unlimited what-if plans without overwriting the live baseline',
  'Compare staffing, cost, and service outcomes side by side',
  'Publish the winning scenario straight into capacity and scheduling',
] as const

const ASSISTANT_POINTS = [
  'Ask about staffing gaps, forecast models, leakage, and scenario trade-offs',
  'Answers stay on the plan, roster, and financials in your workspace',
  'Open it from any signed-in screen without leaving the page you are on',
] as const

const ASSISTANT_PROMPTS = [
  { label: 'Staffing gap', detail: 'Where are we short this week?' },
  { label: 'Forecast model', detail: 'Which model is locked, and why?' },
  { label: 'Leakage', detail: 'What is driving lost revenue?' },
] as const

const FORECAST_MODELS = [
  {
    id: 'volume',
    label: 'Volume',
    metric: '+8.4%',
    detail: 'Contact volume vs last 8 weeks',
    bars: [42, 48, 45, 58, 62, 71, 68, 76],
  },
  {
    id: 'aht',
    label: 'AHT',
    metric: '312s',
    detail: 'Handle time trending stable',
    bars: [58, 55, 54, 52, 51, 50, 49, 48],
  },
  {
    id: 'attrition',
    label: 'Attrition',
    metric: '2.1%',
    detail: 'Weekly attrition outlook',
    bars: [28, 32, 30, 35, 33, 31, 29, 27],
  },
] as const

const LEAKAGE_DRIVERS = [
  { id: 'under', label: 'Understaffing', amount: '$18k', share: 22, tone: 'warn' },
  { id: 'over', label: 'Overstaffing', amount: '$8k', share: 10, tone: 'mid' },
  { id: 'shrink', label: 'Non-billable shrink', amount: '$14k', share: 17, tone: 'warn' },
  { id: 'aht', label: 'AHT', amount: '$12k', share: 15, tone: 'mid' },
  { id: 'attr', label: 'Attrition', amount: '$9k', share: 11, tone: 'mid' },
  { id: 'vol', label: 'Volume', amount: '$20k', share: 25, tone: 'soft' },
] as const

const SUITE_FEATURES = [
  {
    title: 'Capacity plan matrix',
    copy: 'Weekly headcount, hours, volume, and drivers — editable and always in sync.',
  },
  {
    title: 'Multi-client portfolio',
    copy: 'Clients, LOBs, and executive roll-ups managed from one workspace.',
  },
  {
    title: 'Revenue projections',
    copy: 'Monthly sheets from FTE, productive hours, and bill rates tied to your plans.',
  },
  {
    title: 'AI Assistant',
    copy: 'Ask about staffing gaps, forecast models, leakages, and scenario trade-offs.',
  },
] as const

const LEDGER_STEPS = [
  { index: '01', title: 'Forecast', detail: 'Volume, AHT, and attrition from history' },
  { index: '02', title: 'Capacity', detail: 'Headcount and hours fed by that forecast' },
  { index: '03', title: 'Schedule', detail: 'Shift coverage tied to the capacity plan' },
  { index: '04', title: 'Protect margin', detail: 'Revenue, cost, and every leakage' },
  { index: '05', title: 'AI Assistant', detail: 'Ask the plan about gaps, models, and leakage' },
] as const

function ForecastPreview({
  activeId,
  onSelect,
}: {
  activeId: (typeof FORECAST_MODELS)[number]['id']
  onSelect: (id: (typeof FORECAST_MODELS)[number]['id']) => void
}) {
  const active = FORECAST_MODELS.find((model) => model.id === activeId) ?? FORECAST_MODELS[0]
  return (
    <div className="landing__forecast-card">
      <div className="landing__forecast-tabs" role="tablist" aria-label="Forecast metrics">
        {FORECAST_MODELS.map((model) => (
          <button
            key={model.id}
            type="button"
            role="tab"
            aria-selected={model.id === active.id}
            className={`landing__forecast-tab${model.id === active.id ? ' is-active' : ''}`}
            onClick={() => onSelect(model.id)}
          >
            {model.label}
          </button>
        ))}
      </div>
      <div className="landing__forecast-metric">
        <strong>{active.metric}</strong>
        <span>{active.detail}</span>
      </div>
      <div className="landing__forecast-chart" aria-hidden>
        {active.bars.map((value, index) => (
          <span
            key={`${active.id}-${index}`}
            style={{ '--bar': `${value}%`, animationDelay: `${index * 0.05}s` } as CSSProperties}
          />
        ))}
      </div>
      <p className="landing__forecast-meta">Interactive preview · feeds capacity &amp; scheduling</p>
    </div>
  )
}

function LeakagePreview({
  activeId,
  onSelect,
}: {
  activeId: (typeof LEAKAGE_DRIVERS)[number]['id']
  onSelect: (id: (typeof LEAKAGE_DRIVERS)[number]['id']) => void
}) {
  const active = LEAKAGE_DRIVERS.find((driver) => driver.id === activeId) ?? LEAKAGE_DRIVERS[0]
  const total = '$140k'
  return (
    <div className="landing__leakage-card">
      <div className="landing__leakage-head">
        <span className="landing__leakage-label">Where revenue is being lost</span>
        <strong className="landing__leakage-total">{total}</strong>
      </div>
      <div className="landing__leakage-stack" role="list">
        {LEAKAGE_DRIVERS.map((driver) => (
          <button
            key={driver.id}
            type="button"
            role="listitem"
            className={`landing__leakage-row landing__leakage-row--${driver.tone}${driver.id === active.id ? ' is-active' : ''}`}
            onClick={() => onSelect(driver.id)}
            onMouseEnter={() => onSelect(driver.id)}
            onFocus={() => onSelect(driver.id)}
          >
            <span className="landing__leakage-name">{driver.label}</span>
            <span className="landing__leakage-bar" aria-hidden>
              <i style={{ width: `${driver.share}%` }} />
            </span>
            <span className="landing__leakage-amt">{driver.amount}</span>
          </button>
        ))}
      </div>
      <p className="landing__leakage-focus">
        Focus: <strong>{active.label}</strong> · {active.amount} of portfolio leakage
      </p>
    </div>
  )
}

export function DemoAccessPage() {
  const navigate = useNavigate()
  const {
    authenticated,
    login,
    user,
    canManageUsers,
    canCreatePlans,
    canViewFinancials,
    canViewExecutiveDashboard,
  } = useDemoSession()
  const {
    scenarios,
    selectScenario,
    publishScenarioToCapacity,
    deleteScenario,
    getScenarioLedger,
    getScenarioForecast,
    getScenarioRoster,
    getScenarioCapacityPlanOverrides,
  } = usePlanner()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [activeJump, setActiveJump] = useState<string>(FEATURE_JUMPS[0].id)
  const [forecastModel, setForecastModel] = useState<(typeof FORECAST_MODELS)[number]['id']>('volume')
  const [leakageDriver, setLeakageDriver] = useState<(typeof LEAKAGE_DRIVERS)[number]['id']>('under')

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
  const portfolioTotals = useMemo(
    () =>
      buildExecutivePortfolioTotals(filteredScenarios, {
        getScenarioLedger,
        getScenarioForecast,
        getScenarioCapacityPlanOverrides,
        getScenarioRoster,
      }),
    [filteredScenarios, getScenarioCapacityPlanOverrides, getScenarioForecast, getScenarioLedger, getScenarioRoster],
  )
  const clientSummaries = useMemo(
    () =>
      buildClientPortfolioSummaries(filteredScenarios, {
        getScenarioLedger,
        getScenarioForecast,
        getScenarioCapacityPlanOverrides,
        getScenarioRoster,
      }),
    [filteredScenarios, getScenarioCapacityPlanOverrides, getScenarioForecast, getScenarioLedger, getScenarioRoster],
  )

  useEffect(() => {
    if (authenticated) return
    const nodes = FEATURE_JUMPS.map((item) => document.getElementById(item.id)).filter(
      (node): node is HTMLElement => Boolean(node),
    )
    if (nodes.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (visible?.target?.id) setActiveJump(visible.target.id)
      },
      { rootMargin: '-28% 0px -48% 0px', threshold: [0.2, 0.45, 0.7] },
    )
    nodes.forEach((node) => observer.observe(node))
    return () => observer.disconnect()
  }, [authenticated])

  const removeScenario = (scenarioId: string, label: string) => {
    if (!window.confirm(`Delete ${label}? This will remove the capacity plan and its client/LOB data.`)) return
    deleteScenario(scenarioId)
  }

  const openScenario = (scenarioId: string) => {
    selectScenario(scenarioId)
    publishScenarioToCapacity(scenarioId)
    navigate('/capacity-plan')
  }

  const openCombined = (clientName: string) => {
    navigate(`/capacity-plan?scope=combined:${encodeURIComponent(clientName)}`)
  }

  if (!authenticated) {
    return (
      <div className="landing">
        <div className="landing__frame">
          <section className="landing__hero">
            <div className="landing__hero-copy">
              <p className="landing__kicker">Capacity planning</p>
              <h1 className="landing__title">
                See demand.
                <br />
                Set capacity.
                <br />
                Staff the week.
                <br />
                Hold margin.
              </h1>
              <p className="landing__lead">
                Demand forecasts feed capacity, optimized schedules follow the plan, and unlimited scenarios sit beside a
                financial view that exposes every leakage.
              </p>
              <ol className="landing__ledger">
                {LEDGER_STEPS.map((step) => (
                  <li key={step.index}>
                    <span>{step.index}</span>
                    <strong>{step.title}</strong>
                    <em>{step.detail}</em>
                  </li>
                ))}
              </ol>
            </div>

            <form
              id="landing-signin"
              className="landing__signin"
              onSubmit={(event) => {
                event.preventDefault()
                void (async () => {
                  setSubmitting(true)
                  try {
                    const ok = await login(email, password)
                    if (!ok) {
                      setError('We could not sign you in. Check your email and password.')
                      return
                    }
                    setError('')
                  } finally {
                    setSubmitting(false)
                  }
                })()
              }}
            >
              <p className="landing__signin-kicker">Account</p>
              <h2 className="landing__signin-title">Sign in</h2>
              <p className="landing__signin-copy">Use the account provided by your administrator.</p>
              <label className="saas-field">
                <span className="saas-field__label">Email</span>
                <input
                  className="cap-field__input"
                  type="email"
                  autoComplete="username"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </label>
              <label className="saas-field">
                <span className="saas-field__label">Password</span>
                <input
                  className="cap-field__input"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </label>
              {error ? <p className="demo-access__error">{error}</p> : null}
              <button type="submit" className="saas-btn landing__signin-btn" disabled={submitting}>
                {submitting ? 'Signing in…' : 'Continue'}
              </button>
            </form>
          </section>

          <nav className="landing__rail" aria-label="Feature highlights">
            {FEATURE_JUMPS.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className={`landing__rail-link${activeJump === item.id ? ' is-active' : ''}`}
                onClick={() => setActiveJump(item.id)}
              >
                {item.label}
              </a>
            ))}
          </nav>

          <section id="landing-forecasting" className="landing__spotlight landing__spotlight--forecast">
            <div className="landing__spotlight-copy">
              <p className="landing__spotlight-eyebrow">Forecasting</p>
              <h2 className="landing__spotlight-title">Demand intelligence that drives the whole plan</h2>
              <p className="landing__spotlight-lead">
                Build trusted volume, AHT, and attrition outlooks from history — then push the selected forecast into
                capacity so schedules and financials stay honest.
              </p>
              <ul className="landing__spotlight-points">
                {FORECAST_POINTS.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </div>
            <div className="landing__spotlight-panel">
              <ForecastPreview activeId={forecastModel} onSelect={setForecastModel} />
            </div>
          </section>

          <section id="landing-scheduling" className="landing__spotlight landing__spotlight--schedule">
            <div className="landing__spotlight-copy">
              <p className="landing__spotlight-eyebrow">Scheduling</p>
              <h2 className="landing__spotlight-title">Optimized schedules, wired to your capacity plan</h2>
              <p className="landing__spotlight-lead">
                Scheduling reads required staffing and demand straight from capacity — then generates coverage that
                tracks forecasted volume, not disconnected spreadsheets.
              </p>
              <ul className="landing__spotlight-points">
                {SCHEDULING_POINTS.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </div>
            <div className="landing__spotlight-panel">
              <div className="landing__schedule-card">
                <span className="landing__schedule-label">Demand → Capacity → Schedule</span>
                <div className="landing__schedule-bars">
                  <span style={{ '--bar': '72%' } as CSSProperties} />
                  <span style={{ '--bar': '88%' } as CSSProperties} />
                  <span style={{ '--bar': '64%' } as CSSProperties} />
                  <span style={{ '--bar': '94%' } as CSSProperties} />
                  <span style={{ '--bar': '78%' } as CSSProperties} />
                </div>
                <p className="landing__schedule-meta">Auto-balanced shifts · service-level aware</p>
              </div>
            </div>
          </section>

          <section id="landing-financial" className="landing__spotlight landing__spotlight--financial">
            <div className="landing__spotlight-panel">
              <LeakagePreview activeId={leakageDriver} onSelect={setLeakageDriver} />
            </div>
            <div className="landing__spotlight-copy">
              <p className="landing__spotlight-eyebrow">Financial dashboard</p>
              <h2 className="landing__spotlight-title">See revenue, margin — and every leakage</h2>
              <p className="landing__spotlight-lead">
                The financial dashboard ties revenue and cost to capacity, then highlights where money leaks: HC gaps,
                shrinkage, AHT, attrition, and volume variance.
              </p>
              <ul className="landing__spotlight-points">
                {FINANCIAL_POINTS.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </div>
          </section>

          <section id="landing-scenarios" className="landing__spotlight landing__spotlight--scenarios">
            <div className="landing__spotlight-copy">
              <p className="landing__spotlight-eyebrow">Planning scenarios</p>
              <h2 className="landing__spotlight-title">Unlimited scenarios. Decide with confidence.</h2>
              <p className="landing__spotlight-lead">
                Model as many planning scenarios as you need — compare outcomes, keep the baseline intact, and promote
                the plan that wins into capacity and scheduling.
              </p>
              <ul className="landing__spotlight-points">
                {SCENARIO_POINTS.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </div>
            <div className="landing__spotlight-panel" aria-hidden>
              <div className="landing__scenario-stack">
                <article className="landing__scenario-chip landing__scenario-chip--a">
                  <strong>Baseline</strong>
                  <span>Live capacity</span>
                </article>
                <article className="landing__scenario-chip landing__scenario-chip--b">
                  <strong>Peak season</strong>
                  <span>+12% demand</span>
                </article>
                <article className="landing__scenario-chip landing__scenario-chip--c">
                  <strong>Attrition stress</strong>
                  <span>What-if HC</span>
                </article>
              </div>
            </div>
          </section>

          <section id="landing-assistant" className="landing__spotlight landing__spotlight--assistant">
            <div className="landing__spotlight-panel" aria-hidden>
              <div className="landing__scenario-stack">
                {ASSISTANT_PROMPTS.map((prompt) => (
                  <article key={prompt.label} className="landing__scenario-chip">
                    <strong>{prompt.label}</strong>
                    <span>{prompt.detail}</span>
                  </article>
                ))}
              </div>
            </div>
            <div className="landing__spotlight-copy">
              <p className="landing__spotlight-eyebrow">AI Assistant</p>
              <h2 className="landing__spotlight-title">Ask the plan. Get an answer from your numbers.</h2>
              <p className="landing__spotlight-lead">
                The assistant sits with the workspace. Ask about headcount, forecast choice, margin, or a scenario, and
                it answers from the plan you already have open.
              </p>
              <ul className="landing__spotlight-points">
                {ASSISTANT_POINTS.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </div>
          </section>

          <section className="landing__suite" aria-label="Platform capabilities">
            <header className="landing__suite-head">
              <h2 className="landing__suite-title">Everything connected</h2>
              <p className="landing__suite-lead">From forecast to financial impact — one continuous planning thread.</p>
            </header>
            <ul className="landing__suite-grid">
              {SUITE_FEATURES.map((feature) => (
                <li key={feature.title} className="landing__suite-item">
                  <strong>{feature.title}</strong>
                  <span>{feature.copy}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    )
  }

  return (
    <div className="portfolio-home">
      <section className="portfolio-home__hero">
        <p className="portfolio-home__eyebrow">Welcome back</p>
        <h1 className="portfolio-home__title">Your capacity portfolio</h1>
        <p className="portfolio-home__lead m-0">
          Hi {user?.name}. Open Telco or Retail to plan capacity, schedules, scenarios, and financials.
        </p>
        <div className="portfolio-home__actions">
          {canCreatePlans ? (
            <button type="button" className="saas-btn portfolio-home__btn-primary" onClick={() => navigate('/setup')}>
              New client
            </button>
          ) : null}
          <button type="button" className="saas-btn saas-btn--secondary" onClick={() => navigate('/forecasting')}>
            Forecasting
          </button>
          <button type="button" className="saas-btn saas-btn--secondary" onClick={() => navigate('/scheduling')}>
            Scheduling
          </button>
          {canViewFinancials ? (
            <button
              type="button"
              className="saas-btn saas-btn--secondary"
              onClick={() => navigate('/financial/overview')}
            >
              Financial · Leakages
            </button>
          ) : null}
          <button type="button" className="saas-btn saas-btn--secondary" onClick={() => navigate('/planning')}>
            Planning scenarios
          </button>
          <button
            type="button"
            className="saas-btn saas-btn--secondary portfolio-home__btn-guide"
            onClick={() => scrollToUserGuide()}
          >
            User guide
          </button>
          {canViewExecutiveDashboard ? (
            <button
              type="button"
              className="saas-btn saas-btn--secondary portfolio-home__btn-exec"
              onClick={() => navigate('/executive')}
            >
              Executive summary
            </button>
          ) : null}
          {canManageUsers ? (
            <button
              type="button"
              className="saas-btn saas-btn--secondary portfolio-home__btn-users"
              onClick={() => navigate('/users')}
            >
              User management
            </button>
          ) : null}
        </div>
      </section>

      {visibleScenarios.length > 0 && canViewFinancials ? (
        <section className="portfolio-home__snapshot saas-card">
          <header className="portfolio-home__snapshot-head">
            <div>
              <h2 className="portfolio-home__snapshot-title m-0">Portfolio snapshot</h2>
              <p className="portfolio-home__snapshot-meta m-0">
                {portfolioTotals.clientCount} client{portfolioTotals.clientCount === 1 ? '' : 's'} ·{' '}
                {portfolioTotals.scenarioCount} LOB{portfolioTotals.scenarioCount === 1 ? '' : 's'}
                {portfolioTotals.weeksPlanned > 0 ? ` · ${portfolioTotals.weeksPlanned} planned weeks` : ''}
                {industryFilter ? ` · ${industryFilter}` : ''}
              </p>
            </div>
            {canViewExecutiveDashboard ? (
              <button type="button" className="portfolio-hierarchy__link" onClick={() => navigate('/executive')}>
                View full executive summary →
              </button>
            ) : null}
          </header>
          <ExecutivePortfolioKpiDeck totals={portfolioTotals} compact />
        </section>
      ) : null}

      <div className="portfolio-home__filters">
        <IndustryFilterSelect
          value={industryFilter}
          onChange={setIndustryFilter}
          className="saas-field portfolio-home__filter-field"
          selectClassName="cap-field__input"
        />
      </div>

      <CompanyHierarchyPanel
        hierarchy={hierarchy}
        clientSummaries={canViewFinancials ? clientSummaries : []}
        emptyMessage={
          industryFilter
            ? `No clients in ${industryFilter}. Clear the industry filter or add a client in that sector.`
            : undefined
        }
        onOpenLob={openScenario}
        onOpenCombined={openCombined}
        onAddLob={
          canCreatePlans
            ? (clientId) => navigate(`/setup?clientId=${encodeURIComponent(clientId)}`)
            : undefined
        }
        onExecutiveSummary={canViewExecutiveDashboard ? () => navigate('/executive') : undefined}
        onDeleteLob={canCreatePlans ? removeScenario : undefined}
      />

      <UserGuideSection />
    </div>
  )
}
