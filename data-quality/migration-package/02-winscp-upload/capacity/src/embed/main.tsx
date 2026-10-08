import { installCryptoPolyfill } from '../utils/newId'

installCryptoPolyfill()

import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from '../App'
import { AppErrorBoundary } from '../components/AppErrorBoundary'
import { AppProviders } from '../components/AppProviders'
import { installCapacityDocumentSync } from '../data/capacityDocuments'
import { isRemoteBackend } from '../data/apiClient'
import { PlannerProvider } from '../context/PlannerContext'
import { DemoSessionProvider } from '../context/DemoSessionContext'
import { CapacityEmbedContext } from '../context/CapacityEmbedContext'
import '../index.css'

export type MountCapacityOptions = {
  basename?: string
}

const roots = new WeakMap<HTMLElement, Root>()

export function mountCapacityApp(container: HTMLElement, options: MountCapacityOptions = {}): () => void {
  const basename = options.basename ?? '/capacity'

  if (isRemoteBackend()) {
    installCapacityDocumentSync()
  }

  const root = createRoot(container)
  roots.set(container, root)

  root.render(
    <StrictMode>
      <CapacityEmbedContext.Provider value={{ embeddedInMainApp: true, basename }}>
        <AppErrorBoundary>
          <BrowserRouter basename={basename}>
            <DemoSessionProvider embeddedInMainApp>
              <AppProviders PlannerProvider={PlannerProvider}>
                <App embeddedInMainApp />
              </AppProviders>
            </DemoSessionProvider>
          </BrowserRouter>
        </AppErrorBoundary>
      </CapacityEmbedContext.Provider>
    </StrictMode>,
  )

  return () => {
    root.unmount()
    roots.delete(container)
  }
}

declare global {
  interface Window {
    mountCapacityApp?: typeof mountCapacityApp
  }
}

if (typeof window !== 'undefined') {
  window.mountCapacityApp = mountCapacityApp
}
