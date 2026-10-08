import type { WeekCapacityPlanOverride } from './capacityPlanOverridePersistence'
import type { DerivedCapacityRow } from './capacityPlanDerived'
import { sumSupportRoleValues, supportRoleLabel, type SupportRoleTemplate } from './supportRoles'

export type SupportRoleWeekRow = {
  roles: Record<string, { planned: number; actual: number | null }>
  plannedTotal: number
  actualTotal: number | null
  plannedSeats: number
  peakRatio: number | null
  seatsVariance: number | null
}

export type SupportRoleLookup = {
  labels: Record<string, string>
  rowsByWeek: Map<string, SupportRoleWeekRow>
}

export function buildSupportRoleLookup(
  derivedRows: DerivedCapacityRow[],
  supportRoles: SupportRoleTemplate[],
  plannedOverrides: Record<string, WeekCapacityPlanOverride> = {},
): SupportRoleLookup {
  const labels: Record<string, string> = {}
  for (const role of supportRoles) {
    labels[role.id] = supportRoleLabel(role.id, supportRoles)
  }

  const rowsByWeek = new Map<string, SupportRoleWeekRow>()
  for (const row of derivedRows) {
    const weekOverride = plannedOverrides[row.week] ?? {}
    const plannedRoles = {
      ...(row.planned.supportHcByRole ?? {}),
      ...(weekOverride.supportHcByRole ?? {}),
    }
    const actualRoles = { ...(row.actual.supportHcByRole ?? {}) }
    const roles: Record<string, { planned: number; actual: number | null }> = {}
    const roleIds = new Set([...Object.keys(plannedRoles), ...Object.keys(actualRoles)])
    for (const roleId of roleIds) {
      roles[roleId] = {
        planned: plannedRoles[roleId] ?? 0,
        actual:
          row.statusLabel === 'Actual' || row.timeline === 'historical_actual'
            ? actualRoles[roleId] ?? null
            : null,
      }
    }
    const plannedRoleSum = sumSupportRoleValues(plannedRoles)
    const plannedTotal =
      plannedRoleSum > 0 ? plannedRoleSum : weekOverride.supportHc ?? row.planned.supportHc ?? 0
    const actualRoleSum = sumSupportRoleValues(actualRoles)
    const actualTotal =
      row.statusLabel === 'Actual' || row.timeline === 'historical_actual'
        ? actualRoleSum > 0
          ? actualRoleSum
          : row.actual.supportHc
        : null
    const plannedSeats = weekOverride.plannedSeats ?? row.planned.plannedSeats ?? 0
    const peakRatio = weekOverride.peakRatio ?? row.planned.peakRatio ?? null
    const seatsVariance =
      plannedSeats > 0
        ? plannedSeats - (row.planned.productionHc + plannedTotal)
        : (row.planned.seatsVariance ?? null)

    rowsByWeek.set(row.week, {
      roles,
      plannedTotal,
      actualTotal,
      plannedSeats,
      peakRatio,
      seatsVariance,
    })
  }

  return { labels, rowsByWeek }
}
