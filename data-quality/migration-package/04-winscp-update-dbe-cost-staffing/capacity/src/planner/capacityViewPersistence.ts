const STORAGE_KEY = 'wfp-capacity-matrix-view-v4'

export type CapacityMatrixViewState = {
  scenarioId: string
  scopeId: string
  view: 'weekly' | 'monthly' | 'quarterly'
  showFutureWeeks: boolean
  showPastWeeks: boolean
  /** When true, matrix shows all MAX_FUTURE_WEEKS; otherwise DEFAULT_VISIBLE_FUTURE_WEEKS. */
  expandAllFutureWeeks: boolean
  controlsOpen: boolean
  unlockHistorical: boolean
  hiddenWeeks: string[]
  collapsed: Record<string, boolean>
  visibleShrinkageCategoryIds?: string[]
  sidebarPanelOpen: {
    forecastUse: boolean
    addLob: boolean
    trainingSettings: boolean
    requiredProductionFte: boolean
  }
  forecastInfoOpen: boolean
  savedAt: string
}

/** false = expanded metric group in the capacity matrix. */
export const DEFAULT_CAPACITY_MATRIX_COLLAPSED: Record<string, boolean> = {
  headcount: false,
  support: false,
  staffing: false,
  pipeline: false,
  attrition: false,
  volume: false,
  shrinkage: false,
  aht: false,
  occupancy: false,
  hours: false,
}

export const DEFAULT_CAPACITY_MATRIX_LAYOUT = {
  view: 'monthly' as const,
  showFutureWeeks: true,
  showPastWeeks: true,
  expandAllFutureWeeks: false,
  controlsOpen: false,
  unlockHistorical: false,
  hiddenWeeks: [] as string[],
  collapsed: DEFAULT_CAPACITY_MATRIX_COLLAPSED,
  sidebarPanelOpen: {
    forecastUse: false,
    addLob: false,
    trainingSettings: false,
    requiredProductionFte: true,
  },
  forecastInfoOpen: false,
}

export function loadCapacityMatrixView(): CapacityMatrixViewState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CapacityMatrixViewState
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

export function saveCapacityMatrixView(state: CapacityMatrixViewState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}
