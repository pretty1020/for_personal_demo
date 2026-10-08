import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { CapacitySignInForm } from '../components/auth/CapacitySignInForm'
import { CompanyHierarchyPanel } from '../components/executive/CompanyHierarchyPanel'
import { useDemoSession } from '../context/DemoSessionContext'
import { usePlanner } from '../context/PlannerContext'
import { buildCompanyHierarchy } from '../planner/companyHierarchy'
import { normalizeProjectCode } from '../planner/planIdentity'

export function DemoAccessPage() {
  const navigate = useNavigate()
  const { authenticated, user, canCreatePlans, canManageUsers, canViewDbeLeakage } = useDemoSession()
  const {
    scenarios,
    selectScenario,
    publishScenarioToCapacity,
    deleteScenario,
  } = usePlanner()

  const visibleScenarios = useMemo(() => scenarios.filter((scenario) => !scenario.isBaseline), [scenarios])
  const hierarchy = useMemo(() => buildCompanyHierarchy(visibleScenarios), [visibleScenarios])

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
    navigate(`/capacity-plan?scope=${encodeURIComponent(`combined:${clientName}`)}`)
  }

  const openCombinedProjectCode = (projectCode: string) => {
    navigate(
      `/capacity-plan?scope=${encodeURIComponent(`combined-project:${normalizeProjectCode(projectCode)}`)}`,
    )
  }

  if (!authenticated) {
    return <CapacitySignInForm />
  }

  return (
    <div className="hub">
      <header className="hub__top">
        <div>
          <p className="hub__hello">Hello, {user?.name}</p>
          <h1 className="hub__title">Where do you want to start?</h1>
        </div>
        {canCreatePlans ? (
          <button type="button" className="hub__new" onClick={() => navigate('/setup')}>
            Add client &amp; LOB
          </button>
        ) : null}
      </header>

      <div className="hub__paths">
        <button type="button" className="hub__path hub__path--overall" onClick={() => navigate('/summary')}>
          <span className="hub__path-kicker">Portfolio</span>
          <strong>Summary view</strong>
          <span className="hub__path-copy">Combined Staffing Plan with Client, Project Code, Location, and LOB filters.</span>
        </button>
        <button type="button" className="hub__path hub__path--plan" onClick={() => navigate('/capacity-plan')}>
          <span className="hub__path-kicker">Weekly staffing</span>
          <strong>Open Staffing Plan</strong>
          <span className="hub__path-copy">Type into the grid. Edit week by week.</span>
        </button>
        {canViewDbeLeakage ? (
          <button type="button" className="hub__path hub__path--dbe" onClick={() => navigate('/dbe')}>
            <span className="hub__path-kicker">Billing estimate</span>
            <strong>DBE</strong>
            <span className="hub__path-copy">Client, LOB, rate, monthly FTE, network days, and projected revenue.</span>
          </button>
        ) : null}
        {canViewDbeLeakage ? (
          <button type="button" className="hub__path hub__path--leakage" onClick={() => navigate('/leakage')}>
            <span className="hub__path-kicker">Staffing × DBE</span>
            <strong>Leakage</strong>
            <span className="hub__path-copy">FTE gaps, understaff revenue leakage, and charts vs DBE.</span>
          </button>
        ) : null}
        <button type="button" className="hub__path hub__path--settings" onClick={() => navigate('/plan-settings')}>
          <span className="hub__path-kicker">Setup</span>
          <strong>Plan settings</strong>
          <span className="hub__path-copy">Location, drivers, training, shrinkage, uploads.</span>
        </button>
        {canManageUsers ? (
          <button type="button" className="hub__path hub__path--users" onClick={() => navigate('/users')}>
            <span className="hub__path-kicker">Admin</span>
            <strong>User management</strong>
            <span className="hub__path-copy">Admin, Manager+, planner, and Analyst access.</span>
          </button>
        ) : null}
      </div>

      <section className="hub__clients">
        <div className="hub__clients-head">
          <h2>Your clients</h2>
          <p>{visibleScenarios.length ? 'Pick a team to open its plan.' : 'No clients yet — add one to begin.'}</p>
        </div>
        <CompanyHierarchyPanel
          hierarchy={hierarchy}
          onOpenLob={openScenario}
          onOpenCombined={openCombined}
          onOpenCombinedProjectCode={openCombinedProjectCode}
          onAddLob={
            canCreatePlans
              ? (clientId, clientName) => {
                  const params = new URLSearchParams()
                  if (clientId) params.set('clientId', clientId)
                  if (clientName) params.set('clientName', clientName)
                  navigate(`/setup?${params.toString()}`)
                }
              : undefined
          }
          onAddClient={canCreatePlans ? () => navigate('/setup') : undefined}
          onExecutiveSummary={() => navigate('/summary')}
          financialLabel="Summary view"
          onDeleteLob={canCreatePlans ? removeScenario : undefined}
          emptyMessage={
            canCreatePlans
              ? 'Nothing here yet. Use Add client & LOB to set up Week 1.'
              : 'No clients yet. Ask an Admin or Capacity planner to add one.'
          }
        />
      </section>
    </div>
  )
}
