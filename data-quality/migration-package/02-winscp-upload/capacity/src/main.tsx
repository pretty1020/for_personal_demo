import { installCryptoPolyfill } from './utils/newId'

installCryptoPolyfill()

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { installCapacityDocumentSync } from './data/capacityDocuments'
import { isRemoteBackend } from './data/apiClient'

const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error('Root container #root not found')
}
const mountEl = rootEl

async function bootstrap() {
  try {
    if (isRemoteBackend()) {
      installCapacityDocumentSync()
    }

    const [
      { default: App },
      { PlannerProvider },
      { DemoSessionProvider },
      { AppProviders },
    ] = await Promise.all([
      import('./App.tsx'),
      import('./context/PlannerContext'),
      import('./context/DemoSessionContext'),
      import('./components/AppProviders'),
    ])

    createRoot(mountEl).render(
      <StrictMode>
        <AppErrorBoundary>
          <BrowserRouter>
            <DemoSessionProvider>
              <AppProviders PlannerProvider={PlannerProvider}>
                <App />
              </AppProviders>
            </DemoSessionProvider>
          </BrowserRouter>
        </AppErrorBoundary>
      </StrictMode>,
    )
  } catch (error) {
    const msg =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : 'Unknown startup error'
    mountEl.innerHTML = `
      <div class="app-crash-wrap" role="alert">
        <div class="app-crash-card">
          <h1>App startup failed</h1>
          <p>A module failed to load during bootstrap.</p>
          <pre>${msg}</pre>
          <button class="btn-primary" onclick="window.location.reload()">Reload app</button>
        </div>
      </div>
    `
    console.error('Bootstrap failed:', error)
  }
}

void bootstrap()
