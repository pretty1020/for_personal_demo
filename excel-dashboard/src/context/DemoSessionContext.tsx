import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  apiGetSession,
  apiLogin,
  apiLogout,
  isRemoteBackend,
  type ApiUser,
} from '../data/apiClient'
import { flushWorkspaceSync, installWorkspaceSync, syncWorkspaceAfterLogin } from '../data/workspaceSync'
import {
  findManagedUserByEmail,
  loadManagedUsers,
  matchManagedUser,
  type ManagedUser,
} from '../planner/userDirectory'
import {
  canCreatePlans,
  canEditCapacity,
  canEditFormulas,
  canManagePlanAccess,
  canManageUsers,
  canViewExecutiveDashboard,
  canViewFinancials,
  isExecutiveAccess,
  normalizeAccessLevel,
  type AccessLevel,
} from '../utils/accessLevel'
import {
  assertCanManagePlanAccess,
  grantPlanAccess,
  listPlanAccessGrants,
  loadPlanAccessStore,
  revokePlanAccess,
  type PlanAccessGrant,
} from '../planner/planAccess'

const STORAGE_KEY = 'wfp-demo-session-v2'
const LEGACY_STORAGE_KEYS = ['wfp-demo-session-v1'] as const

export const DEMO_ACCOUNTS = [
  {
    email: 'admin@demo.local',
    password: 'demo',
    name: 'Admin',
    accessLevel: 'admin' as const,
  },
  {
    email: 'demo@demo.local',
    password: 'demo',
    name: 'Demo User',
    accessLevel: 'vp' as const,
  },
] as const

export const DEMO_CREDENTIALS = {
  email: DEMO_ACCOUNTS[0].email,
  password: DEMO_ACCOUNTS[0].password,
} as const

type DemoUser = {
  name: string
  email: string
  accessLevel: AccessLevel
  aiAssistantApproved?: boolean
}

type DemoSessionContextValue = {
  authenticated: boolean
  user: DemoUser | null
  accessLevel: AccessLevel | null
  isExecutive: boolean
  isAdmin: boolean
  canManageUsers: boolean
  canManagePlanAccess: boolean
  canCreatePlans: boolean
  canEditCapacity: boolean
  canEditFormulas: boolean
  canViewFinancials: boolean
  canViewExecutiveDashboard: boolean
  canUseAssistant: boolean
  planAccessRevision: number
  listPlanGrants: (scenarioId?: string) => PlanAccessGrant[]
  grantUserPlanAccess: (scenarioId: string, granteeEmail: string) => void
  revokeUserPlanAccess: (scenarioId: string, granteeEmail: string) => void
  refreshPlanAccess: () => void
  sessionReady: boolean
  remoteBackend: boolean
  login: (email: string, password: string) => Promise<boolean>
  logout: () => Promise<void>
  refreshSessionUser: () => void
}

const DemoSessionContext = createContext<DemoSessionContextValue | null>(null)

function canUseAssistantForUser(user: DemoUser | null): boolean {
  if (!user) return false
  return isExecutiveAccess(user.accessLevel) || user.aiAssistantApproved === true
}

function toDemoUser(user: ApiUser | DemoUser | ManagedUser): DemoUser {
  const accessLevel = normalizeAccessLevel(user.accessLevel)
  const aiAssistantApproved =
    'aiAssistantApproved' in user && user.aiAssistantApproved != null
      ? Boolean(user.aiAssistantApproved)
      : isExecutiveAccess(accessLevel)
  return {
    name: user.name,
    email: user.email.trim().toLowerCase(),
    accessLevel,
    aiAssistantApproved,
  }
}

function isActiveDirectoryUser(user: DemoUser | null): user is DemoUser {
  if (!user?.email) return false
  const managed = findManagedUserByEmail(user.email)
  return Boolean(managed?.active)
}

function resolveKnownUser(user: DemoUser): DemoUser {
  const managed = findManagedUserByEmail(user.email)
  if (managed) {
    return {
      name: managed.name,
      email: managed.email,
      accessLevel: managed.accessLevel,
      aiAssistantApproved: isExecutiveAccess(managed.accessLevel) || user.aiAssistantApproved === true,
    }
  }
  const known = DEMO_ACCOUNTS.find((account) => account.email === user.email)
  return known
    ? {
        name: known.name,
        email: known.email,
        accessLevel: known.accessLevel,
        aiAssistantApproved: isExecutiveAccess(known.accessLevel),
      }
    : user
}

