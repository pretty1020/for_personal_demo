import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { AiAssistantWidget } from '../assistant/AiAssistantWidget'
import { useDemoSession } from '../../context/DemoSessionContext'

type NavItem = {
  to: string
  label: string
  match: (path: string) => boolean
}

const MODULES_NAV: NavItem = { to: '/', label: 'Modules', match: (path) => path === '/' }

const BASE_NAV: NavItem[] = [
  { to: '/workspace', label: 'Home', match: (path) => path === '/workspace' },
  { to: '/capacity-plan', label: 'Capacity', match: (path) => path === '/capacity-plan' },
  { to: '/capacity-plan/seats', label: 'Seats', match: (path) => path.startsWith('/capacity-plan/seats') },
  { to: '/capacity-plan/talent', label: 'TA', match: (path) => path.startsWith('/capacity-plan/talent') },
  { to: '/capacity-plan/it', label: 'IT', match: (path) => path.startsWith('/capacity-plan/it') },
  { to: '/capacity-plan/operations', label: 'Operations', match: (path) => path.startsWith('/capacity-plan/operations') },
  { to: '/roster', label: 'Roster', match: (path) => path.startsWith('/roster') },
  { to: '/forecasting', label: 'Forecasting', match: (path) => path.startsWith('/forecasting') },
  { to: '/scheduling', label: 'Scheduling', match: (path) => path.startsWith('/scheduling') },
  { to: '/planning', label: 'Planning Scenario', match: (path) => path.startsWith('/planning') },
]

export function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const {
    authenticated,
    user,
    logout,
    canUseAssistant,
    canManageUsers,
    canEditFormulas,
    canViewExecutiveDashboard,
    canViewFinancials,
  } = useDemoSession()

  const nav: NavItem[] = [
    MODULES_NAV,
    BASE_NAV[0]!,
    ...(canViewExecutiveDashboard
      ? [{ to: '/executive', label: 'Executive', match: (path: string) => path.startsWith('/executive') }]
      : []),
    ...BASE_NAV.slice(1),
    ...(canViewFinancials
      ? [
          {
            to: '/financial/overview',
            label: 'Financial',
            match: (path: string) => path.startsWith('/financial'),
          },
        ]
      : []),
    ...(canEditFormulas
      ? [{ to: '/formulas', label: 'Formulas', match: (path: string) => path.startsWith('/formulas') }]
      : []),
    ...(canManageUsers
      ? [{ to: '/users', label: 'Users', match: (path: string) => path.startsWith('/users') }]
      : []),
  ]

  return (
    <div className="saas-shell cap-platform">
      <header className="saas-header cap-header">
        <div className="saas-header__inner">
          <div className="saas-brand">
            <h1 className="saas-brand__title">Capacity Planning</h1>
          </div>
          {authenticated ? (
            <>
              <nav className="cap-nav" aria-label="Main navigation">
                {nav.map((item) => {
                  const active = item.match(location.pathname)
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === '/'}
                      className={`cap-nav__item${active ? ' cap-nav__item--active' : ''}`}
                    >
                      <span className="cap-nav__label">{item.label}</span>
                    </NavLink>
                  )
                })}
              </nav>
              <div className="cap-shell-actions">
                <button
                  type="button"
                  className="saas-btn saas-btn--secondary"
                  onClick={() => {
                    void (async () => {
                      await logout()
                      navigate('/')
                    })()
                  }}
                >
                  {user?.name ?? 'Demo user'} · Sign out
                </button>
              </div>
            </>
          ) : null}
        </div>
      </header>
      <main className="saas-main">
        <Outlet />
      </main>
      {authenticated && canUseAssistant ? <AiAssistantWidget /> : null}
    </div>
  )
}
