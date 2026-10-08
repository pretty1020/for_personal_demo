import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  message: string
  recovering: boolean
}

const RELOAD_GUARD_KEY = 'wfp-stale-chunk-reloaded'

/**
 * Each embed build wipes the previous hashed chunks, so a browser holding a
 * cached embed.js can ask for chunks the server no longer has. That surfaces as
 * a failed dynamic import (or a MIME error, when the miss is answered with HTML).
 */
function isStaleChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return (
    message.includes('Failed to fetch dynamically imported module') ||
    message.includes('error loading dynamically imported module') ||
    message.includes('Importing a module script failed') ||
    (message.includes('MIME type') && message.includes('module'))
  )
}

/** Reload once per session, so a genuinely broken deploy cannot loop forever. */
function reloadOnceForStaleChunks(): boolean {
  try {
    if (sessionStorage.getItem(RELOAD_GUARD_KEY)) return false
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()))
  } catch {
    return false
  }
  window.location.reload()
  return true
}

export function clearStaleChunkReloadGuard(): void {
  try {
    sessionStorage.removeItem(RELOAD_GUARD_KEY)
  } catch {
    // ignore storage failures
  }
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    message: '',
    recovering: false,
  }

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : 'Unexpected runtime error',
      recovering: isStaleChunkError(error),
    }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('App crashed:', error, info)
    if (isStaleChunkError(error) && reloadOnceForStaleChunks()) return
    this.setState({ recovering: false })
  }

  render() {
    if (!this.state.hasError) return this.props.children

    if (this.state.recovering) {
      return (
        <div className="app-crash-wrap" role="status">
          <div className="app-crash-card">
            <h1>Updating to the latest version…</h1>
            <p>A newer version of Capacity is available. Reloading now.</p>
          </div>
        </div>
      )
    }

    return (
      <div className="app-crash-wrap" role="alert">
        <div className="app-crash-card">
          <h1>Something went wrong</h1>
          <p>
            Capacity could not open this page. Reloading usually fixes it. If it keeps happening,
            send the details below to your administrator.
          </p>
          {/* Collapsed: the raw exception helps support but is noise for everyone else. */}
          <details>
            <summary>Technical details</summary>
            <pre>{this.state.message}</pre>
          </details>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              clearStaleChunkReloadGuard()
              window.location.reload()
            }}
          >
            Reload app
          </button>
        </div>
      </div>
    )
  }
}
