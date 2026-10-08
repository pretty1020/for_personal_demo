import { toReferenceScenarioName } from './scenarioNames'
import type { CapacityPlanPublishSnapshot } from './capacityPlanBridge'
import type { PeriodGranularity } from './types'

const STORAGE_KEY = 'wfp-capacity-plan-view-v1'

export type CapacityPlanView = {
  scenarioId: string
  scenarioName: string
  savedAt: string
  granularity: PeriodGranularity
  /** KPI snapshot captured at publish — feeds Capacity Plan dashboard comparison */
  snapshot?: CapacityPlanPublishSnapshot
  /** Baseline snapshot from first publish of this scenario — "Original" plan */
  originalSnapshot?: CapacityPlanPublishSnapshot
}

export function loadCapacityPlanView(): CapacityPlanView | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const view = JSON.parse(raw) as CapacityPlanView
    return {
      ...view,
      scenarioName: toReferenceScenarioName(view.scenarioName),
      granularity: (view.granularity as PeriodGranularity) || 'weekly',
    }
  } catch {
    return null
  }
}

export function saveCapacityPlanView(view: CapacityPlanView): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(view))
}

export function clearCapacityPlanView(): void {
  localStorage.removeItem(STORAGE_KEY)
}
