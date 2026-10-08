import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useDemoSession } from '../../context/DemoSessionContext'
import { SaveStatusBadge } from './SaveStatusBadge'
import { ActAsBanner } from './ActAsBanner'

type Props = {
  embeddedInMainApp?: boolean
}

export function AppShell({ embeddedInMainApp = false }: Props) {
  const navigate = useNavigate()
  const { authenticated, canManageUsers, canCreatePlans, canViewPortfolioSummary, canViewDbeLeakage, sessionReady, user, logout } =
    useDemoSession()

  const nav = [
    ...(embeddedInMainApp ? [] : [{ to: '/', label: 'Home', end: true }]),
    ...(canViewPortfolioSummary ? [{ to: '/summary', label: 'Summary', end: false }] : []),
    { to: '/capacity-plan', label: 'Staffing Plan', end: false },
    ...(canViewDbeLeakage ? [{ to: '/dbe', label: 'DBE', end: false }] : []),
    ...(canViewDbeLeakage ? [{ to: '/leakage', label: 'Leakage', end: false }] : []),
    { to: '/plan-settings', label: 'Plan settings', end: false },
    ...(canViewPortfolioSummary ? [{ to: '/formulas', label: 'Formulas', end: false }] : []),
    ...(canCreatePlans ? [{ to: '/setup', label: 'Add client', end: false }] : []),
    ...(canManageUsers ? [{ to: '/users', label: 'Users', end: false }] : []),
  ]

  if (!sessionReady) {
    return (
      <div className="route-fallback" aria-busy="true">
        <span className="spinner" aria-hidden />
        <span>Loading Capacity…</span>
      </div>
    )
  }

  if (!authenticated) {
    return (
      <div className="saas-shell cap-platform movate-shell movate-shell--gate movate-shell--embedded-gate">
        <main className="saas-main saas-main--embedded">
          <Outlet />
        </main>
      </div>
    )
  }

  const handleSignOut = () => {
    void (async () => {
      await logout()
      navigate('/', { replace: true })
    })()
  }

  return (
    <div
      className={`saas-shell cap-platform movate-shell${embeddedInMainApp ? ' movate-shell--embedded' : ''}`}
    >
      {embeddedInMainApp ? (
        <div className="cap-embed-subnav-wrap">
          <nav className="cap-nav cap-nav--embed movate-nav" aria-label="Capacity navigation">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `cap-nav__item${isActive ? ' cap-nav__item--active' : ''}`}
              >
                <span className="cap-nav__label">{item.label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="cap-embed-session">
            <span className="cap-embed-session__user" title={user?.email ?? undefined}>
              {user?.name ?? 'Signed in'}
            </span>
            <button type="button" className="cap-embed-session__signout" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="movate-top-accent" aria-hidden />
          <header className="saas-header cap-header movate-header">
            <div className="saas-header__inner">
              <div className="saas-brand">
                <div>
                  <p className="saas-brand__eyebrow">Movate</p>
                  <h1 className="saas-brand__title">Capacity Plan</h1>
                </div>
              </div>
              <nav className="cap-nav movate-nav" aria-label="Main navigation">
                {nav.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) => `cap-nav__item${isActive ? ' cap-nav__item--active' : ''}`}
                  >
                    <span className="cap-nav__label">{item.label}</span>
                  </NavLink>
                ))}
              </nav>
              <div className="cap-header-session">
                <span className="cap-header-session__user">{user?.name}</span>
                <button type="button" className="cap-header-session__signout" onClick={handleSignOut}>
                  Sign out
                </button>
              </div>
            </div>
          </header>
        </>
      )}
      <ActAsBanner />
      <main className={`saas-main${embeddedInMainApp ? ' saas-main--embedded' : ''}`}>
        <Outlet />
      </main>
      <SaveStatusBadge />
    </div>
  )
}
