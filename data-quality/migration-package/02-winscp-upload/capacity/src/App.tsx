import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppShell } from './components/shell/AppShell'
import { useDemoSession } from './context/DemoSessionContext'
import './index.css'

const AdvancedStaffingCapacityPlanPage = lazy(() =>
  import('./pages/AdvancedStaffingCapacityPlanPage').then((m) => ({ default: m.AdvancedStaffingCapacityPlanPage })),
)
const CapacityPlanSettingsPage = lazy(() =>
  import('./pages/CapacityPlanSettingsPage').then((m) => ({ default: m.CapacityPlanSettingsPage })),
)
const CapacitySummaryPage = lazy(() =>
  import('./pages/CapacitySummaryPage').then((m) => ({ default: m.CapacitySummaryPage })),
)
const CapacitySignInPage = lazy(() =>
  import('./pages/CapacitySignInPage').then((m) => ({ default: m.CapacitySignInPage })),
)
const DemoAccessPage = lazy(() =>
  import('./pages/DemoAccessPage').then((m) => ({ default: m.DemoAccessPage })),
)
const CapacitySetupWizardPage = lazy(() =>
  import('./pages/CapacitySetupWizardPage').then((m) => ({ default: m.CapacitySetupWizardPage })),
)
const UserManagementPage = lazy(() =>
  import('./pages/UserManagementPage').then((m) => ({ default: m.UserManagementPage })),
)
const DbePage = lazy(() => import('./pages/DbePage').then((m) => ({ default: m.DbePage })))
const LeakagePage = lazy(() => import('./pages/LeakagePage').then((m) => ({ default: m.LeakagePage })))
const FormulaReferencePage = lazy(() =>
  import('./pages/FormulaReferencePage').then((m) => ({ default: m.FormulaReferencePage })),
)

function PageFallback() {
  return (
    <div className="route-fallback" aria-busy="true" aria-live="polite">
      <span className="spinner" aria-hidden />
      <span>Loading…</span>
    </div>
  )
}

function RequireDemoAuth({ children }: { children: ReactNode }) {
  const { authenticated, sessionReady } = useDemoSession()
  const location = useLocation()
  if (!sessionReady) return <PageFallback />
  if (!authenticated) {
    return <Navigate to="/" replace state={{ from: location.pathname + location.search }} />
  }
  return children
}

function RequireDbeLeakageAccess({ children }: { children: ReactNode }) {
  const { canViewDbeLeakage, sessionReady } = useDemoSession()
  if (!sessionReady) return <PageFallback />
  if (!canViewDbeLeakage) {
    return <Navigate to="/capacity-plan" replace />
  }
  return children
}

export default function App({ embeddedInMainApp = false }: { embeddedInMainApp?: boolean }) {
  return (
    <Routes>
      <Route path="/" element={<AppShell embeddedInMainApp={embeddedInMainApp} />}>
        {embeddedInMainApp ? (
          <Route
            index
            element={
              <Suspense fallback={<PageFallback />}>
                <CapacitySignInPage />
              </Suspense>
            }
          />
        ) : (
          <Route
            index
            element={
              <Suspense fallback={<PageFallback />}>
                <DemoAccessPage />
              </Suspense>
            }
          />
        )}
        <Route
          path="setup"
          element={
            <RequireDemoAuth>
              <Suspense fallback={<PageFallback />}>
                <CapacitySetupWizardPage />
              </Suspense>
            </RequireDemoAuth>
          }
        />
        <Route
          path="summary"
          element={
            <RequireDemoAuth>
              <Suspense fallback={<PageFallback />}>
                <CapacitySummaryPage />
              </Suspense>
            </RequireDemoAuth>
          }
        />
        <Route
          path="capacity-plan"
          element={
            <RequireDemoAuth>
              <Suspense fallback={<PageFallback />}>
                <AdvancedStaffingCapacityPlanPage embedded />
              </Suspense>
            </RequireDemoAuth>
          }
        />
        <Route
          path="plan-settings"
          element={
            <RequireDemoAuth>
              <Suspense fallback={<PageFallback />}>
                <CapacityPlanSettingsPage />
              </Suspense>
            </RequireDemoAuth>
          }
        />
        <Route
          path="users"
          element={
            <RequireDemoAuth>
              <Suspense fallback={<PageFallback />}>
                <UserManagementPage />
              </Suspense>
            </RequireDemoAuth>
          }
        />
        <Route
          path="dbe"
          element={
            <RequireDemoAuth>
              <RequireDbeLeakageAccess>
                <Suspense fallback={<PageFallback />}>
                  <DbePage />
                </Suspense>
              </RequireDbeLeakageAccess>
            </RequireDemoAuth>
          }
        />
        <Route
          path="leakage"
          element={
            <RequireDemoAuth>
              <RequireDbeLeakageAccess>
                <Suspense fallback={<PageFallback />}>
                  <LeakagePage />
                </Suspense>
              </RequireDbeLeakageAccess>
            </RequireDemoAuth>
          }
        />
        <Route
          path="formulas"
          element={
            <RequireDemoAuth>
              <Suspense fallback={<PageFallback />}>
                <FormulaReferencePage />
              </Suspense>
            </RequireDemoAuth>
          }
        />
      </Route>

      {/* Legacy bookmarks → active modules */}
      <Route path="/overall" element={<Navigate to="/summary" replace />} />
      <Route path="/advanced-staffing-capacity-plan" element={<Navigate to="/capacity-plan" replace />} />
      <Route path="*" element={<Navigate to={embeddedInMainApp ? '/capacity-plan' : '/'} replace />} />
    </Routes>
  )
}
