import type { ComponentType, ReactNode } from 'react'
import { useDemoSession } from '../context/DemoSessionContext'

type AppProvidersProps = {
  PlannerProvider: ComponentType<{ children: ReactNode }>
  children: ReactNode
}

function SessionGate({ children }: { children: ReactNode }) {
  const { sessionReady } = useDemoSession()
  if (!sessionReady) {
    return (
      <div className="route-fallback" aria-busy="true" aria-live="polite">
        <span className="spinner" aria-hidden />
        <span>Connecting…</span>
      </div>
    )
  }
  return children
}

export function AppProviders({ PlannerProvider, children }: AppProvidersProps) {
  const { user } = useDemoSession()
  const plannerKey = user?.email ?? 'guest'

  return (
    <SessionGate>
      <PlannerProvider key={plannerKey}>{children}</PlannerProvider>
    </SessionGate>
  )
}
