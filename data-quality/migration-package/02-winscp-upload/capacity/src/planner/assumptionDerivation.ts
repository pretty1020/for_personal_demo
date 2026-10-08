import type { PlannerAssumptions, PlannerPlanMetadata } from './types'
import { getTotalStartingProductionHc } from './channelPlanning'

/** Keep productive hours aligned with schedule, shrinkage, occupancy, and productivity inputs. */
export function syncDerivedTenuredFields(a: PlannerAssumptions, plan?: PlannerPlanMetadata): PlannerAssumptions {
  const t = a.tenured
  const productiveHoursPerFtePerWeek =
    t.standardScheduledHoursPerWeek * (1 - t.shrinkageRate)
  return {
    ...a,
    tenured: {
      ...t,
      productiveHoursPerFtePerWeek: +productiveHoursPerFtePerWeek.toFixed(2),
      beginningProductionHeadcount: plan
        ? getTotalStartingProductionHc(a, plan)
        : t.beginningProductionHeadcount,
    },
  }
}

/** Sync LOB-level beginning HC from per-channel starting production HC. */
export function syncChannelDerivedFields(
  a: PlannerAssumptions,
  plan: PlannerPlanMetadata,
): PlannerAssumptions {
  return syncDerivedTenuredFields(a, plan)
}

/** Align monthly revenue target with base volume × revenue per contact. */
export function syncBusinessDerivedFields(a: PlannerAssumptions): PlannerAssumptions {
  const b = a.business
  return {
    ...a,
    business: {
      ...b,
      revenueTargetMonthly: Math.round(b.baseForecastVolume * b.revenuePerContact),
    },
  }
}

const TENURED_CAPACITY_DRIVERS = new Set([
  'shrinkageRate',
  'occupancyTarget',
  'productivityFactor',
  'standardScheduledHoursPerWeek',
])

const BUSINESS_VOLUME_DRIVERS = new Set(['baseForecastVolume', 'revenuePerContact'])

export function applyAssumptionPatch(
  current: PlannerAssumptions,
  section: keyof PlannerAssumptions,
  field: string,
  value: number,
): PlannerAssumptions {
  let next: PlannerAssumptions = {
    ...current,
    [section]: { ...current[section], [field]: value },
  }
  if (section === 'tenured' && TENURED_CAPACITY_DRIVERS.has(field)) {
    next = syncDerivedTenuredFields(next)
  }
  if (section === 'business' && BUSINESS_VOLUME_DRIVERS.has(field)) {
    next = syncBusinessDerivedFields(next)
  }
  return next
}
