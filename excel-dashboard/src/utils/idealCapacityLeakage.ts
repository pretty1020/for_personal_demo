import type { ParsedWorkbookBundle, SheetSnapshot } from '../types/dashboard'
import { normalizeTabNameForMatch } from './datasheetTab'
import { ingestStaffingCapacityWorkbook } from './staffingCapacity/ingest'
import type { StaffingIngestResult } from './staffingCapacity/types'
import { buildIdealStaffingSampleBundle } from './idealStaffingSample'

/** Prefer a tab named Staffing_Plan / Staffing Plan for capacity leakage ingest. */
function bundleWithStaffingPlanAlias(bundle: ParsedWorkbookBundle): ParsedWorkbookBundle {
  const hit = bundle.sheetNames.find((n) => {
    const norm = normalizeTabNameForMatch(n)
    return norm === 'staffingplan' || norm === 'staffing_plan' || norm.includes('staffingplan')
  })
  if (!hit || hit === 'Staffing_Plan') return bundle
  if (bundle.snapshots.Staffing_Plan) return bundle
  return {
    ...bundle,
    snapshots: {
      ...bundle.snapshots,
      Staffing_Plan: bundle.snapshots[hit]!,
    },
    sheetNames: bundle.sheetNames.includes('Staffing_Plan')
      ? bundle.sheetNames
      : [...bundle.sheetNames, 'Staffing_Plan'],
  }
}

export function runIdealCapacityLeakage(bundle: ParsedWorkbookBundle): StaffingIngestResult {
  return ingestStaffingCapacityWorkbook(bundleWithStaffingPlanAlias(bundle))
}

export function runIdealCapacityLeakageFromFinancial(
  fileName: string,
  sheetNames: string[],
  snapshots: Record<string, SheetSnapshot>,
): StaffingIngestResult {
  return runIdealCapacityLeakage({ fileName, sheetNames, snapshots })
}

let cachedIdealSampleLeakage: StaffingIngestResult | null = null

export function runIdealCapacityLeakageSample(): StaffingIngestResult {
  cachedIdealSampleLeakage = null
  cachedIdealSampleLeakage = runIdealCapacityLeakage(buildIdealStaffingSampleBundle())
  return cachedIdealSampleLeakage
}

/** Clear cached sample ingest (e.g. after sample definition changes in dev). */
export function resetIdealCapacityLeakageSampleCache(): void {
  cachedIdealSampleLeakage = null
}

export function financialWorkbookHasStaffingPlan(sheetNames: string[]): boolean {
  return sheetNames.some((n) => {
    const norm = normalizeTabNameForMatch(n)
    return tabLooksLikeStaffing(norm)
  })
}

function tabLooksLikeStaffing(norm: string): boolean {
  return (
    norm.includes('staffingplan') ||
    norm.includes('staffing') ||
    norm.includes('capacityplan') ||
    norm === 'staffing_plan'
  )
}
