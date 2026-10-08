import { tryCoerceDate } from '../inferTypes'
import { locationHcBucket } from '../idealStaffingLocationTotals'
import type { StaffingEnrichedRow } from './types'

export type SupportRoleTotals = {
  tls: number
  opsMgrs: number
  trainers: number
  qas: number
  wfms: number
}

export type TrainingPipelineTotals = {
  newHires: number
  training: number
  graduates: number
}

function sumField(
  rows: StaffingEnrichedRow[],
  pick: (r: StaffingEnrichedRow) => number | null | undefined,
): number {
  let s = 0
  for (const r of rows) {
    const v = pick(r)
    if (v != null && Number.isFinite(v)) s += v
  }
  return s
}

/** Latest Sunday week key in the row set (for headcount snapshot). */
export function latestWeekStartDate(rows: StaffingEnrichedRow[]): string | null {
  let latest: string | null = null
  let latestMs = -Infinity
  for (const r of rows) {
    const w = String(r.weekStartDate ?? '').trim()
    if (!w) continue
    const d = tryCoerceDate(w)
    const ms = d && !Number.isNaN(d.getTime()) ? d.getTime() : NaN
    if (Number.isFinite(ms) && ms >= latestMs) {
      latestMs = ms
      latest = w
    }
  }
  return latest
}

/** One row per program for the latest filtered week (avoids multiplying HC across weeks). */
export function headcountSnapshotRows(rows: StaffingEnrichedRow[]): StaffingEnrichedRow[] {
  const week = latestWeekStartDate(rows)
  if (!week) return rows
  return rows.filter((r) => String(r.weekStartDate ?? '').trim() === week)
}

export function locationMatchesFilter(rowLocation: string, filterLocation: string): boolean {
  const f = filterLocation.trim()
  if (!f) return true
  const rowBucket = locationHcBucket(rowLocation)
  const filterBucket = locationHcBucket(f)
  if (rowBucket && filterBucket && rowBucket === filterBucket) return true
  return rowLocation.trim().toLowerCase() === f.toLowerCase()
}

export function sumSupportRoles(
  rows: StaffingEnrichedRow[],
  locationFilter: string,
): SupportRoleTotals {
  const snapshot = headcountSnapshotRows(rows)
  const scoped = snapshot.filter((r) => locationMatchesFilter(r.location, locationFilter))
  return {
    tls: sumField(scoped, (r) => r.tlCount),
    opsMgrs: sumField(scoped, (r) => r.opsManagerCount),
    trainers: sumField(scoped, (r) => r.trainerCount),
    qas: sumField(scoped, (r) => r.qaCount),
    wfms: sumField(scoped, (r) => r.wfmSupportCount),
  }
}

export function sumTrainingPipeline(
  rows: StaffingEnrichedRow[],
  locationFilter: string,
): TrainingPipelineTotals {
  const snapshot = headcountSnapshotRows(rows)
  const scoped = snapshot.filter((r) => locationMatchesFilter(r.location, locationFilter))
  return {
    newHires: sumField(scoped, (r) => r.newHireCount),
    training: sumField(scoped, (r) => r.trainingCount),
    graduates: sumField(scoped, (r) => r.graduateCount),
  }
}
