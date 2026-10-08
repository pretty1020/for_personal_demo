import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  apiGetSession,
  apiLogin,
  apiLogout,
  isRemoteBackend,
  setAuthToken,
  type ApiUser,
} from '../data/apiClient'
import {
  clearLocalCapacityData,
  flushCapacityDocuments,
  hydrateCapacityDocuments,
  installCapacityDocumentSync,
  pauseCapacityDocuments,
  resumeCapacityDocuments,
} from '../data/capacityDocuments'
import { hydrateClientRegistry } from '../planner/clientRegistry'
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
  canManageUsers,
  canViewDbeLeakage,
  canViewPortfolioSummary,
  normalizeAccessLevel,
  type AccessLevel,
} from '../utils/accessLevel'

const STORAGE_KEY = 'wfp-movate-session-v2'
const LEGACY_STORAGE_KEYS = ['wfp-movate-session-v1', 'wfp-demo-session-v1'] as const

export const DEMO_ACCOUNTS = [
  {
    email: 'test@demo.local',
    password: 'demo',
    name: 'Test User',
    accessLevel: 'admin' as const,
  },
  {
    email: 'ben@demo.local',
    password: 'demo',
    name: 'Ben',
    accessLevel: 'director' as const,
  },
  {
    email: 'marian@demo.local',
    password: 'demo',
    name: 'Marian',
    accessLevel: 'cap_planner' as const,
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
  allowedClients: string[]
}

type DemoSessionContextValue = {
  authenticated: boolean
  user: DemoUser | null
  accessLevel: AccessLevel | null
  allowedClients: string[]
  isAdmin: boolean
  canManageUsers: boolean
  canCreatePlans: boolean
  canEditCapacity: boolean
  canViewPortfolioSummary: boolean
  canViewDbeLeakage: boolean
  canEditFormulas: boolean
  sessionReady: boolean
  remoteBackend: boolean
  login: (email: string, password: string) => Promise<boolean>
  logout: () => Promise<void>
  refreshSessionUser: () => void
}

const DemoSessionContext = createContext<DemoSessionContextValue | null>(null)

function toDemoUser(user: ApiUser | DemoUser | ManagedUser): DemoUser {
  const accessLevel = normalizeAccessLevel(user.accessLevel)
  const allowed =
    'allowedClients' in user && Array.isArray(user.allowedClients) ? user.allowedClients : []
  return {
    name: user.name,
    email: user.email.trim().toLowerCase(),
    accessLevel,
    allowedClients: accessLevel === 'manager' ? allowed.map((c) => c.trim()).filter(Boolean) : [],
  }
}

function isActiveDirectoryUser(user: DemoUser | null): user is DemoUser {
  if (!user?.email) return false
  const managed = findManagedUserByEmail(user.email)
  return Boolean(managed?.active)
}

function resolveKnownUser(user: DemoUser): DemoUser {
  // Remote/DB sessions are authoritative — do not override with local directory.
  if (isRemoteBackend()) return user

  const managed = findManagedUserByEmail(user.email)
  if (managed) {
    return {
      name: managed.name,
      email: managed.email,
      accessLevel: managed.accessLevel,
      allowedClients: managed.allowedClients ?? [],
    }
  }
  const known = DEMO_ACCOUNTS.find((account) => account.email === user.email)
  return known
    ? {
        name: known.name,
        email: known.email,
        accessLevel: known.accessLevel,
        allowedClients: [],
      }
    : user
}

function loadLocalUser(): DemoUser | null {
  try {
    for (const key of LEGACY_STORAGE_KEYS) localStorage.removeItem(key)
    // Remote: session is the HttpOnly cookie + /auth/me — never restore from localStorage.
    if (isRemoteBackend()) {
      try {
        localStorage.removeItem(STORAGE_KEY)
      } catch {
        // ignore
      }
      return null
    }
    // Ensure directory exists before session restore.
    loadManagedUsers()
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const cleaned = raw.replace(/@movate\.com/gi, '@demo.local')
    if (cleaned !== raw) localStorage.setItem(STORAGE_KEY, cleaned)
    const parsed = JSON.parse(cleaned) as DemoUser
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
  // Remote sessions are cookie-backed; do not persist user profile in localStorage.
  if (isRemoteBackend()) {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
    return
  }
  if (user) localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
  else localStorage.removeItem(STORAGE_KEY)
}

function setAuthTokenSafe(): void {
  try {
    setAuthToken(null)
  } catch {
    // ignore
  }
}

export function DemoSessionProvider({
  children,
}: {
  children: ReactNode
  embeddedInMainApp?: boolean
}) {
  const remoteBackend = isRemoteBackend()
  const [user, setUser] = useState<DemoUser | null>(() => {
    loadManagedUsers()
    return loadLocalUser()
  })
  const [sessionReady, setSessionReady] = useState(!remoteBackend)

  useEffect(() => {
    if (!remoteBackend) {
      setSessionReady(true)
      return
    }

    installCapacityDocumentSync()

    void (async () => {
      try {
        const sessionUser = await apiGetSession()
        if (sessionUser) {
          const nextUser = toDemoUser(sessionUser)
          const known = resolveKnownUser(nextUser)
          saveLocalUser(known)
          setUser(known)
          try {
            pauseCapacityDocuments()
            clearLocalCapacityData()
            await hydrateCapacityDocuments()
          } catch (syncError) {
            console.warn('Loading saved plans was skipped:', syncError)
            resumeCapacityDocuments()
          }
          await hydrateClientRegistry()
        } else {
          saveLocalUser(null)
          setUser(null)
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
      const normalizedEmail = email.trim().toLowerCase()
      const normalizedPassword = password.trim()
      if (!normalizedEmail || !normalizedPassword) return false

      // Production / embedded: require a real DB session so users stay isolated.
      if (remoteBackend) {
        try {
          const result = await apiLogin(normalizedEmail, normalizedPassword)
          if (!result) return false
          try {
            pauseCapacityDocuments()
            clearLocalCapacityData()
            await hydrateCapacityDocuments()
          } catch (syncError) {
            console.warn('Loading saved plans was skipped after login:', syncError)
            resumeCapacityDocuments()
          }
          await hydrateClientRegistry()
          const nextUser = toDemoUser(result.user)
          saveLocalUser(nextUser)
          setUser(nextUser)
          return true
        } catch (error) {
          console.warn('Remote login failed:', error)
          throw error instanceof Error ? error : new Error('Remote login failed.')
        }
      }

      const managed = matchManagedUser(normalizedEmail, normalizedPassword)
      if (!managed) return false
      const nextUser = toDemoUser(managed)
      saveLocalUser(nextUser)
      setUser(nextUser)
      return true
    },
    [remoteBackend],
  )

  const logout = useCallback(async () => {
    if (remoteBackend) {
      try {
        await Promise.race([
          (async () => {
            try {
              // Last chance to land pending edits before the session token is dropped.
              await flushCapacityDocuments()
            } catch {
              // ignore sync failures on logout
            }
            try {
              await apiLogout()
            } catch {
              // ignore API failures on logout
            }
          })(),
          new Promise<void>((resolve) => {
            window.setTimeout(resolve, 1500)
          }),
        ])
      } catch {
        // Continue local logout.
      }
    }

    pauseCapacityDocuments()
    try {
      clearLocalCapacityData()
    } finally {
      resumeCapacityDocuments()
    }
    saveLocalUser(null)
    setAuthTokenSafe()
    setUser(null)
  }, [remoteBackend])

  const refreshSessionUser = useCallback(() => {
    if (remoteBackend) {
      void (async () => {
        try {
          const sessionUser = await apiGetSession()
          if (!sessionUser) {
            saveLocalUser(null)
            setUser(null)
            return
          }
          const next = toDemoUser(sessionUser)
          saveLocalUser(next)
          setUser(next)
        } catch {
          // keep current user on transient refresh failures
        }
      })()
      return
    }

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
  }, [remoteBackend])

  const accessLevel = user?.accessLevel ?? null
  const allowedClients = user?.allowedClients ?? []

  const value = useMemo(
    () => ({
      authenticated: Boolean(user),
      user,
      accessLevel,
      allowedClients,
      isAdmin: accessLevel === 'admin',
      canManageUsers: canManageUsers(accessLevel),
      canCreatePlans: canCreatePlans(accessLevel),
      canEditCapacity: canEditCapacity(accessLevel),
      canViewPortfolioSummary: canViewPortfolioSummary(accessLevel),
      canViewDbeLeakage: canViewDbeLeakage(accessLevel),
      canEditFormulas: canEditFormulas(accessLevel),
      sessionReady,
      remoteBackend,
      login,
      logout,
      refreshSessionUser,
    }),
    [user, accessLevel, allowedClients, sessionReady, remoteBackend, login, logout, refreshSessionUser],
  )

  return <DemoSessionContext.Provider value={value}>{children}</DemoSessionContext.Provider>
}

export function useDemoSession(): DemoSessionContextValue {
  const ctx = useContext(DemoSessionContext)
  if (!ctx) throw new Error('useDemoSession must be used within DemoSessionProvider')
  return ctx
}
