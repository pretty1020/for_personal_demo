const STORAGE_KEY = 'wfp-capacity-matrix-view-v5'

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

/** true = collapsed metric group in the capacity matrix (default overview). */
export const DEFAULT_CAPACITY_MATRIX_COLLAPSED: Record<string, boolean> = {
  staffing: false,
  headcount: true,
  pipeline: true,
  attrition: true,
  volume: true,
  shrinkage: true,
  aht: true,
  occupancy: true,
  hours: true,
  seats: true,
}

export const DEFAULT_CAPACITY_MATRIX_LAYOUT = {
  view: 'weekly' as const,
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
    const rawV5 = localStorage.getItem(STORAGE_KEY)
    const rawV4 = localStorage.getItem('wfp-capacity-matrix-view-v4')
    const raw = rawV5 ?? rawV4
    if (!raw) return null
    const parsed = JSON.parse(raw) as CapacityMatrixViewState
    if (!parsed || typeof parsed !== 'object') return null
    // Fresh v5: start collapsed. Migrating from v4 also starts collapsed (new default overview).
    const collapsed = rawV5
      ? { ...DEFAULT_CAPACITY_MATRIX_COLLAPSED, ...(parsed.collapsed ?? {}) }
      : { ...DEFAULT_CAPACITY_MATRIX_COLLAPSED }
    return {
      ...parsed,
      collapsed,
    }
  } catch {
    return null
  }
}

export function saveCapacityMatrixView(state: CapacityMatrixViewState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}
