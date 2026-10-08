import type { CapacityLeakageDrivers } from './capacityRevenueLeakage'

/** Shared driver labels for Overview and Leakages pages. */
export const CAPACITY_LEAKAGE_DRIVERS: Array<{
  key: Exclude<keyof CapacityLeakageDrivers, 'total'>
  label: string
  detail: string
}> = [
  {
    key: 'headcount',
    label: 'Understaffing',
    detail: 'Production HC below plan, priced at the LOB bill rate.',
  },
  {
    key: 'overstaffing',
    label: 'Overstaffing',
    detail: 'Actual HC above plan — excess paid capacity vs the staffing plan.',
  },
  {
    key: 'shrinkage',
    label: 'Non-billable shrinkages',
    detail: 'Non-billable shrinkage above plan.',
  },
  {
    key: 'aht',
    label: 'AHT',
    detail: 'Average handle time above plan on handled contacts.',
  },
  {
    key: 'attrition',
    label: 'Attrition',
    detail: 'Unplanned attrition above planned leavers.',
  },
  {
    key: 'volume',
    label: 'Volume shortfall',
    detail: 'Handled or offered volume below plan.',
  },
]

export type CapacityLeakageDriverKey = (typeof CAPACITY_LEAKAGE_DRIVERS)[number]['key']

export const CAPACITY_LEAKAGE_TOTAL_DETAIL =
  'Sum of leakage drivers for the selected scope and period.'

export type CapacityWeeklyLeakageRow = {
  week: string
} & CapacityLeakageDrivers

export type CapacityLeakageDetailRow = {
  week: string
  client: string
  lob: string
  projectCode: string
} & CapacityLeakageDrivers