function loadLocalUser(): DemoUser | null {
  try {
    for (const key of LEGACY_STORAGE_KEYS) localStorage.removeItem(key)
    loadManagedUsers()
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DemoUser
    const user = toDemoUser(parsed)
    if (!isActiveDirectoryUser(user)) {
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
    return resolveKnownUser(user)
  } catch {
    return null
  }
}

function saveLocalUser(user: DemoUser | null): void {
  if (user) localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
  else localStorage.removeItem(STORAGE_KEY)
}

export function DemoSessionProvider({ children }: { children: ReactNode }) {
  const remoteBackend = isRemoteBackend()
  const [user, setUser] = useState<DemoUser | null>(() => loadLocalUser())
  const [sessionReady, setSessionReady] = useState(!remoteBackend)
  const [planAccessRevision, setPlanAccessRevision] = useState(0)

  useEffect(() => {
    if (!remoteBackend) {
      setSessionReady(true)
      return
    }

    installWorkspaceSync()

    void (async () => {
      try {
        const sessionUser = await apiGetSession()
        if (sessionUser) {
          const nextUser = toDemoUser(sessionUser)
          if (!isActiveDirectoryUser(nextUser)) {
            saveLocalUser(null)
            setUser(null)
          } else {
            const known = resolveKnownUser(nextUser)
            saveLocalUser(known)
            setUser(known)
            try {
              await syncWorkspaceAfterLogin()
            } catch (syncError) {
              console.warn('Workspace sync skipped:', syncError)
            }
          }
        } else {
          setUser(loadLocalUser())
        }
      } catch (error) {
        console.warn('Session restore failed, using local session:', error)
        setUser(loadLocalUser())
      } finally {
        setSessionReady(true)
      }
    })()
  }, [remoteBackend])

  const login = useCallback(
    async (email: string, password: string) => {
      const managed = matchManagedUser(email, password)
      if (managed) {
        const nextUser = toDemoUser(managed)
        saveLocalUser(nextUser)
        setUser(nextUser)

        if (remoteBackend) {
          void apiLogin(managed.email, managed.password).catch(() => {
            // Demo sign-in works offline; API sync is optional.
          })
        }
        return true
      }

      if (!remoteBackend) return false

      try {
        const result = await apiLogin(email.trim().toLowerCase(), password.trim())
        if (!result) return false
        try {
          await syncWorkspaceAfterLogin()
        } catch (syncError) {
          console.warn('Workspace sync skipped after login:', syncError)
        }
        const nextUser = resolveKnownUser(toDemoUser(result.user))
        saveLocalUser(nextUser)
        setUser(nextUser)
        return true
      } catch (error) {
        console.warn('Remote login failed:', error)
        return false
      }
    },
    [remoteBackend],
  )

  const logout = useCallback(async () => {
    saveLocalUser(null)
    setUser(null)

    if (!remoteBackend) return

    try {
      await Promise.race([
        (async () => {
          try {
            await flushWorkspaceSync()
          } catch {
            // ignore
          }
          try {
            await apiLogout()
          } catch {
            // ignore
          }
        })(),
        new Promise<void>((resolve) => {
          window.setTimeout(resolve, 1500)
        }),
      ])
    } catch {
      // Local session already cleared.
    }
  }, [remoteBackend])

  const refreshSessionUser = useCallback(() => {
    setUser((prev) => {
      if (!prev) return null
      const next = resolveKnownUser(prev)
      if (!isActiveDirectoryUser(next)) {
        saveLocalUser(null)
        return null
      }
      saveLocalUser(next)
      return next
    })
  }, [])

  const refreshPlanAccess = useCallback(() => {
    loadPlanAccessStore()
    setPlanAccessRevision((n) => n + 1)
  }, [])

  const listPlanGrants = useCallback((scenarioId?: string) => listPlanAccessGrants(scenarioId), [planAccessRevision])

  const grantUserPlanAccess = useCallback(
    (scenarioId: string, granteeEmail: string) => {
      if (!user) throw new Error('Sign in required.')
      assertCanManagePlanAccess(user)
      grantPlanAccess({
        scenarioId,
        granteeEmail,
        grantedByEmail: user.email,
      })
      setPlanAccessRevision((n) => n + 1)
      if (remoteBackend) {
        void import('../data/planAccessApi')
          .then((mod) => mod.apiGrantPlanAccess(scenarioId, granteeEmail))
          .catch((error) => console.warn('Remote plan access grant failed:', error))
      }
    },
    [remoteBackend, user],
  )

  const revokeUserPlanAccess = useCallback(
    (scenarioId: string, granteeEmail: string) => {
      if (!user) throw new Error('Sign in required.')
      assertCanManagePlanAccess(user)
      revokePlanAccess(scenarioId, granteeEmail)
      setPlanAccessRevision((n) => n + 1)
      if (remoteBackend) {
        void import('../data/planAccessApi')
          .then((mod) => mod.apiRevokePlanAccess(scenarioId, granteeEmail))
          .catch((error) => console.warn('Remote plan access revoke failed:', error))
      }
    },
    [remoteBackend, user],
  )

  const accessLevel = user?.accessLevel ?? null

  const value = useMemo(
    () => ({
      authenticated: Boolean(user),
      user,
      accessLevel,
      isExecutive: isExecutiveAccess(accessLevel),
      isAdmin: accessLevel === 'admin',
      canManageUsers: canManageUsers(accessLevel),
      canManagePlanAccess: canManagePlanAccess(accessLevel),
      canCreatePlans: canCreatePlans(accessLevel),
      canEditCapacity: canEditCapacity(accessLevel),
      canEditFormulas: canEditFormulas(accessLevel),
      canViewFinancials: canViewFinancials(accessLevel),
      canViewExecutiveDashboard: canViewExecutiveDashboard(accessLevel),
      canUseAssistant: canUseAssistantForUser(user),
      planAccessRevision,
      listPlanGrants,
      grantUserPlanAccess,
      revokeUserPlanAccess,
      refreshPlanAccess,
      sessionReady,
      remoteBackend,
      login,
      logout,
      refreshSessionUser,
    }),
    [
      user,
      accessLevel,
      planAccessRevision,
      listPlanGrants,
      grantUserPlanAccess,
      revokeUserPlanAccess,
      refreshPlanAccess,
      sessionReady,
      remoteBackend,
      login,
      logout,
      refreshSessionUser,
    ],
  )

  return <DemoSessionContext.Provider value={value}>{children}</DemoSessionContext.Provider>
}

export function useDemoSession(): DemoSessionContextValue {
  const ctx = useContext(DemoSessionContext)
  if (!ctx) throw new Error('useDemoSession must be used within DemoSessionProvider')
  return ctx
}
