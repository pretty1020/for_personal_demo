import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/shell/AppShell'
import { useDemoSession } from './context/DemoSessionContext'
import './index.css'

const PlanningSimulatorPage = lazy(() =>
  import('./pages/PlanningSimulatorPage').then((m) => ({ default: m.PlanningSimulatorPage })),
)
const AdvancedStaffingCapacityPlanPage = lazy(() =>
  import('./pages/AdvancedStaffingCapacityPlanPage').then((m) => ({ default: m.AdvancedStaffingCapacityPlanPage })),
)
const SeatsInformationPage = lazy(() =>
  import('./pages/SeatsInformationPage').then((m) => ({ default: m.SeatsInformationPage })),
)
const TalentAcquisitionPage = lazy(() =>
  import('./pages/PartnerViewsPage').then((m) => ({ default: m.TalentAcquisitionPage })),
)
const ItProvisioningPage = lazy(() =>
  import('./pages/PartnerViewsPage').then((m) => ({ default: m.ItProvisioningPage })),
)
const OperationsPartnerPage = lazy(() =>
  import('./pages/PartnerViewsPage').then((m) => ({ default: m.OperationsPartnerPage })),
)
const ForecastingPage = lazy(() =>
  import('./pages/ForecastingPage').then((m) => ({ default: m.ForecastingPage })),
)
const RosterPage = lazy(() =>
  import('./pages/RosterPage').then((m) => ({ default: m.RosterPage })),
)
const DemoAccessPage = lazy(() =>
  import('./pages/DemoAccessPage').then((m) => ({ default: m.DemoAccessPage })),
)
const ModuleLandingPage = lazy(() =>
  import('./pages/ModuleLandingPage').then((m) => ({ default: m.ModuleLandingPage })),
)
const CapacitySetupWizardPage = lazy(() =>
  import('./pages/CapacitySetupWizardPage').then((m) => ({ default: m.CapacitySetupWizardPage })),
)
const ExecutiveDashboardPage = lazy(() =>
  import('./pages/ExecutiveDashboardPage').then((m) => ({ default: m.ExecutiveDashboardPage })),
)
const UserManagementPage = lazy(() =>
  import('./pages/UserManagementPage').then((m) => ({ default: m.UserManagementPage })),
)
const FormulaSettingsPage = lazy(() =>
  import('./pages/FormulaSettingsPage').then((m) => ({ default: m.FormulaSettingsPage })),
)
const SchedulingPage = lazy(() =>
  import('./pages/SchedulingPage').then((m) => ({ default: m.SchedulingPage })),
)
const SchedulingSettingsPage = lazy(() =>
  import('./pages/SchedulingSettingsPage').then((m) => ({ default: m.SchedulingSettingsPage })),
)
const IdealFinancialLayout = lazy(() =>
  import('./pages/IdealFinancialLayout').then((m) => ({ default: m.IdealFinancialLayout })),
)
const IdealFinancialOverview = lazy(() =>
  import('./pages/IdealFinancialOverview').then((m) => ({ default: m.IdealFinancialOverview })),
)
const IdealFinancialLeakagePage = lazy(() =>
  import('./pages/IdealFinancialLeakagePage').then((m) => ({ default: m.IdealFinancialLeakagePage })),
)
const RevenueProjectionsPage = lazy(() =>
  import('./pages/RevenueProjectionsPage').then((m) => ({ default: m.RevenueProjectionsPage })),
)
const ProcessAuditPage = lazy(() =>
  import('./pages/ProcessAuditPage').then((m) => ({ default: m.ProcessAuditPage })),
)
const GovernancePage = lazy(() =>
  import('./pages/GovernancePage').then((m) => ({ default: m.GovernancePage })),
)
const CertifiedDataPage = lazy(() =>
  import('./pages/CertifiedDataPage').then((m) => ({ default: m.CertifiedDataPage })),
)
const AnomalyDetectionPage = lazy(() =>
  import('./pages/AnomalyDetectionPage').then((m) => ({ default: m.AnomalyDetectionPage })),
)
const GlobalWfmPage = lazy(() =>
  import('./pages/GlobalWfmPage').then((m) => ({ default: m.GlobalWfmPage })),
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
  const { authenticated } = useDemoSession()
  if (!authenticated) return <Navigate to="/workspace" replace />
  return children
}

function RequireCreatePlans({ children }: { children: ReactNode }) {
  const { canCreatePlans } = useDemoSession()
  if (!canCreatePlans) return <Navigate to="/workspace" replace />
  return children
}

function RequireExecutiveAccess({ children }: { children: ReactNode }) {
  const { canViewExecutiveDashboard } = useDemoSession()
  if (!canViewExecutiveDashboard) return <Navigate to="/workspace" replace />
  return children
}

function RequireFinancialAccess({ children }: { children: ReactNode }) {
  const { canViewFinancials } = useDemoSession()
  if (!canViewFinancials) return <Navigate to="/workspace" replace />
  return children
}

function RequireAdminUsers({ children }: { children: ReactNode }) {
  const { canManageUsers } = useDemoSession()
  if (!canManageUsers) return <Navigate to="/workspace" replace />
  return children
}

