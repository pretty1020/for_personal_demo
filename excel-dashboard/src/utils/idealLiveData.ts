import type { ExecutiveMergedModel, ExecutiveUnifiedRow } from '../types/dashboard'
import { financialWorkbookHasStaffingPlan } from './idealCapacityLeakage'

const FINANCIAL_DATASETS = new Set(['commit_vs_actuals', 'datasheet', 'budget_vs_trending'])

/**
 * Map uploaded financial workbook facts into the ideal dashboard shape.
 */
export function factsFromExecutiveModel(model: ExecutiveMergedModel | null | undefined): ExecutiveUnifiedRow[] {
  if (!model?.factRows?.length) return []
  return model.factRows.filter((r) => {
    if (!FINANCIAL_DATASETS.has(r.dataset)) return false
    if (r.dataset === 'datasheet') {
      return Boolean(r.scenario && (r.week_start || r.month_bucket))
    }
    return true
  })
}

/** True when the merged model has financial facts for Ideal Financial (commit vs actuals, datasheet, budget). */
export function hasIdealFinancialFactRows(model: ExecutiveMergedModel | null | undefined): boolean {
  return factsFromExecutiveModel(model).length > 0
}

export function hasLiveFinancialData(
  model: ExecutiveMergedModel | null | undefined,
  sheetNames: string[] = [],
): boolean {
  if (hasIdealFinancialFactRows(model)) return true
  return financialWorkbookHasStaffingPlan(sheetNames)
}
