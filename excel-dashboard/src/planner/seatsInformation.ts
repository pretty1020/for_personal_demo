import { scenarioOnsiteWah, scenarioSeatDemand, scenarioSeatUtilization } from './seatScenario'

/** Seat chain from the capacity-calculation slide. Pure math, no React. */

export type ShiftModel = '24x7' | 'two-shift' | 'single-shift'
export type SeatStatus = 'green' | 'amber' | 'red'
export type SeatView = 'physical' | 'virtual' | 'combined'

export type MatrixField = {
  /** Capacity Matrix row id, when one exists. */
  field: string | null
  label: string
  missing: boolean
}

export type SeatSources = {
  totalHc: MatrixField
  volume: MatrixField
  ahtSeconds: MatrixField
  occupancy: MatrixField
  shrinkage: MatrixField
  productiveHours: MatrixField
  seatCount: MatrixField
  supportHc: MatrixField
  physicalCost: MatrixField
  virtualCost: MatrixField
  onsitePct: MatrixField
  peakShiftPct: MatrixField
  overlapPct: MatrixField
  bufferPct: MatrixField
  wahPct: MatrixField
}

export type SeatLevers = {
  totalHc: number
  volume: number
  ahtSeconds: number
  occupancy: number
  shrinkage: number
  onsitePct: number
  peakShiftPct: number
  overlapPct: number
  bufferPct: number
  wahPct: number
  supportRatio: number
  shiftModel: ShiftModel
  physicalWeeklyCost: number
  virtualWeeklyCost: number
  /** Set only when the user overrides the 40-hour productive-hour definition. */
  productiveHours: number | null
  /** Physical seats already on the matrix. Null when the plan has no seat count. */
  matrixSeatCount: number | null
}

export type ShiftMix = { name: string; agents: number }

export type WeekOutlook = {
  label: string
  week: string
  totalHc: number
  demandSeats: number | null
  availableSeats: number | null
  virtualAgents: number | null
  onsiteHc: number | null
  onsitePct: number | null
  wahHc: number | null
  wahPct: number | null
  peakRatioPct: number | null
  supportHc: number | null
  utilization: number | null
  /** Available − demand. Negative means the site is short of seats. */
  variance: number | null
  gap: number
}

export type SeatChain = {
  requiredFte: number
  onsiteHc: number
  scheduledPerDay: number
  peakShift: number
  afterOverlap: number
  afterSupport: number
  seats: number
  overlapDelta: number
  supportDelta: number
  bufferDelta: number
  deskRatio: number
  avoidedSeats: number
  occupiedSeatHours: number
  operatingHours: number
  utilization: number
  workloadHours: number
  productiveHoursPerFte: number
  physicalProductiveHours: number
  virtualProductiveHours: number
  daysOpen: number
  physicalSeats: number
  virtualSeats: number
  physicalCostPerHour: number
  virtualCostPerHour: number
  shifts: ShiftMix[]
  statuses: Record<'A' | 'B' | 'C' | 'D' | 'E', SeatStatus>
}

/** Paid hours in one FTE week. An 8-hour shift, five shifts. */
export const HOURS_PER_FTE_WEEK = 40
export const SHIFT_LENGTH_HOURS = 8

export const SHIFT_TARGETS: Record<
  ShiftModel,
  { label: string; target: number; openHoursPerDay: number; daysOpen: number }
> = {
  '24x7': { label: '24×7', target: 2.3, openHoursPerDay: 24, daysOpen: 7 },
  'two-shift': { label: 'Two-shift', target: 1.8, openHoursPerDay: 16, daysOpen: 5 },
  'single-shift': { label: 'Single-shift', target: 1.1, openHoursPerDay: 8, daysOpen: 5 },
}

export const SLIDE_DEFAULTS: SeatLevers = {
  totalHc: 1200,
  volume: 416160,
  ahtSeconds: 300,
  occupancy: 0.85,
  shrinkage: 0.15,
  onsitePct: 0.6,
  peakShiftPct: 0.45,
  overlapPct: 0.1,
  bufferPct: 0.05,
  wahPct: 0.4,
  supportRatio: 12,
  shiftModel: '24x7',
  physicalWeeklyCost: 42000,
  virtualWeeklyCost: 18000,
  productiveHours: null,
  matrixSeatCount: null,
}

/** Remainder of a 24×7 day after the peak shift, split in the slide's 180:103 ratio. */
const OFF_PEAK_B = 35
const OFF_PEAK_C = 20

/**
 * 24×7 covers the day with three shifts. Two-shift uses the peak and the rest of the day.
 * Single-shift puts everyone scheduled that day on one shift.
 */
