import { useState } from 'react'
import { MovateLogo } from '../MovateLogo'
import { useDemoSession } from '../../context/DemoSessionContext'

type Props = {
  embedded?: boolean
  onSuccess?: () => void
}

export function CapacitySignInForm({ embedded = false, onSuccess }: Props) {
  const { login, remoteBackend } = useDemoSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  return (
    <div className={`gate${embedded ? ' gate--embedded' : ''}`}>
      <div className="gate__wash" aria-hidden>
        <span className="gate__sweep" />
        <span className="gate__orb gate__orb--coral" />
        <span className="gate__orb gate__orb--violet" />
        <span className="gate__grid" />
      </div>
      <div className="gate__frame">
        <header className="gate__brand">
          <div className="gate__mark">
            <MovateLogo className="gate__mark__logo" />
          </div>
          <p className="gate__wordmark">Workspace</p>
          <p className="gate__product">Capacity Plan</p>
          <h1 className="gate__headline">
            {embedded ? 'Sign in to continue' : 'Staff the week. See the plan.'}
          </h1>
          {embedded ? (
            <p className="gate__hint">
              {remoteBackend
                ? 'Use your account. Workspace data syncs to the server when signed in.'
                : 'Demo mode — use a seeded account or one added in User management.'}
            </p>
          ) : null}
        </header>

        <form
          className="gate__form"
          onSubmit={(event) => {
            event.preventDefault()
            void (async () => {
              setSubmitting(true)
              try {
                const ok = await login(email, password)
                if (!ok) {
                  setError('Email or password is wrong.')
                  return
                }
                setError('')
                onSuccess?.()
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Sign-in failed. Check server configuration.')
              } finally {
                setSubmitting(false)
              }
            })()
          }}
        >
          <label className="gate__field">
            <span>Work email</span>
            <input
              type="email"
              autoComplete="username"
              placeholder="name@company.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label className="gate__field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {error ? <p className="gate__error">{error}</p> : null}
          <button type="submit" className="gate__submit" disabled={submitting}>
            {submitting ? 'Checking…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
