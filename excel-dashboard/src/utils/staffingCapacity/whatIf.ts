import type { StaffingEnrichedRow, StaffingPlanRow, StaffingWhatIfInput } from './types'
import { enrichStaffingRow, toShrinkFraction } from './leakage'

function clonePlan(r: StaffingPlanRow): StaffingPlanRow {
  return { ...r }
}

/** Distribute `total` across rows with positive weights; if no weights, split evenly. */
function distributeByWeight(
  rows: StaffingPlanRow[],
  total: number,
  weightFn: (r: StaffingPlanRow) => number,
): number[] {
  if (!rows.length || total === 0) return rows.map(() => 0)
  const w = rows.map(weightFn)
  const sum = w.reduce((a, b) => a + b, 0)
  if (sum <= 0) return rows.map(() => total / rows.length)
  return w.map((x) => (total * x) / sum)
}

export function simulateWhatIf(rows: StaffingPlanRow[], input: StaffingWhatIfInput): StaffingEnrichedRow[] {
  const n = rows.length
  if (!n) return []

  const copies = rows.map(clonePlan)

  const shortageIdx = copies
    .map((r, i) => ({ i, gap: r.requiredHc != null && r.activeProdHc != null ? Math.max(r.requiredHc - r.activeProdHc, 0) : 0 }))
    .filter((x) => x.gap > 0)
  const shortageRows = shortageIdx.map((x) => copies[x.i]!)
  const distHc = distributeByWeight(
    shortageRows.length ? shortageRows : copies,
    input.addHc,
    (r) => {
      const g = r.requiredHc != null && r.activeProdHc != null ? Math.max(r.requiredHc - r.activeProdHc, 0) : 0
      return g > 0 ? g : 1
    },
  )
  if (shortageIdx.length) {
    shortageIdx.forEach((x, j) => {
      const r = copies[x.i]!
      const add = distHc[j] ?? 0
      if (r.activeProdHc != null) r.activeProdHc = r.activeProdHc + add
      else r.activeProdHc = add
    })
  } else {
    const even = input.addHc / n
    for (const r of copies) {
      if (r.activeProdHc != null) r.activeProdHc = r.activeProdHc + even
      else r.activeProdHc = even
    }
  }

  const shrinkDelta = input.shrinkPctPointReduction / 100
  for (const r of copies) {
    const rawAct = r.actualShrinkPct
    const act = toShrinkFraction(rawAct)
    if (act != null) {
      const pl = toShrinkFraction(r.plannedShrinkPct)
      let nextFrac = act - shrinkDelta
      if (pl != null) nextFrac = Math.max(nextFrac, pl)
      const wasPctStyle = rawAct != null && rawAct > 1
      r.actualShrinkPct = wasPctStyle ? nextFrac * 100 : nextFrac
    }
    r.actualInOfficeShrinkPct = null
    r.actualOutOfficeShrinkPct = null
  }

  for (const r of copies) {
    if (r.actualAht == null) continue
    r.actualAht = Math.max(0, r.actualAht - input.ahtReductionSeconds)
  }

  const attrDist = distributeByWeight(
    copies,
    input.attritionReduction,
    (r) => {
      if (r.plannedAttrition == null || r.actualAttrition == null) return 0
      return Math.max(r.actualAttrition - r.plannedAttrition, 0)
    },
  )
  copies.forEach((r, i) => {
    if (r.actualAttrition == null) return
    const d = attrDist[i] ?? 0
    r.actualAttrition = Math.max(0, r.actualAttrition - d)
  })

  const volDist = distributeByWeight(
    copies,
    input.handledVolumeAdd,
    (r) => (r.forecastVolume != null && r.forecastVolume > 0 ? r.forecastVolume : 1),
  )
  copies.forEach((r, i) => {
    if (r.actualHandledVolume == null) return
    r.actualHandledVolume = r.actualHandledVolume + (volDist[i] ?? 0)
  })

  const rateMult = 1 + input.rateMultiplierPct / 100
  if (rateMult !== 1) {
    for (const r of copies) {
      if (r.billingRate != null && Number.isFinite(r.billingRate)) r.billingRate = r.billingRate * rateMult
      else if (r.rate != null && Number.isFinite(r.rate)) r.rate = r.rate * rateMult
    }
  }

  return copies.map((r) => enrichStaffingRow(r))
}

export function sumLeakage(rows: StaffingEnrichedRow[]): number {
  let s = 0
  for (const r of rows) {
    if (r.totalRevenueLeakage != null && Number.isFinite(r.totalRevenueLeakage)) s += r.totalRevenueLeakage
  }
  return s
}
