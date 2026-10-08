const STORAGE_KEY = 'wfp-capacity-driver-week-locks-v1'

export type DriverWeekLockStore = Record<string, string[]>

export function loadDriverWeekLocks(): DriverWeekLockStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as DriverWeekLockStore
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function saveDriverWeekLocks(store: DriverWeekLockStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
}

export function isDriverWeekLocked(scenarioId: string, week: string, store: DriverWeekLockStore = loadDriverWeekLocks()): boolean {
  return (store[scenarioId] ?? []).includes(week)
}

export function lockDriverWeek(scenarioId: string, week: string): DriverWeekLockStore {
  const store = loadDriverWeekLocks()
  const locked = new Set(store[scenarioId] ?? [])
  locked.add(week)
  const next = { ...store, [scenarioId]: [...locked] }
  saveDriverWeekLocks(next)
  return next
}

export function unlockDriverWeek(scenarioId: string, week: string): DriverWeekLockStore {
  const store = loadDriverWeekLocks()
  const nextWeeks = (store[scenarioId] ?? []).filter((item) => item !== week)
  const next = { ...store }
  if (nextWeeks.length) next[scenarioId] = nextWeeks
  else delete next[scenarioId]
  saveDriverWeekLocks(next)
  return next
}

export function clearScenarioDriverWeekLocks(scenarioId: string): DriverWeekLockStore {
  const store = loadDriverWeekLocks()
  const next = { ...store }
  delete next[scenarioId]
  saveDriverWeekLocks(next)
  return next
}

export function clearUnlockedFutureWeeks(scenarioId: string, planStartWeek: string): DriverWeekLockStore {
  const store = loadDriverWeekLocks()
  const locked = (store[scenarioId] ?? []).filter((week) => week <= planStartWeek)
  const next = { ...store }
  if (locked.length) next[scenarioId] = locked
  else delete next[scenarioId]
  saveDriverWeekLocks(next)
  return next
}
