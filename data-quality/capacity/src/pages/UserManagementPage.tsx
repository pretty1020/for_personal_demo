import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { ModulePageHeader } from '../components/shell/ModulePageHeader'
import { useDemoSession } from '../context/DemoSessionContext'
import {
  apiCreateUser,
  apiDeleteUser,
  apiListUsers,
  apiSetUserActive,
  apiUpdateUser,
  type ManagedApiUser,
} from '../data/apiClient'
import { hydrateClientRegistry, loadClientRegistry } from '../planner/clientRegistry'
import {
  ACCESS_LEVEL_OPTIONS,
  deleteManagedUser,
  loadManagedUsers,
  setManagedUserActive,
  upsertManagedUser,
  type ManagedUser,
} from '../planner/userDirectory'
import { accessLevelLabel, normalizeAccessLevel, type AccessLevel } from '../utils/accessLevel'

type DirectoryUser = {
  id: string
  name: string
  email: string
  accessLevel: AccessLevel
  active: boolean
  allowedClients: string[]
}

type Draft = {
  id?: string
  name: string
  email: string
  password: string
  accessLevel: AccessLevel
  allowedClients: string[]
}

const EMPTY_DRAFT: Draft = {
  name: '',
  email: '',
  password: '',
  accessLevel: 'cap_planner',
  allowedClients: [],
}

function fromLocal(user: ManagedUser): DirectoryUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    accessLevel: user.accessLevel,
    active: user.active,
    allowedClients: user.allowedClients ?? [],
  }
}

function fromApi(user: ManagedApiUser): DirectoryUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    accessLevel: normalizeAccessLevel(user.accessLevel),
    active: user.active,
    allowedClients: Array.isArray(user.allowedClients) ? user.allowedClients : [],
  }
}

function clientsSummary(item: DirectoryUser): string {
  if (item.accessLevel !== 'manager') return '—'
  if (!item.allowedClients.length) return 'No clients assigned'
  if (item.allowedClients.length === 1) return item.allowedClients[0]!
  return `${item.allowedClients.length} clients`
}

