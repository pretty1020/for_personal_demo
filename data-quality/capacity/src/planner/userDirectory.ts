import { ACCESS_LEVEL_OPTIONS, normalizeAccessLevel, type AccessLevel } from '../utils/accessLevel'

const STORAGE_KEY = 'wfp-movate-users-v1'

export type ManagedUser = {
  id: string
  email: string
  name: string
  password: string
  accessLevel: AccessLevel
  active: boolean
  createdAt: string
  /** Manager-only client grants. Empty = no clients. */
  allowedClients: string[]
}

export const SEED_USERS: ManagedUser[] = [
  {
    id: 'user-test',
    email: 'test@demo.local',
    name: 'Test User',
    password: 'demo',
    accessLevel: 'admin',
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    allowedClients: [],
  },
  {
    id: 'user-ben',
    email: 'ben@demo.local',
    name: 'Ben',
    password: 'demo',
    accessLevel: 'director',
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    allowedClients: [],
  },
  {
    id: 'user-marian',
    email: 'marian@demo.local',
    name: 'Marian',
    password: 'demo',
    accessLevel: 'cap_planner',
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    allowedClients: [],
  },
]

function normalizeAllowedClients(raw: unknown, accessLevel: AccessLevel): string[] {
  if (accessLevel !== 'manager') return []
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const name = item.trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

function stripLegacyBrand(value: string): string {
  return value.replace(/@movate\.com/gi, '@demo.local')
}

function normalizeUser(raw: Partial<ManagedUser> & { email: string }): ManagedUser {
  const accessLevel = normalizeAccessLevel(raw.accessLevel)
  const email = stripLegacyBrand(raw.email.trim().toLowerCase())
  return {
    id: raw.id || `user-${email}`,
    email,
    name: stripLegacyBrand((raw.name || raw.email).trim()),
    password: raw.password === 'movate' ? 'demo' : raw.password || 'demo',
    accessLevel,
    active: raw.active !== false,
    createdAt: raw.createdAt || new Date().toISOString(),
    allowedClients: normalizeAllowedClients(raw.allowedClients, accessLevel),
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
    const users = parsed.map((item) => normalizeUser(item))
    const stored = JSON.stringify(parsed)
    if (stored.includes('@movate.com') || stored.includes('@Movate.com') || stored.includes('"password":"movate"')) {
      saveManagedUsers(users)
    }
    // Keep at least one active admin so local mode stays usable after bad edits.
    if (!users.some((user) => user.active && user.accessLevel === 'admin')) {
      const adminSeed = SEED_USERS.find((user) => user.accessLevel === 'admin')!
      const index = users.findIndex((user) => user.email === adminSeed.email)
      if (index >= 0) users[index] = { ...users[index], ...adminSeed, active: true }
      else users.push({ ...adminSeed })
      saveManagedUsers(users)
    }
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
  allowedClients?: string[]
}): ManagedUser {
  const users = loadManagedUsers()
  const email = input.email.trim().toLowerCase()
  const existing = input.id
    ? users.find((item) => item.id === input.id)
    : users.find((item) => item.email === email)

  if (existing) {
    const nextPassword = input.password.trim() || existing.password
    if (nextPassword.length < 6) {
      throw new Error('Password must be at least 6 characters.')
    }
    const accessLevel = normalizeAccessLevel(input.accessLevel)
    const next: ManagedUser = {
      ...existing,
      email,
      name: input.name.trim() || email,
      password: nextPassword,
      accessLevel,
      active: input.active ?? existing.active,
      allowedClients: normalizeAllowedClients(
        input.allowedClients !== undefined ? input.allowedClients : existing.allowedClients,
        accessLevel,
      ),
    }
    if (
      existing.active &&
      existing.accessLevel === 'admin' &&
      (next.accessLevel !== 'admin' || !next.active) &&
      !users.some((item) => item.id !== existing.id && item.active && item.accessLevel === 'admin')
    ) {
      throw new Error('Keep at least one active admin account.')
    }
    saveManagedUsers(users.map((item) => (item.id === existing.id ? next : item)))
    return next
  }

  const password = input.password.trim()
  if (password.length < 6) {
    throw new Error('Password must be at least 6 characters.')
  }

  const created: ManagedUser = normalizeUser({
    id: `user-${Date.now()}`,
    email,
    name: input.name,
    password,
    accessLevel: input.accessLevel,
    active: input.active ?? true,
    createdAt: new Date().toISOString(),
    allowedClients: input.allowedClients,
  })
  saveManagedUsers([...users, created])
  return created
}

export function setManagedUserActive(userId: string, active: boolean): ManagedUser | null {
  const users = loadManagedUsers()
  const target = users.find((item) => item.id === userId)
  if (!target) return null
  if (
    !active &&
    target.active &&
    target.accessLevel === 'admin' &&
    !users.some((item) => item.id !== userId && item.active && item.accessLevel === 'admin')
  ) {
    return null
  }
  const next = { ...target, active }
  saveManagedUsers(users.map((item) => (item.id === userId ? next : item)))
  return next
}

export function deleteManagedUser(userId: string): boolean {
  const users = loadManagedUsers()
  const next = users.filter((item) => item.id !== userId)
  if (next.length === users.length) return false
  // Keep at least one admin active.
  if (!next.some((item) => item.active && item.accessLevel === 'admin')) return false
  saveManagedUsers(next)
  return true
}

export { ACCESS_LEVEL_OPTIONS }