function RequireFormulaAccess({ children }: { children: ReactNode }) {
  const { canEditFormulas } = useDemoSession()
  if (!canEditFormulas) return <Navigate to="/workspace" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <Suspense fallback={<PageFallback />}>
            <ModuleLandingPage />
          </Suspense>
        }
      />
      <Route
        path="/process-audit"
        element={
          <Suspense fallback={<PageFallback />}>
            <ProcessAuditPage />
          </Suspense>
        }
      />
      <Route
        path="/governance"
        element={
          <Suspense fallback={<PageFallback />}>
            <GovernancePage />
          </Suspense>
        }
      />
      <Route
        path="/certified-data"
        element={
          <Suspense fallback={<PageFallback />}>
            <CertifiedDataPage />
          </Suspense>
        }
      />
      <Route
        path="/anomaly-detection"
        element={
          <Suspense fallback={<PageFallback />}>
            <AnomalyDetectionPage />
          </Suspense>
        }
      />
      <Route
        path="/global-wfm"
        element={
          <Suspense fallback={<PageFallback />}>
            <GlobalWfmPage />
          </Suspense>
        }
      />
      <Route element={<AppShell />}>
        <Route
          path="workspace"
          element={
            <Suspense fallback={<PageFallback />}>
              <DemoAccessPage />
            </Suspense>
          }
        />
        <Route
          path="setup"
          element={
            <RequireDemoAuth>
              <RequireCreatePlans>
                <Suspense fallback={<PageFallback />}>
                  <CapacitySetupWizardPage />
                </Suspense>
              </RequireCreatePlans>
            </RequireDemoAuth>
          }
        />
        <Route
          path="executive"
          element={
            <RequireDemoAuth>
              <RequireExecutiveAccess>
                <Suspense fallback={<PageFallback />}>
                  <ExecutiveDashboardPage />
                </Suspense>
              </RequireExecutiveAccess>
            </RequireDemoAuth>
          }
        />
        <Route
          path="users"
          element={
            <RequireDemoAuth>
              <RequireAdminUsers>
                <Suspense fallback={<PageFallback />}>
                  <UserManagementPage />
                </Suspense>
              </RequireAdminUsers>
            </RequireDemoAuth>
          }
        />
        <Route
          path="formulas"
          element={
            <RequireDemoAuth>
              <RequireFormulaAccess>
                <Suspense fallback={<PageFallback />}>
                  <FormulaSettingsPage />
                </Suspense>
              </RequireFormulaAccess>
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
          path="capacity-plan/seats"
          element={
            <RequireDemoAuth>
              <Suspense fallback={<PageFallback />}>
                <SeatsInformationPage />
              </Suspense>
            </RequireDemoAuth>
          }
        />
        <Route
          path="capacity-plan/talent"
          element={
            <RequireDemoAuth>
              <Suspense fallback={<PageFallback />}>
                <TalentAcquisitionPage />
              </Suspense>
            </RequireDemoAuth>
          }
        />
        <Route
          path="capacity-plan/it"
          element={
            <RequireDemoAuth>
              <Suspense fallback={<PageFallback />}>
                <ItProvisioningPage />
              </Suspense>
            </RequireDemoAuth>
          }
        />
        <Route
          path="capacity-plan/operations"
          element={
            <RequireDemoAuth>
              <Suspense fallback={<PageFallback />}>
                <OperationsPartnerPage />
              </Suspense>
            </RequireDemoAuth>
          }
        />
        <Route
          path="forecasting"
          element={
            <RequireDemoAuth>
              <Suspense fallback={<PageFallback />}>
                <ForecastingPage />
              </Suspense>
            </RequireDemoAuth>
          }
        />
        <Route
          path="roster"
          element={
            <RequireDemoAuth>
              <Suspense fallback={<PageFallback />}>
                <RosterPage />
              </Suspense>
            </RequireDemoAuth>
          }
        />
        <Route path="roster/sync" element={<Navigate to="/roster" replace />} />
        <Route
          path="scheduling/settings"
          element={
            <RequireDemoAuth>
              <Suspense fallback={<PageFallback />}>
                <SchedulingSettingsPage />
              </Suspense>
            </RequireDemoAuth>
          }
        />
        <Route
          path="scheduling"
          element={
            <RequireDemoAuth>
              <Suspense fallback={<PageFallback />}>
                <SchedulingPage />
              </Suspense>
            </RequireDemoAuth>
          }
        />
        <Route
          path="planning"
          element={
            <RequireDemoAuth>
              <Suspense fallback={<PageFallback />}>
                <PlanningSimulatorPage />
              </Suspense>
            </RequireDemoAuth>
          }
        />
        <Route
          path="financial"
          element={
            <RequireDemoAuth>
              <RequireFinancialAccess>
                <Suspense fallback={<PageFallback />}>
                  <IdealFinancialLayout embedded />
                </Suspense>
              </RequireFinancialAccess>
            </RequireDemoAuth>
          }
        >
          <Route index element={<Navigate to="overview" replace />} />
          <Route
            path="overview"
            element={
              <Suspense fallback={<PageFallback />}>
                <IdealFinancialOverview />
              </Suspense>
            }
          />
          <Route
            path="leakages"
            element={
              <Suspense fallback={<PageFallback />}>
                <IdealFinancialLeakagePage />
              </Suspense>
            }
          />
          <Route
            path="revenue-projections"
            element={
              <Suspense fallback={<PageFallback />}>
                <RevenueProjectionsPage />
              </Suspense>
            }
          />
        </Route>
      </Route>

      <Route path="/planner/*" element={<Navigate to="/planning" replace />} />
      <Route path="/ideal-financial/*" element={<Navigate to="/financial/overview" replace />} />
      <Route path="/advanced-staffing-capacity-plan" element={<Navigate to="/capacity-plan" replace />} />
      <Route path="/summary" element={<Navigate to="/executive" replace />} />
      <Route path="/dbe/*" element={<Navigate to="/financial/overview" replace />} />
      <Route path="/dashboard" element={<Navigate to="/capacity-plan" replace />} />
      <Route path="/choose" element={<Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
