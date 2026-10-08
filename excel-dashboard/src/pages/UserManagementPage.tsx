import { useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { ModulePageHeader } from '../components/shell/ModulePageHeader'
import { useDemoSession } from '../context/DemoSessionContext'
import { usePlanner } from '../context/PlannerContext'
import {
  ACCESS_LEVEL_OPTIONS,
  deleteManagedUser,
  loadManagedUsers,
  setManagedUserActive,
  upsertManagedUser,
  type ManagedUser,
} from '../planner/userDirectory'
import { resolvePlanLob } from '../planner/planIdentity'
import { accessLevelLabel, type AccessLevel } from '../utils/accessLevel'

type Draft = {
  id?: string
  name: string
  email: string
  password: string
  accessLevel: AccessLevel
}

const EMPTY_DRAFT: Draft = {
  name: '',
  email: '',
  password: 'demo',
  accessLevel: 'cap_planner',
}

export function UserManagementPage() {
  const {
    canManageUsers: allowManage,
    user: currentUser,
    refreshSessionUser,
    grantUserPlanAccess,
    revokeUserPlanAccess,
    listPlanGrants,
    planAccessRevision,
  } = useDemoSession()
  const { allScenarios } = usePlanner()
  const [users, setUsers] = useState<ManagedUser[]>(() => loadManagedUsers())
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [grantScenarioId, setGrantScenarioId] = useState('')
  const [grantEmail, setGrantEmail] = useState('')

  const sorted = useMemo(
    () =>
      [...users].sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1
        return a.name.localeCompare(b.name)
      }),
    [users],
  )

  const grantablePlans = useMemo(
    () => allScenarios.filter((scenario) => !scenario.isBaseline),
    [allScenarios],
  )

  const grants = useMemo(() => {
    void planAccessRevision
    return listPlanGrants()
  }, [listPlanGrants, planAccessRevision])

  if (!allowManage) {
    return <Navigate to="/workspace" replace />
  }

  const reload = () => setUsers(loadManagedUsers())

  const startEdit = (item: ManagedUser) => {
    setDraft({
      id: item.id,
      name: item.name,
      email: item.email,
      password: item.password,
      accessLevel: item.accessLevel,
    })
    setMessage('')
    setError('')
  }

  const resetDraft = () => {
    setDraft(EMPTY_DRAFT)
    setError('')
  }

  const saveUser = () => {
    setError('')
    if (!draft.name.trim() || !draft.email.trim()) {
      setError('Name and email are required.')
      return
    }
    if (!draft.password.trim()) {
      setError('Password is required.')
      return
    }
    try {
      upsertManagedUser(draft)
      reload()
      refreshSessionUser()
      setMessage(draft.id ? 'User updated.' : 'User added.')
      resetDraft()
    } catch {
      setError('Could not save user.')
    }
  }

  const toggleActive = (item: ManagedUser) => {
    if (item.email === currentUser?.email && item.active) {
      setError('You cannot deactivate your own account.')
      return
    }
    const next = setManagedUserActive(item.id, !item.active)
    if (!next) {
      setError('Could not update user.')
      return
    }
    reload()
    setMessage(next.active ? 'User activated.' : 'User deactivated.')
  }

  const removeUser = (item: ManagedUser) => {
    if (item.email === currentUser?.email) {
      setError('You cannot delete your own account.')
      return
    }
    if (!window.confirm(`Remove ${item.name} (${item.email})?`)) return
    if (!deleteManagedUser(item.id)) {
      setError('Keep at least one active admin account.')
      return
    }
    reload()
    setMessage('User removed.')
  }

  const planLabel = (scenarioId: string) => {
    const scenario = allScenarios.find((item) => item.id === scenarioId)
    if (!scenario) return scenarioId
    const lob = resolvePlanLob(scenario.plan)
    return `${scenario.plan.client} · ${lob}`
  }

  const saveGrant = () => {
    setError('')
    if (!grantScenarioId || !grantEmail.trim()) {
      setError('Select a capacity plan and grantee email.')
      return
    }
    try {
      grantUserPlanAccess(grantScenarioId, grantEmail)
      setMessage(`Granted access to ${grantEmail.trim().toLowerCase()}.`)
      setGrantEmail('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not grant access.')
    }
  }

  return (
    <div className="user-mgmt">
      <ModulePageHeader
        title="Users"
        description="Roles and capacity plan access."
      />

      {message ? <p className="user-mgmt__flash">{message}</p> : null}
      {error ? <p className="user-mgmt__flash user-mgmt__flash--error">{error}</p> : null}

      <section className="user-mgmt__card saas-card">
        <header className="user-mgmt__card-head">
          <div>
            <h3 className="m-0">{draft.id ? 'Edit user' : 'Add user'}</h3>
          </div>
          {draft.id ? (
            <button type="button" className="saas-btn saas-btn--secondary" onClick={resetDraft}>
              Cancel edit
            </button>
          ) : null}
        </header>

        <div className="user-mgmt__form">
          <label className="saas-field">
            <span className="saas-field__label">Name</span>
            <input
              className="cap-field__input"
              value={draft.name}
              onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
            />
          </label>
          <label className="saas-field">
            <span className="saas-field__label">Email</span>
            <input
              className="cap-field__input"
              type="email"
              value={draft.email}
              onChange={(event) => setDraft((prev) => ({ ...prev, email: event.target.value }))}
            />
          </label>
          <label className="saas-field">
            <span className="saas-field__label">Password</span>
            <input
              className="cap-field__input"
              type="text"
              value={draft.password}
              onChange={(event) => setDraft((prev) => ({ ...prev, password: event.target.value }))}
            />
          </label>
          <label className="saas-field">
            <span className="saas-field__label">Access level</span>
            <select
              className="cap-field__input"
              value={draft.accessLevel}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, accessLevel: event.target.value as AccessLevel }))
              }
            >
              {ACCESS_LEVEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="saas-muted m-0 text-sm">
          {ACCESS_LEVEL_OPTIONS.find((item) => item.value === draft.accessLevel)?.blurb}
        </p>
        <div className="user-mgmt__actions">
          <button type="button" className="saas-btn" onClick={saveUser}>
            {draft.id ? 'Save changes' : 'Add user'}
          </button>
        </div>
      </section>

      <section className="user-mgmt__card saas-card" aria-label="Capacity plan access">
        <header className="user-mgmt__card-head">
          <div>
            <h3 className="m-0">Plan access</h3>
          </div>
        </header>
        <p className="saas-muted m-0 text-sm">
          Grant another user view or edit access to a capacity plan they do not own.
        </p>
        <div className="user-mgmt__form">
          <label className="saas-field">
            <span className="saas-field__label">Capacity plan</span>
            <select
              className="cap-field__input"
              value={grantScenarioId}
              onChange={(event) => setGrantScenarioId(event.target.value)}
            >
              <option value="">Select a plan…</option>
              {grantablePlans.map((scenario) => (
                <option key={scenario.id} value={scenario.id}>
                  {scenario.plan.client} · {resolvePlanLob(scenario.plan)}
                  {scenario.ownerEmail ? ` (owner: ${scenario.ownerEmail})` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="saas-field">
            <span className="saas-field__label">Grant to user</span>
            <select
              className="cap-field__input"
              value={grantEmail}
              onChange={(event) => setGrantEmail(event.target.value)}
            >
              <option value="">Select a user…</option>
              {sorted
                .filter((item) => item.active)
                .map((item) => (
                  <option key={item.id} value={item.email}>
                    {item.name} ({item.email})
                  </option>
                ))}
            </select>
          </label>
        </div>
        <div className="user-mgmt__actions">
          <button type="button" className="saas-btn" onClick={saveGrant}>
            Grant access
          </button>
        </div>

        <div className="user-mgmt__table-wrap">
          <table className="user-mgmt__table">
            <thead>
              <tr>
                <th>Capacity plan</th>
                <th>Grantee</th>
                <th>Granted by</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {grants.length === 0 ? (
                <tr>
                  <td colSpan={4} className="saas-muted">
                    No grants yet.
                  </td>
                </tr>
              ) : (
                grants.map((grant) => (
                  <tr key={`${grant.scenarioId}:${grant.granteeEmail}`}>
                    <td>{planLabel(grant.scenarioId)}</td>
                    <td>{grant.granteeEmail}</td>
                    <td>{grant.grantedByEmail}</td>
                    <td className="user-mgmt__row-actions">
                      <button
                        type="button"
                        className="portfolio-hierarchy__link"
                        onClick={() => {
                          try {
                            revokeUserPlanAccess(grant.scenarioId, grant.granteeEmail)
                            setMessage(`Revoked access for ${grant.granteeEmail}.`)
                          } catch (err) {
                            setError(err instanceof Error ? err.message : 'Could not revoke access.')
                          }
                        }}
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="user-mgmt__card saas-card" aria-label="Directory">
        <header className="user-mgmt__card-head">
          <div>
            <h3 className="m-0">Users ({sorted.length})</h3>
          </div>
        </header>
        <div className="user-mgmt__table-wrap">
          <table className="user-mgmt__table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Access</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sorted.map((item) => (
                <tr key={item.id} className={item.active ? undefined : 'user-mgmt__row--inactive'}>
                  <td>{item.name}</td>
                  <td>{item.email}</td>
                  <td>{accessLevelLabel(item.accessLevel)}</td>
                  <td>
                    <span className={`user-mgmt__status${item.active ? ' is-active' : ''}`}>
                      {item.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="user-mgmt__row-actions">
                    <button type="button" className="portfolio-hierarchy__link" onClick={() => startEdit(item)}>
                      Edit
                    </button>
                    <button type="button" className="portfolio-hierarchy__link" onClick={() => toggleActive(item)}>
                      {item.active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button type="button" className="portfolio-hierarchy__link" onClick={() => removeUser(item)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
