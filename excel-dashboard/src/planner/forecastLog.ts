import { collectPairs, scorePairs, type AccuracyScore } from './forecastAccuracy'

/**
 * A record of what was forecast, when, and how it turned out.
 *
 * Backtest accuracy answers "how well would this model have done on history it
 * was refitted against". It does not answer the question a client asks in a
 * QBR: *how good was the forecast you actually gave us last quarter?* Those
 * differ, because the real one includes the model you happened to pick, the
 * judgment you layered on, and the weeks nobody could have seen coming.
 *
 * So each applied forecast is snapshotted. As actuals arrive they are matched
 * back by week, and the resulting scores are the only honest measure of the
 * forecast a plan was actually built on.
 */

export type ForecastSnapshot = {
  id: string
  /** When the forecast was applied to the plan. */
  takenAt: string
  scenarioId: string
  metricId: string
  modelId: string
  modelLabel: string
  /** Whether judgment was layered on the model at the time. */
  adjusted: boolean
  /** week -> forecast value, as applied. */
  values: Record<string, number>
}

export type SnapshotScore = {
  snapshot: ForecastSnapshot
  /** Weeks with an actual to compare against. */
  matured: number
  /** Weeks still in the future. */
  pending: number
  score: AccuracyScore
}

const STORAGE_KEY = 'wfp-forecast-log-v1'

/**
 * Snapshots kept per scenario+driver.
 *
 * Bounded deliberately: this is a rolling record for review, not an archive, and
 * an unbounded log of weekly forecasts would eventually exhaust the storage
 * quota and take the rest of the workspace with it.
 */
const MAX_SNAPSHOTS_PER_DRIVER = 12

export type ForecastLog = Record<string, ForecastSnapshot[]>

function keyOf(scenarioId: string, metricId: string): string {
  return `${scenarioId}::${metricId}`
}

export function loadForecastLog(): ForecastLog {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as ForecastLog
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveForecastLog(log: ForecastLog): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(log))
  } catch {
    // The log is a convenience; losing it must never break a forecast run.
  }
}

export function getSnapshots(scenarioId: string, metricId: string): ForecastSnapshot[] {
  return loadForecastLog()[keyOf(scenarioId, metricId)] ?? []
}

/**
 * Record a forecast as applied.
 *
 * Repeated applications on the same day replace each other rather than stacking:
 * a planner adjusting an event three times in an afternoon produced one forecast
 * that day, not three, and keeping all of them would bury the history that
 * matters under noise.
 */
export function recordSnapshot(snapshot: Omit<ForecastSnapshot, 'id'>): ForecastLog {
  const log = loadForecastLog()
  const key = keyOf(snapshot.scenarioId, snapshot.metricId)
  const day = snapshot.takenAt.slice(0, 10)

  const existing = (log[key] ?? []).filter((item) => item.takenAt.slice(0, 10) !== day)
  const entry: ForecastSnapshot = { ...snapshot, id: `${day}_${snapshot.metricId}` }

  const next = [...existing, entry]
    .sort((a, b) => a.takenAt.localeCompare(b.takenAt))
    .slice(-MAX_SNAPSHOTS_PER_DRIVER)

  const updated = { ...log, [key]: next }
  saveForecastLog(updated)
  return updated
}

export function clearSnapshots(scenarioId: string, metricId: string): ForecastLog {
  const log = loadForecastLog()
  const next = { ...log }
  delete next[keyOf(scenarioId, metricId)]
  saveForecastLog(next)
  return next
}

/**
 * Score a snapshot against actuals that have arrived since.
 *
 * Only weeks with a real actual are scored. Weeks still in the future are
 * reported as pending rather than dropped, because "12 of 52 weeks have
 * matured" is the context that says how much the score is worth.
 */
export function scoreSnapshot(
  snapshot: ForecastSnapshot,
  actualsByWeek: Map<string, number>,
): SnapshotScore {
  const actual: number[] = []
  const predicted: number[] = []
  let pending = 0

  for (const [week, value] of Object.entries(snapshot.values)) {
    const observed = actualsByWeek.get(week)
    if (observed == null || !Number.isFinite(observed)) {
      pending += 1
      continue
    }
    actual.push(observed)
    predicted.push(value)
  }

  const pairs = collectPairs(actual, predicted)
  return {
    snapshot,
    matured: pairs.length,
    pending,
    score: pairs.length ? scorePairs(pairs, 1) : {},
  }
}

export function scoreSnapshots(
  snapshots: ForecastSnapshot[],
  actualsByWeek: Map<string, number>,
): SnapshotScore[] {
  return snapshots
    .map((snapshot) => scoreSnapshot(snapshot, actualsByWeek))
    .sort((a, b) => b.snapshot.takenAt.localeCompare(a.snapshot.takenAt))
}