export function shiftMix(model: ShiftModel, scheduledPerDay: number, peakShift: number, peakPct: number): ShiftMix[] {
  const day = Math.max(0, scheduledPerDay)
  const peak = Math.max(0, Math.min(peakShift, day))
  if (model === 'single-shift') return [{ name: 'Shift A', agents: day }]
  if (model === 'two-shift') {
    return [
      { name: 'Shift A', agents: peak },
      { name: 'Shift B', agents: day - peak },
    ]
  }
  const offPeak = Math.max(0, 1 - clamp01(peakPct))
  const offPeakShare = OFF_PEAK_B + OFF_PEAK_C
  return [
    { name: 'Shift A', agents: peak },
    { name: 'Shift B', agents: roundInt(day * offPeak * (OFF_PEAK_B / offPeakShare)) },
    { name: 'Shift C', agents: roundInt(day * offPeak * (OFF_PEAK_C / offPeakShare)) },
  ]
}
const COMPLIANCE_WAH_CAP = 0.7

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

export function roundInt(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value)
}

/** Share of the weekly roster present on an average open day. 40 ÷ (8 × days open). */
export function dailyCoverageFactor(model: ShiftModel): number {
  return HOURS_PER_FTE_WEEK / (SHIFT_LENGTH_HOURS * SHIFT_TARGETS[model].daysOpen)
}

export function weeklyOperatingHours(model: ShiftModel, seats: number): number {
  const spec = SHIFT_TARGETS[model]
  return Math.max(seats, 0) * spec.openHoursPerDay * spec.daysOpen
}

/**
 * Required FTE = workload hours ÷ hours one FTE can handle.
 * Workload hours = Volume × (AHT ÷ 3,600).
 * Handle hours per FTE = 40 × Occupancy × (1 − Shrinkage).
 * Shrinkage and occupancy reduce available handle time, so both sit in the divisor.
 */
export function requiredFte(volume: number, ahtSeconds: number, occupancy: number, shrinkage: number): number {
  const occ = Math.max(clamp01(occupancy), 0.01)
  const available = Math.max(1 - clamp01(shrinkage), 0.01)
  const workloadHours = Math.max(0, volume) * (Math.max(0, ahtSeconds) / 3600)
  return workloadHours / (HOURS_PER_FTE_WEEK * occ * available)
}

export function productiveHoursPerFte(occupancy: number, shrinkage: number): number {
  const occ = Math.max(clamp01(occupancy), 0)
  const available = Math.max(1 - clamp01(shrinkage), 0)
  return HOURS_PER_FTE_WEEK * occ * available
}

export function computeSeatChain(levers: SeatLevers): SeatChain {
  const onsitePct = clamp01(levers.onsitePct)
  const peakPct = clamp01(levers.peakShiftPct)
  const overlap = Math.max(0, levers.overlapPct)
  const buffer = Math.max(0, levers.bufferPct)
  const ratio = Math.max(1, levers.supportRatio)
  const onsiteHc = roundInt(Math.max(0, levers.totalHc) * onsitePct)
  const scheduledPerDay = roundInt(onsiteHc * dailyCoverageFactor(levers.shiftModel))
  const peakShift = roundInt(scheduledPerDay * peakPct)
  const afterOverlap = roundInt(peakShift * (1 + overlap))
  const afterSupport = roundInt(afterOverlap * (1 + 1 / ratio))
  const seats = roundInt(afterSupport * (1 + buffer))
  const safeSeats = Math.max(seats, 1)
  const deskRatio = onsiteHc / safeSeats
  const shrink = clamp01(levers.shrinkage)
  const occ = clamp01(levers.occupancy)
  const occupiedSeatHours = onsiteHc * HOURS_PER_FTE_WEEK * (1 - shrink)
  const operatingHours = Math.max(weeklyOperatingHours(levers.shiftModel, safeSeats), 1)
  const utilization = occupiedSeatHours / operatingHours
  const virtualSeats = roundInt(Math.max(0, levers.totalHc) * clamp01(levers.wahPct))
  const hoursPerFte = productiveHoursPerFte(occ, shrink)
  const derivedPhysicalHours = Math.max(onsiteHc * hoursPerFte, 1)
  const derivedVirtualHours = Math.max(virtualSeats * hoursPerFte, 1)
  const physicalHours = levers.productiveHours != null && levers.productiveHours > 0 ? levers.productiveHours : derivedPhysicalHours
  const physicalCostPerHour = Math.max(0, levers.physicalWeeklyCost) / physicalHours
  const virtualCostPerHour = virtualSeats > 0 ? Math.max(0, levers.virtualWeeklyCost) / derivedVirtualHours : 0
  const shifts = shiftMix(levers.shiftModel, scheduledPerDay, peakShift, peakPct)
  const chain: SeatChain = {
    requiredFte: requiredFte(levers.volume, levers.ahtSeconds, levers.occupancy, levers.shrinkage),
    workloadHours: Math.max(0, levers.volume) * (Math.max(0, levers.ahtSeconds) / 3600),
    onsiteHc,
    scheduledPerDay,
    peakShift,
    afterOverlap,
    afterSupport,
    seats,
    overlapDelta: afterOverlap - peakShift,
    supportDelta: afterSupport - afterOverlap,
    bufferDelta: seats - afterSupport,
    deskRatio,
    avoidedSeats: onsiteHc - seats,
    occupiedSeatHours,
    operatingHours,
    utilization,
    productiveHoursPerFte: hoursPerFte,
    physicalProductiveHours: physicalHours,
    virtualProductiveHours: derivedVirtualHours,
    daysOpen: SHIFT_TARGETS[levers.shiftModel].daysOpen,
    physicalSeats: seats,
    virtualSeats,
    physicalCostPerHour,
    virtualCostPerHour,
    shifts,
    statuses: { A: 'amber', B: 'amber', C: 'amber', D: 'amber', E: 'amber' },
  }
  chain.statuses = {
    A: fteStatus(chain.requiredFte, levers.totalHc),
    B: peakStatus(chain.avoidedSeats, onsiteHc),
    C: deskStatus(deskRatio, levers.shiftModel),
    D: utilizationStatus(utilization),
    E: costStatus(physicalCostPerHour, virtualCostPerHour, levers.wahPct),
  }
  return chain
}

