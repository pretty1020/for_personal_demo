import { Navigate } from 'react-router-dom'

/** Financial scenario comparisons removed — redirect to Financial overview. */
export function IdealFinancialScenarioPage() {
  return <Navigate to="/financial" replace />
}
