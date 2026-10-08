import { ACCESS_LEVEL_OPTIONS, normalizeAccessLevel, type AccessLevel } from '../utils/accessLevel'

const STORAGE_KEY = 'wfp-demo-users-v1'

/** Map a stored address off the retired account domain. */
export function rewriteLegacyBrandEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase().replace(/@wfmcommons\.com$/i, '@demo.local')
}

/** Rewrite stored labels that still use the retired account domain. */
export function scrubLegacyBrandLabels(): void {
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (!key) continue
      const value = localStorage.getItem(key)
      if (!value || !/wfmcommons/i.test(value)) continue
      const next = value
        .replace(/@wfmcommons\.com/gi, '@demo.local')
        .replace(/WFM Commons Demo/gi, 'Demo User')
        .replace(/WFM Commons/gi, 'Capacity Planning')
        .replace(/"wfmcommons"/gi, '"demo"')
      if (next !== value) localStorage.setItem(key, next)
    }
  } catch {
    /* storage may be unavailable */
  }
}

export const DEFAULT_ADMIN_EMAIL = 'admin@demo.local'
export const DEFAULT_DEMO_PASSWORD = 'demo'

export type ManagedUser = {
  id: string
  email: string
  name: string
  password: string
  accessLevel: AccessLevel
  active: boolean
  createdAt: string
}

/** Seeded logins. Admin can invite additional users from User management. */
export const SEED_USERS: ManagedUser[] = [
  {
    id: 'user-admin',
    email: DEFAULT_ADMIN_EMAIL,
    name: 'Admin',
    password: DEFAULT_DEMO_PASSWORD,
    accessLevel: 'admin',
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'user-demo',
    email: 'demo@demo.local',
    name: 'Demo User',
    password: DEFAULT_DEMO_PASSWORD,
    accessLevel: 'vp',
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
]

/** Former demo accounts — removed on load so they can no longer sign in. */
const REVOKED_DEMO_EMAILS = new Set([
  'admin@wfmcommons.com',
  'demo@wfmcommons.com',
  'user@wfmcommons.com',
  'marian@wfmcommons.com',
  'user01@wfmcommons.com',
  'user02@wfmcommons.com',
  'kouji@wfmcommons.com',
  'demo@capacity.app',
  'manager@capacity.app',
])

function normalizeUser(raw: Partial<ManagedUser> & { email: string }): ManagedUser {
  return {
    id: raw.id || `user-${raw.email.trim().toLowerCase()}`,
    email: raw.email.trim().toLowerCase(),
    name: (raw.name || raw.email).trim(),
    password: raw.password || DEFAULT_DEMO_PASSWORD,
    accessLevel: normalizeAccessLevel(raw.accessLevel),
    active: raw.active !== false,
    createdAt: raw.createdAt || new Date().toISOString(),
  }
}

export function loadManagedUsers(): ManagedUser[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      saveManagedUsers(SEED_USERS)
      return SEED_USERS.map((user) => ({ ...user }))
    }
    const parsed = JSON.parse(raw) as ManagedUser[]
    if (!Array.isArray(parsed) || !parsed.length) {
      saveManagedUsers(SEED_USERS)
      return SEED_USERS.map((user) => ({ ...user }))
    }
    let users = parsed
      .map((item) => normalizeUser(item))
      .filter((user) => !REVOKED_DEMO_EMAILS.has(user.email))

    for (const seed of SEED_USERS) {
      const index = users.findIndex((user) => user.email === seed.email)
      if (index < 0) {
        users.push({ ...seed })
      } else {
        // Keep seeded credentials authoritative.
        users[index] = {
          ...users[index],
          ...seed,
          password: seed.password,
          accessLevel: seed.accessLevel,
          active: true,
        }
      }
    }

    // Always keep at least the admin account.
    if (!users.some((user) => user.email === DEFAULT_ADMIN_EMAIL && user.active && user.accessLevel === 'admin')) {
      users = [{ ...SEED_USERS[0]! }, ...users.filter((user) => user.email !== DEFAULT_ADMIN_EMAIL)]
    }

    saveManagedUsers(users)
    return users
  } catch {
    return SEED_USERS.map((user) => ({ ...user }))
  }
}

export function saveManagedUsers(users: ManagedUser[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(users.map((user) => normalizeUser(user))))
}

export function matchManagedUser(email: string, password: string): ManagedUser | null {
  const normalizedEmail = email.trim().toLowerCase()
  const normalizedPassword = password.trim()
  const user = loadManagedUsers().find(
    (item) => item.active && item.email === normalizedEmail && item.password === normalizedPassword,
  )
  return user ?? null
}

export function findManagedUserByEmail(email: string): ManagedUser | null {
  const normalizedEmail = email.trim().toLowerCase()
  return loadManagedUsers().find((item) => item.email === normalizedEmail) ?? null
}

export function upsertManagedUser(input: {
  id?: string
  email: string
  name: string
  password: string
  accessLevel: AccessLevel
  active?: boolean
}): ManagedUser {
  const users = loadManagedUsers()
  const email = input.email.trim().toLowerCase()
  const existing = input.id
    ? users.find((item) => item.id === input.id)
    : users.find((item) => item.email === email)

  if (existing) {
    const next: ManagedUser = {
      ...existing,
      email,
      name: input.name.trim() || email,
      password: input.password.trim() || existing.password,
      accessLevel: normalizeAccessLevel(input.accessLevel),
      active: input.active ?? existing.active,
    }
    saveManagedUsers(users.map((item) => (item.id === existing.id ? next : item)))
    return next
  }

  const created: ManagedUser = normalizeUser({
    id: `user-${Date.now()}`,
    email,
    name: input.name,
    password: input.password,
    accessLevel: input.accessLevel,
    active: input.active ?? true,
    createdAt: new Date().toISOString(),
  })
  saveManagedUsers([...users, created])
  return created
}

export function setManagedUserActive(userId: string, active: boolean): ManagedUser | null {
  const users = loadManagedUsers()
  const target = users.find((item) => item.id === userId)
  if (!target) return null
  const next = { ...target, active }
  saveManagedUsers(users.map((item) => (item.id === userId ? next : item)))
  return next
}

export function deleteManagedUser(userId: string): boolean {
  const users = loadManagedUsers()
  const next = users.filter((item) => item.id !== userId)
  if (next.length === users.length) return false
  if (!next.some((item) => item.active && item.accessLevel === 'admin')) return false
  saveManagedUsers(next)
  return true
}

export { ACCESS_LEVEL_OPTIONS }