export function fteStatus(required: number, headcount: number): SeatStatus {
  if (required <= 0 || headcount <= 0) return 'amber'
  const ratio = headcount / required
  if (ratio >= 0.95 && ratio <= 1.08) return 'green'
  if (ratio >= 0.85 && ratio <= 1.2) return 'amber'
  return 'red'
}

export function peakStatus(avoided: number, onsiteHc: number): SeatStatus {
  if (onsiteHc <= 0) return 'amber'
  if (avoided <= 0) return 'red'
  if (avoided / onsiteHc >= 0.2) return 'green'
  return 'amber'
}

export function deskStatus(ratio: number, model: ShiftModel): SeatStatus {
  const target = SHIFT_TARGETS[model].target
  if (model === 'single-shift') {
    const gap = Math.abs(ratio - target)
    if (gap <= 0.15) return 'green'
    if (gap <= 0.35) return 'amber'
    return 'red'
  }
  if (ratio >= target) return 'green'
  if (ratio >= target * 0.9) return 'amber'
  return 'red'
}

export function utilizationStatus(utilization: number): SeatStatus {
  const pct = utilization * 100
  if (pct >= 80 && pct <= 92) return 'green'
  if (pct < 70 || pct > 95) return 'red'
  return 'amber'
}

export function costStatus(physical: number, virtual: number, wahPct: number): SeatStatus {
  if (wahPct > COMPLIANCE_WAH_CAP) return 'red'
  if (virtual < physical && wahPct > 0) return 'green'
  if (virtual > physical && wahPct > 0.2) return 'red'
  return 'amber'
}

export function deskRatioByModel(ratio: number): Array<{ model: ShiftModel; label: string; ratio: number; target: number; status: SeatStatus }> {
  return (Object.keys(SHIFT_TARGETS) as ShiftModel[]).map((model) => ({
    model,
    label: SHIFT_TARGETS[model].label,
    ratio,
    target: SHIFT_TARGETS[model].target,
    status: deskStatus(ratio, model),
  }))
}

export type OutlookPoint = {
  week: string
  label: string
  totalHc: number
  availableSeats: number | null
  /** Week-specific plan drivers. Omitted values keep the current what-if levers. */
  shrinkage?: number
  occupancy?: number
  volume?: number
  ahtSeconds?: number
  /** Capacity seats metrics. When peak ratio is provided, demand uses the scenario formula. */
  peakRatioPct?: number | null
  supportHc?: number | null
  onsiteHc?: number | null
  wahHc?: number | null
  /** Precomputed scenario demand. Used when LOBs are summed week by week. */
  demandSeats?: number | null
}

