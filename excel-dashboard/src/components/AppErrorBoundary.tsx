import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  message: string
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    message: '',
  }

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : 'Unexpected runtime error',
    }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('App crashed:', error, info)
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div className="app-crash-wrap" role="alert">
        <div className="app-crash-card">
          <h1>App failed to render</h1>
          <p>Something went wrong at runtime. Please reload this page.</p>
          <pre>{this.state.message}</pre>
          <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
            Reload app
          </button>
        </div>
      </div>
    )
  }
}