export function UserManagementPage() {
  const {
    canManageUsers: allowManage,
    user: currentUser,
    refreshSessionUser,
    remoteBackend,
  } = useDemoSession()
  const [users, setUsers] = useState<DirectoryUser[]>([])
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [clientNames, setClientNames] = useState<string[]>(() =>
    loadClientRegistry()
      .map((client) => client.name.trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b)),
  )
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const sorted = useMemo(
    () =>
      [...users].sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1
        return a.name.localeCompare(b.name)
      }),
    [users],
  )

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      if (remoteBackend) {
        const remoteUsers = await apiListUsers()
        setUsers(remoteUsers.map(fromApi))
      } else {
        setUsers(loadManagedUsers().map(fromLocal))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load users.')
    } finally {
      setLoading(false)
    }
  }, [remoteBackend])

  useEffect(() => {
    if (!allowManage) return
    void reload()
  }, [allowManage, reload])

  useEffect(() => {
    if (!allowManage) return
    let cancelled = false
    void hydrateClientRegistry()
      .then((clients) => {
        if (cancelled) return
        setClientNames(
          clients
            .map((client) => client.name.trim())
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b)),
        )
      })
      .catch(() => {
        if (cancelled) return
        setClientNames(
          loadClientRegistry()
            .map((client) => client.name.trim())
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b)),
        )
      })
    return () => {
      cancelled = true
    }
  }, [allowManage])

  if (!allowManage) {
    return <Navigate to="/" replace />
  }

  const startEdit = (item: DirectoryUser) => {
    setDraft({
      id: item.id,
      name: item.name,
      email: item.email,
      password: '',
      accessLevel: item.accessLevel,
      allowedClients: [...item.allowedClients],
    })
    setMessage('')
    setError('')
  }

  const resetDraft = () => {
    setDraft(EMPTY_DRAFT)
    setError('')
  }

  const toggleClient = (name: string) => {
    setDraft((prev) => {
      const key = name.toLowerCase()
      const exists = prev.allowedClients.some((item) => item.toLowerCase() === key)
      return {
        ...prev,
        allowedClients: exists
          ? prev.allowedClients.filter((item) => item.toLowerCase() !== key)
          : [...prev.allowedClients, name],
      }
    })
  }

  const saveUser = async () => {
    setError('')
    if (!draft.name.trim() || !draft.email.trim()) {
      setError('Name and email are required.')
      return
    }
    if (!draft.id && !draft.password.trim()) {
      setError('Password is required for new users.')
      return
    }
    if (draft.password.trim() && draft.password.trim().length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    const allowedClients = draft.accessLevel === 'manager' ? draft.allowedClients : []

    setSaving(true)
    try {
      if (remoteBackend) {
        if (draft.id) {
          await apiUpdateUser(draft.id, {
            name: draft.name.trim(),
            email: draft.email.trim(),
            password: draft.password.trim() || undefined,
            accessLevel: draft.accessLevel,
            allowedClients,
          })
        } else {
          await apiCreateUser({
            name: draft.name.trim(),
            email: draft.email.trim(),
            password: draft.password.trim(),
            accessLevel: draft.accessLevel,
            allowedClients,
          })
        }
      } else {
        const localPassword = draft.id
          ? draft.password.trim() ||
            loadManagedUsers().find((item) => item.id === draft.id)?.password ||
            ''
          : draft.password.trim()
        upsertManagedUser({
          id: draft.id,
          name: draft.name,
          email: draft.email,
          password: localPassword,
          accessLevel: draft.accessLevel,
          allowedClients,
        })
      }
      await reload()
      refreshSessionUser()
      setMessage(draft.id ? 'User updated.' : 'User added.')
      resetDraft()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save user.')
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (item: DirectoryUser) => {
    if (item.email === currentUser?.email && item.active) {
      setError('You cannot deactivate your own account.')
      return
    }
    setSaving(true)
    setError('')
    try {
      if (remoteBackend) {
        await apiSetUserActive(item.id, !item.active)
      } else {
        const next = setManagedUserActive(item.id, !item.active)
        if (!next) {
          setError('Keep at least one active admin account.')
          return
        }
      }
      await reload()
      setMessage(item.active ? 'User deactivated.' : 'User activated.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update user.')
    } finally {
      setSaving(false)
    }
  }

  const removeUser = async (item: DirectoryUser) => {
    if (item.email === currentUser?.email) {
      setError('You cannot delete your own account.')
      return
    }
    if (!window.confirm(`Remove ${item.name} (${item.email})?`)) return
    setSaving(true)
    setError('')
    try {
      if (remoteBackend) {
        await apiDeleteUser(item.id)
      } else if (!deleteManagedUser(item.id)) {
        setError('Keep at least one active admin account.')
        return
      }
      await reload()
      setMessage('User removed.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete user.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="user-mgmt">
      <ModulePageHeader
        title="User management"
        description={
          remoteBackend
            ? 'Manage accounts and roles for your team. Analyst and Capacity planner cannot open DBE or Leakage.'
            : 'Demo accounts on this device only. Analyst and Capacity planner cannot open DBE or Leakage.'
        }
      />

      {message ? <p className="user-mgmt__flash">{message}</p> : null}
      {error ? <p className="user-mgmt__flash user-mgmt__flash--error">{error}</p> : null}

      <section className="user-mgmt__card saas-card">
        <header className="user-mgmt__card-head">
          <div>
            <p className="user-mgmt__eyebrow">{draft.id ? 'Edit user' : 'Add user'}</p>
            <h3 className="m-0">{draft.id ? 'Update access' : 'Invite teammate'}</h3>
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
              placeholder="e.g. Alex Rivera"
              autoComplete="name"
              onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
            />
          </label>
          <label className="saas-field">
            <span className="saas-field__label">Email</span>
            <input
              className="cap-field__input"
              type="email"
              value={draft.email}
              placeholder="name@company.com"
              autoComplete="email"
              onChange={(event) => setDraft((prev) => ({ ...prev, email: event.target.value }))}
            />
          </label>
          <label className="saas-field">
            <span className="saas-field__label">Password</span>
            <input
              className="cap-field__input"
              type="password"
              value={draft.password}
              placeholder={draft.id ? 'Leave blank to keep current password' : 'At least 6 characters'}
              autoComplete="new-password"
              onChange={(event) => setDraft((prev) => ({ ...prev, password: event.target.value }))}
            />
          </label>
          <label className="saas-field">
            <span className="saas-field__label">Access level</span>
            <select
              className="cap-field__input"
              value={draft.accessLevel}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  accessLevel: event.target.value as AccessLevel,
                  allowedClients:
                    event.target.value === 'manager' ? prev.allowedClients : [],
                }))
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

        {draft.accessLevel === 'manager' ? (
          <div className="user-mgmt__clients">
            <p className="saas-field__label">Assigned clients</p>
            <p className="saas-muted m-0 text-sm">
              Managers only see staffing plans for the clients you assign. Empty grants mean no
              clients — there is no “all clients” fallback.
            </p>
            {clientNames.length ? (
              <div className="user-mgmt__client-chips" role="group" aria-label="Assigned clients">
                {clientNames.map((name) => {
                  const selected = draft.allowedClients.some(
                    (item) => item.toLowerCase() === name.toLowerCase(),
                  )
                  return (
                    <button
                      key={name}
                      type="button"
                      className={`user-mgmt__client-chip${selected ? ' is-selected' : ''}`}
                      aria-pressed={selected}
                      onClick={() => toggleClient(name)}
                    >
                      {name}
                    </button>
                  )
                })}
              </div>
            ) : (
              <p className="saas-muted m-0 text-sm">No clients in the registry yet. Add a client first.</p>
            )}
            {!draft.allowedClients.length ? (
              <p className="saas-muted m-0 text-sm">No clients assigned.</p>
            ) : (
              <p className="saas-muted m-0 text-sm">
                {draft.allowedClients.length} client{draft.allowedClients.length === 1 ? '' : 's'}{' '}
                selected.
              </p>
            )}
          </div>
        ) : null}

        <div className="user-mgmt__actions">
          <button type="button" className="saas-btn" onClick={() => void saveUser()} disabled={saving}>
            {draft.id ? 'Save changes' : 'Add user'}
          </button>
        </div>
      </section>

      <section className="user-mgmt__card saas-card" aria-label="Directory">
        <header className="user-mgmt__card-head">
          <div>
            <p className="user-mgmt__eyebrow">Directory</p>
            <h3 className="m-0">
              {loading ? 'Loading…' : `${sorted.length} user${sorted.length === 1 ? '' : 's'}`}
            </h3>
          </div>
          <button type="button" className="saas-btn saas-btn--secondary" onClick={() => void reload()} disabled={loading}>
            Refresh
          </button>
        </header>
        <div className="user-mgmt__table-wrap">
          <table className="user-mgmt__table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Access</th>
                <th>Clients</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {!loading && sorted.length === 0 ? (
                <tr>
                  <td colSpan={6} className="saas-muted">
                    No users yet.
                  </td>
                </tr>
              ) : null}
              {sorted.map((item) => (
                <tr key={item.id} className={item.active ? undefined : 'user-mgmt__row--inactive'}>
                  <td>{item.name}</td>
                  <td>{item.email}</td>
                  <td>{accessLevelLabel(item.accessLevel)}</td>
                  <td className="user-mgmt__clients-cell" title={item.allowedClients.join(', ') || undefined}>
                    {clientsSummary(item)}
                  </td>
                  <td>
                    <span className={`user-mgmt__status${item.active ? ' is-active' : ''}`}>
                      {item.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="user-mgmt__row-actions">
                    <button
                      type="button"
                      className="portfolio-hierarchy__link"
                      onClick={() => startEdit(item)}
                      disabled={saving}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="portfolio-hierarchy__link"
                      onClick={() => void toggleActive(item)}
                      disabled={saving}
                    >
                      {item.active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button
                      type="button"
                      className="portfolio-hierarchy__link"
                      onClick={() => void removeUser(item)}
                      disabled={saving}
                    >
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