/** Project seat demand across weeks. Blank capacity inputs stay blank. */
export function buildOutlook(levers: SeatLevers, points: OutlookPoint[]): WeekOutlook[] {
  return points.map((point) => {
    const weekLevers = {
      ...levers,
      totalHc: point.totalHc,
      ...(point.shrinkage != null ? { shrinkage: point.shrinkage } : {}),
      ...(point.occupancy != null ? { occupancy: point.occupancy } : {}),
      ...(point.volume != null ? { volume: point.volume } : {}),
      ...(point.ahtSeconds != null ? { ahtSeconds: point.ahtSeconds } : {}),
    }
    const chain = computeSeatChain(weekLevers)
    const fromScenario = point.peakRatioPct !== undefined || point.supportHc !== undefined || point.demandSeats !== undefined
    const split = scenarioOnsiteWah(point.totalHc, point.onsiteHc, point.wahHc)
    const demand = point.demandSeats !== undefined
      ? point.demandSeats
      : fromScenario
        ? scenarioSeatDemand(point.totalHc, point.peakRatioPct, point.supportHc, point.onsiteHc)
        : chain.seats
    const available = point.availableSeats != null ? Math.max(0, point.availableSeats) : null
    const variance = available != null && demand != null ? available - demand : null
    const shrink = fromScenario ? (point.shrinkage ?? null) : (point.shrinkage != null ? point.shrinkage : levers.shrinkage)
    return {
      label: point.label,
      week: point.week,
      totalHc: point.totalHc,
      demandSeats: demand,
      availableSeats: available,
      virtualAgents: fromScenario ? split.wahHc : chain.virtualSeats,
      onsiteHc: fromScenario ? split.onsiteHc : chain.onsiteHc,
      onsitePct: fromScenario ? split.onsitePct : (point.totalHc > 0 ? chain.onsiteHc / point.totalHc : null),
      wahHc: fromScenario ? split.wahHc : chain.virtualSeats,
      wahPct: fromScenario ? split.wahPct : (point.totalHc > 0 ? chain.virtualSeats / point.totalHc : null),
      peakRatioPct: point.peakRatioPct ?? null,
      supportHc: point.supportHc ?? null,
      utilization: scenarioSeatUtilization(fromScenario ? split.onsiteHc : chain.onsiteHc, shrink, available, levers.shiftModel),
      variance,
      gap: variance == null ? 0 : -variance,
    }
  })
}

export function missedSeatsPhrase(avoided: number): string {
  const rounded = Math.round(avoided / 10) * 10
  return `~${rounded.toLocaleString('en-US')}`
}

export function toCsv(
  levers: SeatLevers,
  chain: SeatChain,
  outlook: WeekOutlook[],
  sources: SeatSources,
  remarks: string[] = [],
): string {
  const lines = ['section,name,value,matrix_field,missing']
  const push = (section: string, name: string, value: string | number, field = '', missing = '') => {
    lines.push([section, name, value, field, missing].map(csvCell).join(','))
  }
  ;(Object.keys(sources) as (keyof SeatSources)[]).forEach((key) => {
    const source = sources[key]
    const raw = levers[key as keyof SeatLevers]
    push('input', source.label, raw == null ? '' : String(raw), source.field ?? '', source.missing ? 'yes' : 'no')
  })
  push('result', 'Required FTE', chain.requiredFte.toFixed(1))
  push('result', 'Onsite headcount', chain.onsiteHc)
  push('result', 'Scheduled per day', chain.scheduledPerDay)
  push('result', 'Peak shift', chain.peakShift)
  push('result', 'After overlap', chain.afterOverlap)
  push('result', 'After support', chain.afterSupport)
  push('result', 'Physical seats', chain.seats)
  push('result', 'Desk ratio', chain.deskRatio.toFixed(2))
  push('result', 'Seat utilization', `${(chain.utilization * 100).toFixed(1)}%`)
  push('result', 'Virtual seats', chain.virtualSeats)
  chain.shifts.forEach((shift) => push('shift', shift.name, shift.agents))
  outlook.forEach((week, index) => {
    push(
      'outlook',
      week.label,
      `${week.totalHc}|${week.onsiteHc}|${week.onsitePct ?? ''}|${week.wahHc}|${week.wahPct ?? ''}|${week.peakRatioPct ?? ''}|${week.supportHc ?? ''}|${week.demandSeats ?? ''}|${week.availableSeats ?? ''}|${week.variance ?? ''}|${week.utilization ?? ''}|${remarks[index] ?? ''}`,
    )
  })
  return lines.join('\n')
}

function csvCell(value: string | number): string {
  const text = String(value)
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export function formatNumber(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })
}

export function formatPct(fraction: number): string {
  return `${formatNumber(fraction * 100, fraction * 100 % 1 === 0 ? 0 : 1)}%`
}
