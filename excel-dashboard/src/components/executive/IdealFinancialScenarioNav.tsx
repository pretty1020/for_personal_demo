import { NavLink } from 'react-router-dom'

const BASE = '/financial'

/** Financial dashboard — Overview | Leakages | Revenue projections */
export function IdealFinancialScenarioNav() {
  return (
    <nav className="saas-tabs ideal-scenario-nav" aria-label="Financial views">
      <NavLink
        to={`${BASE}/overview`}
        className={({ isActive }) => `saas-tabs__btn${isActive ? ' saas-tabs__btn--active' : ''}`}
      >
        Overview
      </NavLink>
      <NavLink
        to={`${BASE}/leakages`}
        className={({ isActive }) => `saas-tabs__btn${isActive ? ' saas-tabs__btn--active' : ''}`}
      >
        Leakages
      </NavLink>
      <NavLink
        to={`${BASE}/revenue-projections`}
        className={({ isActive }) => `saas-tabs__btn${isActive ? ' saas-tabs__btn--active' : ''}`}
      >
        Revenue projections
      </NavLink>
    </nav>
  )
}
