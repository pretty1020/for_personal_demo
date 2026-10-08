import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useDemoSession } from './DemoSessionContext'
import { createScenario } from '../planner/defaults'
import {
  canAccessCapacityPlan,
  canDeleteCapacityPlan,
  canEditCapacityPlan,
  revokeAllPlanAccessForScenario,
} from '../planner/planAccess'
import { syncBusinessDerivedFields, syncDerivedTenuredFields } from '../planner/assumptionDerivation'
import { compareScenarios, runSimulation } from '../planner/engine'
import { buildCapacityPlanSnapshot } from '../planner/capacityPlanBridge'
import {
  buildCapacityOverridesFromSimulation,
  mergePublishedCapacityOverrides,
  syncCapacityMatrixScope,
} from '../planner/capacityPlanPublish'
import { loadCapacityMatrixView } from '../planner/capacityViewPersistence'
import { loadForecastOverrides, saveForecastOverrides, type ForecastMetricId, type ScenarioForecastOverrides } from '../planner/forecastPersistence'
import {
  loadAdvancedForecasts,
  type AdvancedForecastStore,
  type ScenarioDriverForecasts,
} from '../planner/advancedForecastPersistence'
import {
  capacityAhtMixHeadcountByWeek,
  countInactiveProductionRoster,
  deriveCapacityPlanRows,
} from '../planner/capacityPlanDerived'
import {
  clearScenarioAhtOverrides,
  getScenarioAhtOverrides,
  loadAhtAnalysisOverrides,
  saveAhtAnalysisOverrides,
} from '../planner/ahtAnalysisPersistence'
import { buildScenarioForecast, type ScenarioForecastPackage } from '../planner/forecasting'
import { rosterHeadcountOverrides } from '../planner/rosterMetrics'
import { resolveCapacityPlanStartWeek, resolveCurrentCalendarWeek } from '../planner/capacityWeekUtils'
import {
  clearScenarioCapacityPlanOverrides,
  loadCapacityPlanOverrides,
  saveCapacityPlanOverrides,
  type ScenarioCapacityPlanOverrideStore,
  type WeekCapacityPlanOverride,
} from '../planner/capacityPlanOverridePersistence'
import { clearScenarioDriverWeekLocks, lockDriverWeek } from '../planner/capacityDriverLocks'
import {
  clearScenarioStageAttritionOverrides,
  loadStageAttritionOverrides,
  saveStageAttritionOverrides,
  type ScenarioStageAttritionStore,
  type StageAttritionOverride,
} from '../planner/capacityStageAttritionPersistence'
import {
  clearScenarioShrinkageCategories,
  loadShrinkageCategoryStore,
  saveShrinkageCategoryStore,
  type ScenarioShrinkageCategoryStore,
} from '../planner/capacityShrinkageCategoryPersistence'
import { loadLedgerOverrides, saveLedgerOverrides } from '../planner/ledgerPersistence'
import {
  loadRosterStore,
  loadRosterSyncMetaStore,
  saveRosterStore,
  saveRosterSyncMetaStore,
  type RosterEmployee,
  type ScenarioRosterStore,
  type ScenarioRosterSyncMeta,
  type ScenarioRosterSyncMetaStore,
} from '../planner/rosterPersistence'
import {
  loadActiveScenarioId,
  loadGranularity,
  loadScenarios,
  saveActiveScenarioId,
  saveGranularity,
  saveScenarios,
} from '../planner/persistence'
import {
  clearScenarioForecastModes,
  loadForecastModesStore,
  saveForecastModesStore,
} from '../planner/capacityForecastModesPersistence'
import {
  clearCapacityPlanView,
  loadCapacityPlanView,
  saveCapacityPlanView,
  type CapacityPlanView,
} from '../planner/capacityPlanView'
import { deleteClientProfile, syncClientProfileFromPlan } from '../planner/clientRegistry'
import {
  clearPreviousCapacityPublishForScenario,
  loadPreviousCapacityPublishStore,
  savePreviousCapacityPublishStore,
  type PreviousCapacityPublish,
  type PreviousCapacityPublishStore,
} from '../planner/capacityPlanPreviousPublish'
import { SCENARIO_TEMPLATES } from '../planner/templates'
import type {
  PeriodGranularity,
  PlannerAssumptions,
  PlannerPlanMetadata,
  PlannerScenario,
  SimulationResult,
} from '../planner/types'
import {
  buildWeeklyPlanLedger,
  type LedgerMetricSnapshot,
  type ImportedActualOverride,
  type WeeklyLedgerRow,
} from '../planner/weeklyLedger'
import type { ShrinkageCategoryTemplate } from '../planner/shrinkageCategories'

type PlannerContextValue = {
  /** Capacity plans the current user may access. */
  scenarios: PlannerScenario[]
  /** Full store (admin plan-access UI). Prefer `scenarios` for day-to-day views. */
  allScenarios: PlannerScenario[]
  canEditScenario: (scenarioId: string) => boolean
  activeScenario: PlannerScenario | null
  activeResult: SimulationResult | null
  granularity: PeriodGranularity
  setGranularity: (g: PeriodGranularity) => void
  comparisonIds: string[]
  setComparisonIds: (ids: string[]) => void
  comparisonResults: SimulationResult[]
  comparisonTable: ReturnType<typeof compareScenarios>
  capacityPlanView: CapacityPlanView | null
  capacityPlanResult: SimulationResult | null
  activeLedger: WeeklyLedgerRow[]
  getScenarioForecast: (scenarioId: string, horizonWeeks?: number) => ScenarioForecastPackage | null
  /** Re-read service forecast results from storage so dependent views recompute. */
  refreshAdvancedForecasts: (store?: AdvancedForecastStore) => void
  getScenarioAdvancedSettings: (scenarioId: string) => ScenarioDriverForecasts | undefined
  updateForecastOverride: (scenarioId: string, metricId: ForecastMetricId, weekIndex: number, value: number | null) => void
  saveAsCapacityPlanView: (scenarioId: string, scenarioOverride?: PlannerScenario) => void
  publishScenarioToCapacity: (scenarioId: string) => void
  /** Restore the capacity plan that was displaced by the last Open/Publish/Republish. */
  resetToPreviousCapacityPlan: (scenarioId?: string) => boolean
  hasPreviousCapacityPlan: (scenarioId?: string) => boolean
  clearCapacityPlanViewLink: () => void
  getScenarioResult: (scenarioId: string, viewGranularity?: PeriodGranularity) => SimulationResult | null
  getScenarioLedger: (scenarioId: string) => WeeklyLedgerRow[]
  getScenarioCapacityPlanOverrides: (scenarioId: string) => Record<string, WeekCapacityPlanOverride>
  getScenarioStageAttritionOverrides: (scenarioId: string) => StageAttritionOverride
  getScenarioShrinkageCategories: (scenarioId: string) => ShrinkageCategoryTemplate[]
  updatePlannedShrinkageCategory: (
    scenarioId: string,
    week: string,
    categoryId: string,
    value: number | null,
  ) => void
  updateActualShrinkageCategory: (
    scenarioId: string,
    week: string,
    categoryId: string,
    value: number | null,
  ) => void
  addScenarioShrinkageCategory: (scenarioId: string, category: ShrinkageCategoryTemplate) => void
  deleteScenarioShrinkageCategory: (scenarioId: string, categoryId: string) => void
  updateStageAttritionRate: (
    scenarioId: string,
    stage: 'training' | 'nesting',
    stageWeek: number,
    value: number | null,
  ) => void
  clearCapacityPlanData: (scenarioId: string) => void
  getScenarioRoster: (scenarioId: string) => RosterEmployee[]
  saveScenarioRoster: (scenarioId: string, employees: RosterEmployee[]) => void
  getScenarioRosterSyncMeta: (scenarioId: string) => ScenarioRosterSyncMeta | null
  saveScenarioRosterSyncMeta: (scenarioId: string, meta: ScenarioRosterSyncMeta | null) => void
  importActualOverrides: (scenarioId: string, overrides: ImportedActualOverride[]) => void
  updateActualOverrideMetric: (
    scenarioId: string,
    week: string,
    metricId: keyof LedgerMetricSnapshot,
    value: number | null,
  ) => void
  updatePlannedOverrideMetric: (
    scenarioId: string,
    week: string,
    metricId: keyof LedgerMetricSnapshot,
    value: number | null,
  ) => void
  applyPlannedWeekOverrides: (
    scenarioId: string,
    plannedByWeek: Record<string, WeekCapacityPlanOverride>,
    mode?: 'overwrite' | 'append',
  ) => void
  selectScenario: (id: string) => void
  createNewScenario: (
    name: string,
    description?: string,
    plan?: PlannerPlanMetadata,
    assumptionsOverride?: PlannerAssumptions,
  ) => PlannerScenario
  cloneScenario: (id: string, newName?: string) => void
  deleteScenario: (id: string) => void
  setBaseline: (id: string) => void
  updateAssumptions: (id: string, assumptions: PlannerAssumptions) => void
  updateScenarioPlan: (id: string, plan: PlannerPlanMetadata) => void
  applyScenarioPlanSettings: (
    id: string,
    input: {
      plan: PlannerPlanMetadata
      assumptions: PlannerAssumptions
      scenarioName: string
      previousClientName?: string
    },
  ) => boolean
  updateScenarioName: (id: string, name: string) => void
  applyTemplate: (templateId: string, scenarioId?: string) => void
  hydrateCapacityStores: () => void
}

const PlannerContext = createContext<PlannerContextValue | null>(null)

function mergeAssumptions(base: PlannerAssumptions, patch: Partial<PlannerAssumptions>): PlannerAssumptions {
  return {
    newHire: { ...base.newHire, ...patch.newHire },
    tenured: { ...base.tenured, ...patch.tenured },
    business: { ...base.business, ...patch.business },
    channels: { ...base.channels, ...patch.channels },
  }
}

export function PlannerProvider({ children }: { children: ReactNode }) {
  const { user, planAccessRevision, canCreatePlans: allowCreate } = useDemoSession()
  const accessSubject = useMemo(
    () => (user ? { email: user.email, accessLevel: user.accessLevel } : null),
    [user],
  )
  const [scenarios, setScenarios] = useState<PlannerScenario[]>(() => loadScenarios())
  const [activeId, setActiveId] = useState<string | null>(() => loadActiveScenarioId())
  const [granularity, setGranularityState] = useState<PeriodGranularity>(() => loadGranularity())
  const [comparisonIds, setComparisonIds] = useState<string[]>([])
  const [forecastOverrides, setForecastOverrides] = useState<Record<string, ScenarioForecastOverrides>>(() => loadForecastOverrides())
  const [advancedForecasts, setAdvancedForecasts] = useState<AdvancedForecastStore>(() => loadAdvancedForecasts())
  const [ledgerOverrides, setLedgerOverrides] = useState<Record<string, ImportedActualOverride[]>>(() => loadLedgerOverrides())
  const [rosterStore, setRosterStore] = useState<ScenarioRosterStore>(() => loadRosterStore())
  const [rosterSyncMetaStore, setRosterSyncMetaStore] = useState<ScenarioRosterSyncMetaStore>(() => loadRosterSyncMetaStore())
  const [capacityPlanOverrides, setCapacityPlanOverrides] = useState<ScenarioCapacityPlanOverrideStore>(() => loadCapacityPlanOverrides())
  const [stageAttritionOverrides, setStageAttritionOverrides] = useState<ScenarioStageAttritionStore>(() =>
    loadStageAttritionOverrides(),
  )
  const [shrinkageCategoryStore, setShrinkageCategoryStore] = useState<ScenarioShrinkageCategoryStore>(() =>
    loadShrinkageCategoryStore(),
  )
  const [capacityPlanView, setCapacityPlanView] = useState<CapacityPlanView | null>(() => {
    const loaded = loadCapacityPlanView()
    if (loaded) return loaded
    const all = loadScenarios()
    const baseline = all.find((s) => s.isBaseline) ?? all[0]
    if (!baseline) return null
    const view: CapacityPlanView = {
      scenarioId: baseline.id,
      scenarioName: baseline.name,
      savedAt: new Date().toISOString(),
      granularity: 'weekly',
    }
    saveCapacityPlanView(view)
    return view
  })
  const [previousCapacityPublish, setPreviousCapacityPublish] = useState<PreviousCapacityPublishStore>(() =>
    loadPreviousCapacityPublishStore(),
  )

  const persist = useCallback((next: PlannerScenario[]) => {
    setScenarios(next)
    saveScenarios(next)
  }, [])

  const setGranularity = useCallback((g: PeriodGranularity) => {
    setGranularityState(g)
    saveGranularity(g)
  }, [])

  const activeScenario = useMemo(() => {
    void planAccessRevision
    const accessible = scenarios.filter((scenario) => canAccessCapacityPlan(scenario, accessSubject))
    return (
      accessible.find((s) => s.id === activeId) ??
      accessible.find((s) => s.isBaseline) ??
      accessible[0] ??
      null
    )
  }, [accessSubject, activeId, planAccessRevision, scenarios])

  const activeResult = useMemo(
    () => (activeScenario ? runSimulation(activeScenario, granularity) : null),
    [activeScenario, granularity],
  )

  const comparisonResults = useMemo(
    () =>
      comparisonIds
        .map((id) => scenarios.find((s) => s.id === id))
        .filter((s): s is PlannerScenario => Boolean(s))
        .map((s) => runSimulation(s, granularity)),
    [comparisonIds, scenarios, granularity],
  )

  const comparisonTable = useMemo(() => compareScenarios(comparisonResults), [comparisonResults])

  const getScenarioResult = useCallback(
    (scenarioId: string, viewGranularity?: PeriodGranularity) => {
      const s = scenarios.find((x) => x.id === scenarioId)
      if (!s) return null
      return runSimulation(s, viewGranularity ?? granularity)
    },
    [scenarios, granularity],
  )

  const getScenarioLedger = useCallback(
    (scenarioId: string) => {
      const scenario = scenarios.find((item) => item.id === scenarioId)
      if (!scenario) return []
      const weeklyResult = runSimulation(scenario, 'weekly', 52)
      return buildWeeklyPlanLedger(
        scenario,
        weeklyResult,
        ledgerOverrides[scenarioId] ?? [],
        shrinkageCategoryStore[scenarioId] ?? undefined,
      )
    },
    [scenarios, ledgerOverrides, shrinkageCategoryStore],
  )

  const capacityPlanResult = useMemo(() => {
    if (!capacityPlanView) return null
    return getScenarioResult(capacityPlanView.scenarioId, capacityPlanView.granularity)
  }, [capacityPlanView, getScenarioResult])

  const activeLedger = useMemo(
    () => (activeScenario ? getScenarioLedger(activeScenario.id) : []),
    [activeScenario, getScenarioLedger],
  )

  const getScenarioForecast = useCallback(
    (scenarioId: string, horizonWeeks = 12) => {
      const ledger = getScenarioLedger(scenarioId)
      if (!ledger.length) return null
      const scenario = scenarios.find((item) => item.id === scenarioId)
      let ahtMixByWeek: ReturnType<typeof capacityAhtMixHeadcountByWeek> | undefined
      if (scenario) {
        const roster = rosterStore[scenarioId] ?? []
        const planStartWeek = resolveCapacityPlanStartWeek(scenario.plan)
        const currentWeek = resolveCurrentCalendarWeek(scenario.plan.weekStart, scenario.plan.timezone)
        const inactiveProductionRosterCount = countInactiveProductionRoster(roster, currentWeek)
        const rosterPlanStartProductionHc = rosterHeadcountOverrides(roster, planStartWeek).productionHc
        // Null forecast seed: historical Nesting/Production HC and phone time do
        // not depend on the AHT series we are about to build.
        const seedRows = deriveCapacityPlanRows(
          ledger,
          scenario,
          null,
          capacityPlanOverrides[scenarioId] ?? {},
          undefined,
          inactiveProductionRosterCount,
          getScenarioAhtOverrides(scenarioId),
          stageAttritionOverrides[scenarioId] ?? {},
          undefined,
          rosterPlanStartProductionHc,
        )
        ahtMixByWeek = capacityAhtMixHeadcountByWeek(seedRows)
      }
      return buildScenarioForecast(
        ledger,
        forecastOverrides[scenarioId],
        horizonWeeks,
        advancedForecasts[scenarioId],
        ahtMixByWeek,
      )
    },
    [
      getScenarioLedger,
      forecastOverrides,
      advancedForecasts,
      scenarios,
      rosterStore,
      capacityPlanOverrides,
      stageAttritionOverrides,
    ],
  )

  const refreshAdvancedForecasts = useCallback((store?: AdvancedForecastStore) => {
    setAdvancedForecasts(store ?? loadAdvancedForecasts())
  }, [])

  const getScenarioAdvancedSettings = useCallback(
    (scenarioId: string): ScenarioDriverForecasts | undefined => advancedForecasts[scenarioId],
    [advancedForecasts],
  )

  const getScenarioRoster = useCallback(
    (scenarioId: string) => rosterStore[scenarioId] ?? [],
    [rosterStore],
  )

  const saveScenarioRoster = useCallback((scenarioId: string, employees: RosterEmployee[]) => {
    setRosterStore((prev) => {
      const next = { ...prev, [scenarioId]: employees }
      saveRosterStore(next)
      return next
    })
  }, [])

  const getScenarioRosterSyncMeta = useCallback(
    (scenarioId: string) => rosterSyncMetaStore[scenarioId] ?? null,
    [rosterSyncMetaStore],
  )

  const saveScenarioRosterSyncMeta = useCallback((scenarioId: string, meta: ScenarioRosterSyncMeta | null) => {
    setRosterSyncMetaStore((prev) => {
      const next = { ...prev }
      if (meta) next[scenarioId] = meta
      else delete next[scenarioId]
      saveRosterSyncMetaStore(next)
      return next
    })
  }, [])

  // Keep linked Capacity Plan view aligned with the saved scenario record.
  useEffect(() => {
    if (!capacityPlanView) return
    const s = scenarios.find((x) => x.id === capacityPlanView.scenarioId)
    if (!s) return
    const needsName = s.name !== capacityPlanView.scenarioName
    const needsSnapshot = !capacityPlanView.snapshot?.planAssumptions
    if (!needsName && !needsSnapshot) return
    const sim = runSimulation(s, capacityPlanView.granularity)
    const next: CapacityPlanView = {
      ...capacityPlanView,
      scenarioName: s.name,
      ...(needsSnapshot ? { snapshot: buildCapacityPlanSnapshot(sim, s.assumptions) } : {}),
    }
    saveCapacityPlanView(next)
    setCapacityPlanView(next)
  }, [scenarios, capacityPlanView])

  const saveAsCapacityPlanView = useCallback(
    (scenarioId: string, scenarioOverride?: PlannerScenario) => {
      const s = scenarioOverride ?? scenarios.find((x) => x.id === scenarioId)
      if (!s) return
      const sim = runSimulation(s, granularity)
      const snapshot = buildCapacityPlanSnapshot(sim, s.assumptions)
      const existing = capacityPlanView
      const view: CapacityPlanView = {
        scenarioId: s.id,
        scenarioName: s.name,
        savedAt: new Date().toISOString(),
        granularity,
        snapshot,
        originalSnapshot:
          existing?.scenarioId === s.id && existing.originalSnapshot ? existing.originalSnapshot : snapshot,
      }
      saveCapacityPlanView(view)
      setCapacityPlanView(view)
    },
    [scenarios, granularity, capacityPlanView],
  )

  const clearCapacityPlanViewLink = useCallback(() => {
    clearCapacityPlanView()
    setCapacityPlanView(null)
  }, [])

  const importActualOverrides = useCallback((scenarioId: string, overrides: ImportedActualOverride[]) => {
    setLedgerOverrides((prev) => {
      const existing = new Map((prev[scenarioId] ?? []).map((item) => [item.week, item]))
      for (const override of overrides) {
        existing.set(override.week, {
          ...existing.get(override.week),
          ...override,
          metrics: {
            ...(existing.get(override.week)?.metrics ?? {}),
            ...override.metrics,
          },
          shrinkageById: {
            ...(existing.get(override.week)?.shrinkageById ?? {}),
            ...(override.shrinkageById ?? {}),
          },
        })
      }
      const next = { ...prev, [scenarioId]: [...existing.values()].sort((a, b) => a.week.localeCompare(b.week)) }
      saveLedgerOverrides(next)
      return next
    })
  }, [])

  const updateActualOverrideMetric = useCallback(
    (scenarioId: string, week: string, metricId: keyof LedgerMetricSnapshot, value: number | null) => {
      setLedgerOverrides((prev) => {
        const existing = new Map((prev[scenarioId] ?? []).map((item) => [item.week, item]))
        const current = existing.get(week) ?? { week, metrics: {} }
        const metrics = { ...(current.metrics ?? {}) }
        if (value == null || Number.isNaN(value)) {
          delete metrics[metricId]
        } else {
          metrics[metricId] = value
        }
        // Transfer / attrition / LOA / graduate drivers own Production HC via formula —
        // clear a stale hard override so Transfer In stays effective.
        const productionDrivers: Array<keyof LedgerMetricSnapshot> = [
          'transferInHc',
          'transferOutHc',
          'attritionHc',
          'offRosterLoaHc',
          'graduateHc',
          'beginningProductionHc',
        ]
        if (productionDrivers.includes(metricId)) {
          delete metrics.productionHc
        }
        existing.set(week, {
          ...current,
          metrics,
        })
        const next = { ...prev, [scenarioId]: [...existing.values()].sort((a, b) => a.week.localeCompare(b.week)) }
        saveLedgerOverrides(next)
        return next
      })
    },
    [],
  )

  const getScenarioStageAttritionOverrides = useCallback(
    (scenarioId: string) => stageAttritionOverrides[scenarioId] ?? {},
    [stageAttritionOverrides],
  )

  const getScenarioShrinkageCategories = useCallback(
    (scenarioId: string) => shrinkageCategoryStore[scenarioId] ?? [],
    [shrinkageCategoryStore],
  )

  const updatePlannedShrinkageCategory = useCallback(
    (scenarioId: string, week: string, categoryId: string, value: number | null) => {
      setCapacityPlanOverrides((prev) => {
        const scenarioOverrides = { ...(prev[scenarioId] ?? {}) }
        const weekOverride: WeekCapacityPlanOverride = { ...(scenarioOverrides[week] ?? {}) }
        const shrinkageById = { ...(weekOverride.shrinkageById ?? {}) }
        if (value == null || Number.isNaN(value)) {
          delete shrinkageById[categoryId]
        } else {
          shrinkageById[categoryId] = value
        }
        if (!Object.keys(shrinkageById).length) {
          delete weekOverride.shrinkageById
        } else {
          weekOverride.shrinkageById = shrinkageById
        }
        if (!Object.keys(weekOverride).length) {
          delete scenarioOverrides[week]
        } else {
          scenarioOverrides[week] = weekOverride
        }
        const next = { ...prev, [scenarioId]: scenarioOverrides }
        saveCapacityPlanOverrides(next)
        return next
      })
    },
    [],
  )

  const updateActualShrinkageCategory = useCallback(
    (scenarioId: string, week: string, categoryId: string, value: number | null) => {
      setLedgerOverrides((prev) => {
        const existing = new Map((prev[scenarioId] ?? []).map((item) => [item.week, item]))
        const current = existing.get(week) ?? { week, metrics: {} }
        const shrinkageById = { ...(current.shrinkageById ?? {}) }
        if (value == null || Number.isNaN(value)) delete shrinkageById[categoryId]
        else shrinkageById[categoryId] = value
        existing.set(week, {
          ...current,
          shrinkageById: Object.keys(shrinkageById).length ? shrinkageById : undefined,
        })
        const next = { ...prev, [scenarioId]: [...existing.values()].sort((a, b) => a.week.localeCompare(b.week)) }
        saveLedgerOverrides(next)
        return next
      })
    },
    [],
  )

  const addScenarioShrinkageCategory = useCallback((scenarioId: string, category: ShrinkageCategoryTemplate) => {
    setShrinkageCategoryStore((prev) => {
      const current = prev[scenarioId] ?? []
      if (current.some((item) => item.id === category.id)) return prev
      const next = { ...prev, [scenarioId]: [...current, category] }
      saveShrinkageCategoryStore(next)
      return next
    })
  }, [])

  const deleteScenarioShrinkageCategory = useCallback((scenarioId: string, categoryId: string) => {
    setShrinkageCategoryStore((prev) => {
      const current = prev[scenarioId] ?? []
      const nextCategories = current.filter((item) => item.id !== categoryId)
      const next = { ...prev }
      if (nextCategories.length) next[scenarioId] = nextCategories
      else delete next[scenarioId]
      saveShrinkageCategoryStore(next)
      return next
    })
    setCapacityPlanOverrides((prev) => {
      const scenarioOverrides = { ...(prev[scenarioId] ?? {}) }
      let changed = false
      for (const [week, weekOverride] of Object.entries(scenarioOverrides)) {
        if (!weekOverride.shrinkageById?.[categoryId]) continue
        const shrinkageById = { ...weekOverride.shrinkageById }
        delete shrinkageById[categoryId]
        changed = true
        const nextWeek = { ...weekOverride }
        if (Object.keys(shrinkageById).length) nextWeek.shrinkageById = shrinkageById
        else delete nextWeek.shrinkageById
        if (Object.keys(nextWeek).length) scenarioOverrides[week] = nextWeek
        else delete scenarioOverrides[week]
      }
      if (!changed) return prev
      const next = { ...prev, [scenarioId]: scenarioOverrides }
      if (!Object.keys(scenarioOverrides).length) {
        delete next[scenarioId]
      }
      saveCapacityPlanOverrides(next)
      return next
    })
    setLedgerOverrides((prev) => {
      const rows = prev[scenarioId] ?? []
      if (!rows.length) return prev
      let changed = false
      const nextRows = rows.map((row) => {
        if (!row.shrinkageById?.[categoryId]) return row
        changed = true
        const shrinkageById = { ...row.shrinkageById }
        delete shrinkageById[categoryId]
        return {
          ...row,
          shrinkageById: Object.keys(shrinkageById).length ? shrinkageById : undefined,
        }
      })
      if (!changed) return prev
      const next = { ...prev, [scenarioId]: nextRows }
      saveLedgerOverrides(next)
      return next
    })
  }, [])

  const updateStageAttritionRate = useCallback(
    (scenarioId: string, stage: 'training' | 'nesting', stageWeek: number, value: number | null) => {
      setStageAttritionOverrides((prev) => {
        const scenarioOverrides: StageAttritionOverride = { ...(prev[scenarioId] ?? {}) }
        const bucket = { ...(scenarioOverrides[stage] ?? {}) }
        if (value == null || Number.isNaN(value)) {
          delete bucket[stageWeek]
        } else {
          bucket[stageWeek] = value
        }
        if (!Object.keys(bucket).length) {
          delete scenarioOverrides[stage]
        } else {
          scenarioOverrides[stage] = bucket
        }
        const next = { ...prev, [scenarioId]: scenarioOverrides }
        saveStageAttritionOverrides(next)
        return next
      })
    },
    [],
  )

  const clearCapacityPlanData = useCallback((scenarioId: string) => {
    setCapacityPlanOverrides((prev) => {
      const next = clearScenarioCapacityPlanOverrides(prev, scenarioId)
      saveCapacityPlanOverrides(next)
      return next
    })
    setLedgerOverrides((prev) => {
      const next = { ...prev }
      delete next[scenarioId]
      saveLedgerOverrides(next)
      return next
    })
    setStageAttritionOverrides((prev) => {
      const next = clearScenarioStageAttritionOverrides(prev, scenarioId)
      saveStageAttritionOverrides(next)
      return next
    })
    setShrinkageCategoryStore((prev) => {
      const next = clearScenarioShrinkageCategories(prev, scenarioId)
      saveShrinkageCategoryStore(next)
      return next
    })
    setForecastOverrides((prev) => {
      const next = { ...prev }
      delete next[scenarioId]
      saveForecastOverrides(next)
      return next
    })
    setPreviousCapacityPublish((prev) => {
      const cleaned = clearPreviousCapacityPublishForScenario(prev, scenarioId)
      savePreviousCapacityPublishStore(cleaned)
      return cleaned
    })
    clearScenarioDriverWeekLocks(scenarioId)
    saveForecastModesStore(clearScenarioForecastModes(loadForecastModesStore(), scenarioId))
    saveAhtAnalysisOverrides(clearScenarioAhtOverrides(loadAhtAnalysisOverrides(), scenarioId))
    setScenarios((prev) => {
      const next = prev.map((item) =>
        item.id === scenarioId
          ? {
              ...item,
              plan: {
                ...item.plan,
                capacityImportedWeeks: undefined,
                capacityPlanStartWeek: undefined,
              },
              updatedAt: new Date().toISOString(),
            }
          : item,
      )
      saveScenarios(next)
      return next
    })
    setCapacityPlanView((prev) => {
      if (prev?.scenarioId !== scenarioId) return prev
      clearCapacityPlanView()
      return null
    })
  }, [])

  const getScenarioCapacityPlanOverrides = useCallback(
    (scenarioId: string) => capacityPlanOverrides[scenarioId] ?? {},
    [capacityPlanOverrides],
  )

  const updatePlannedOverrideMetric = useCallback(
    (scenarioId: string, week: string, metricId: keyof LedgerMetricSnapshot, value: number | null) => {
      const scenario = scenarios.find((item) => item.id === scenarioId)
      if (!scenario || !canEditCapacityPlan(scenario, accessSubject)) return
      const planStart = scenario?.plan.capacityPlanStartWeek
      if (planStart && week !== planStart && value != null && !Number.isNaN(value)) {
        lockDriverWeek(scenarioId, week)
      }
      setCapacityPlanOverrides((prev) => {
        const scenarioOverrides = { ...(prev[scenarioId] ?? {}) }
        const weekOverride = { ...(scenarioOverrides[week] ?? {}) }
        if (value == null || Number.isNaN(value)) {
          delete weekOverride[metricId]
        } else {
          weekOverride[metricId] = value
        }
        const productionDrivers: Array<keyof LedgerMetricSnapshot> = [
          'transferInHc',
          'transferOutHc',
          'attritionHc',
          'offRosterLoaHc',
          'graduateHc',
          'beginningProductionHc',
        ]
        if (productionDrivers.includes(metricId)) {
          delete weekOverride.productionHc
        }
        if (!Object.keys(weekOverride).length) {
          delete scenarioOverrides[week]
        } else {
          scenarioOverrides[week] = weekOverride
        }
        const next = { ...prev, [scenarioId]: scenarioOverrides }
        saveCapacityPlanOverrides(next)
        return next
      })
    },
    [accessSubject, scenarios],
  )

  const applyPlannedWeekOverrides = useCallback(
    (
      scenarioId: string,
      plannedByWeek: Record<string, WeekCapacityPlanOverride>,
      mode: 'overwrite' | 'append' = 'overwrite',
    ) => {
      const scenario = scenarios.find((item) => item.id === scenarioId)
      if (!scenario || !canEditCapacityPlan(scenario, accessSubject)) return
      setCapacityPlanOverrides((prev) => {
        const scenarioOverrides = { ...(prev[scenarioId] ?? {}) }
        for (const [week, patch] of Object.entries(plannedByWeek)) {
          const existing = scenarioOverrides[week] ?? {}
          const nextWeek: WeekCapacityPlanOverride = { ...existing }
          for (const [key, value] of Object.entries(patch)) {
            if (key === 'shrinkageById') {
              if (value && typeof value === 'object') {
                nextWeek.shrinkageById = {
                  ...(mode === 'append' ? existing.shrinkageById ?? {} : {}),
                  ...(value as Record<string, number>),
                }
              }
              continue
            }
            const metricId = key as keyof LedgerMetricSnapshot
            if (value == null || (typeof value === 'number' && Number.isNaN(value))) continue
            if (mode === 'append' && existing[metricId] != null) continue
            ;(nextWeek as Record<string, unknown>)[metricId] = value
            // Lock every week that received an uploaded/edited value so roll-forward
            // and forecast propagation cannot replace it.
            lockDriverWeek(scenarioId, week)
          }
          scenarioOverrides[week] = nextWeek
        }
        const next = { ...prev, [scenarioId]: scenarioOverrides }
        saveCapacityPlanOverrides(next)
        return next
      })
    },
    [accessSubject, scenarios],
  )

  const updateForecastOverride = useCallback(
    (scenarioId: string, metricId: ForecastMetricId, weekIndex: number, value: number | null) => {
      setForecastOverrides((prev) => {
        const scenarioOverrides = { ...(prev[scenarioId] ?? {}) }
        const metricOverrides = { ...(scenarioOverrides[metricId] ?? {}) }
        if (value == null || Number.isNaN(value)) {
          delete metricOverrides[weekIndex]
        } else {
          metricOverrides[weekIndex] = value
        }
        scenarioOverrides[metricId] = metricOverrides
        const next = { ...prev, [scenarioId]: scenarioOverrides }
        saveForecastOverrides(next)
        return next
      })
    },
    [],
  )

  const selectScenario = useCallback((id: string) => {
    setActiveId(id)
    saveActiveScenarioId(id)
  }, [])

  const publishScenarioToCapacity = useCallback(
    (scenarioId: string) => {
      const scenario = scenarios.find((item) => item.id === scenarioId)
      if (!scenario) return

      const stashPrevious = (): void => {
        const existingView = capacityPlanView
        if (!existingView) return
        const displacedId = existingView.scenarioId
        const displacedScenario = scenarios.find((item) => item.id === displacedId)
        const displacedOverrides = structuredClone(capacityPlanOverrides[displacedId] ?? {})
        const entry: PreviousCapacityPublish = {
          scenarioId: displacedId,
          scenarioName: displacedScenario?.name ?? existingView.scenarioName,
          savedAt: new Date().toISOString(),
          granularity: existingView.granularity,
          overrides: displacedOverrides,
          snapshot: existingView.snapshot,
          originalSnapshot: existingView.originalSnapshot,
        }
        setPreviousCapacityPublish((prev) => {
          const next: PreviousCapacityPublishStore = {
            lastDisplaced: entry,
            byScenario: {
              ...prev.byScenario,
              [displacedId]: entry,
            },
          }
          savePreviousCapacityPublishStore(next)
          return next
        })
      }

      // Keep a restore point whenever Open/Publish would overwrite an existing published plan.
      if (capacityPlanView) {
        stashPrevious()
      }

      const simulation = runSimulation(scenario, granularity)
      selectScenario(scenarioId)
      saveAsCapacityPlanView(scenarioId)
      const ledger = buildWeeklyPlanLedger(
        scenario,
        simulation,
        ledgerOverrides[scenarioId] ?? [],
        shrinkageCategoryStore[scenarioId] ?? [],
      )
      const publishedWeeks = buildCapacityOverridesFromSimulation(scenario, ledger, simulation)
      setCapacityPlanOverrides((prev) => {
        const next = mergePublishedCapacityOverrides(prev, scenarioId, publishedWeeks)
        saveCapacityPlanOverrides(next)
        return next
      })
      syncCapacityMatrixScope(scenarioId, loadCapacityMatrixView())
    },
    [
      capacityPlanOverrides,
      capacityPlanView,
      granularity,
      ledgerOverrides,
      saveAsCapacityPlanView,
      scenarios,
      selectScenario,
      shrinkageCategoryStore,
    ],
  )

  const hasPreviousCapacityPlan = useCallback(
    (scenarioId?: string) => {
      if (scenarioId) {
        return Boolean(
          previousCapacityPublish.lastDisplaced || previousCapacityPublish.byScenario[scenarioId],
        )
      }
      return Boolean(previousCapacityPublish.lastDisplaced)
    },
    [previousCapacityPublish],
  )

  const resetToPreviousCapacityPlan = useCallback(
    (scenarioId?: string) => {
      // Reset always restores the plan displaced by the most recent Open/Publish.
      // Fall back to per-scenario stash only when lastDisplaced is unavailable.
      const previous =
        previousCapacityPublish.lastDisplaced ??
        (scenarioId ? previousCapacityPublish.byScenario[scenarioId] ?? null : null)
      if (!previous) return false
      const target = scenarios.find((item) => item.id === previous.scenarioId)
      if (!target) return false

      setCapacityPlanOverrides((prev) => {
        const next = {
          ...prev,
          [previous.scenarioId]: structuredClone(previous.overrides),
        }
        saveCapacityPlanOverrides(next)
        return next
      })

      const view: CapacityPlanView = {
        scenarioId: previous.scenarioId,
        scenarioName: target.name,
        savedAt: new Date().toISOString(),
        granularity: previous.granularity,
        snapshot: previous.snapshot,
        originalSnapshot: previous.originalSnapshot ?? previous.snapshot,
      }
      saveCapacityPlanView(view)
      setCapacityPlanView(view)
      selectScenario(previous.scenarioId)
      syncCapacityMatrixScope(previous.scenarioId, loadCapacityMatrixView())

      setPreviousCapacityPublish((prev) => {
        const cleaned: PreviousCapacityPublishStore = {
          lastDisplaced: null,
          byScenario: { ...prev.byScenario },
        }
        delete cleaned.byScenario[previous.scenarioId]
        savePreviousCapacityPublishStore(cleaned)
        return cleaned
      })
      return true
    },
    [previousCapacityPublish, scenarios, selectScenario],
  )

  const accessibleScenarios = useMemo(() => {
    void planAccessRevision
    return scenarios.filter((scenario) => canAccessCapacityPlan(scenario, accessSubject))
  }, [accessSubject, planAccessRevision, scenarios])

  const canEditScenario = useCallback(
    (scenarioId: string) => {
      const scenario = scenarios.find((item) => item.id === scenarioId)
      if (!scenario) return false
      return canEditCapacityPlan(scenario, accessSubject)
    },
    [accessSubject, scenarios],
  )

  const createNewScenario = useCallback(
    (name: string, description = '', plan?: PlannerPlanMetadata, assumptionsOverride?: PlannerAssumptions) => {
      if (!allowCreate) {
        throw new Error('Your role cannot create capacity plans.')
      }
      const baseline = scenarios.find((s) => s.isBaseline) ?? scenarios[0]
      const assumptions = assumptionsOverride
        ? structuredClone(assumptionsOverride)
        : baseline
          ? structuredClone(baseline.assumptions)
          : createScenario(name).assumptions
      const nextPlan = plan ?? baseline?.plan
      const s = createScenario(name, description, assumptions, nextPlan, user?.email)
      const next = [...scenarios, s]
      persist(next)
      selectScenario(s.id)
      return s
    },
    [allowCreate, scenarios, persist, selectScenario, user?.email],
  )

  const cloneScenario = useCallback(
    (id: string, newName?: string) => {
      if (!allowCreate) {
        throw new Error('Your role cannot create capacity plans.')
      }
      const src = scenarios.find((s) => s.id === id)
      if (!src) return
      if (!canAccessCapacityPlan(src, accessSubject)) {
        throw new Error('You do not have access to this capacity plan.')
      }
      const s = createScenario(
        newName ?? `${src.name} (copy)`,
        src.description,
        structuredClone(src.assumptions),
        structuredClone(src.plan),
        user?.email,
      )
      s.isBaseline = false
      const next = [...scenarios, s]
      persist(next)
      if (rosterStore[id]?.length) {
        const nextRosterStore = {
          ...rosterStore,
          [s.id]: structuredClone(rosterStore[id]),
        }
        setRosterStore(nextRosterStore)
        saveRosterStore(nextRosterStore)
      }
      if (rosterSyncMetaStore[id]) {
        const nextSyncMeta = {
          ...rosterSyncMetaStore,
          [s.id]: { ...rosterSyncMetaStore[id], scenarioId: s.id },
        }
        setRosterSyncMetaStore(nextSyncMeta)
        saveRosterSyncMetaStore(nextSyncMeta)
      }
      selectScenario(s.id)
    },
    [accessSubject, allowCreate, persist, rosterStore, rosterSyncMetaStore, scenarios, selectScenario, user?.email],
  )

  const deleteScenario = useCallback(
    (id: string) => {
      const scenarioToDelete = scenarios.find((s) => s.id === id)
      if (!scenarioToDelete) return
      if (!canDeleteCapacityPlan(scenarioToDelete, accessSubject)) {
        throw new Error('You do not have access to delete this capacity plan.')
      }
      const next = scenarios.filter((s) => s.id !== id)
      if (!next.length) return
      persist(next)
      revokeAllPlanAccessForScenario(id)
      if (rosterStore[id]) {
        const nextRosterStore = { ...rosterStore }
        delete nextRosterStore[id]
        setRosterStore(nextRosterStore)
        saveRosterStore(nextRosterStore)
      }
      if (rosterSyncMetaStore[id]) {
        const nextSyncMeta = { ...rosterSyncMetaStore }
        delete nextSyncMeta[id]
        setRosterSyncMetaStore(nextSyncMeta)
        saveRosterSyncMetaStore(nextSyncMeta)
      }
      setCapacityPlanOverrides((prev) => {
        const cleaned = clearScenarioCapacityPlanOverrides(prev, id)
        saveCapacityPlanOverrides(cleaned)
        return cleaned
      })
      setStageAttritionOverrides((prev) => {
        const cleaned = clearScenarioStageAttritionOverrides(prev, id)
        saveStageAttritionOverrides(cleaned)
        return cleaned
      })
      setShrinkageCategoryStore((prev) => {
        const cleaned = clearScenarioShrinkageCategories(prev, id)
        saveShrinkageCategoryStore(cleaned)
        return cleaned
      })
      setLedgerOverrides((prev) => {
        const cleaned = { ...prev }
        delete cleaned[id]
        saveLedgerOverrides(cleaned)
        return cleaned
      })
      setForecastOverrides((prev) => {
        const cleaned = { ...prev }
        delete cleaned[id]
        saveForecastOverrides(cleaned)
        return cleaned
      })
      setPreviousCapacityPublish((prev) => {
        const cleaned = clearPreviousCapacityPublishForScenario(prev, id)
        savePreviousCapacityPublishStore(cleaned)
        return cleaned
      })
      clearScenarioDriverWeekLocks(id)
      if (capacityPlanView?.scenarioId === id) {
        const fallback = next.find((s) => s.isBaseline) ?? next[0]!
        const view: CapacityPlanView = {
          scenarioId: fallback.id,
          scenarioName: fallback.name,
          savedAt: new Date().toISOString(),
          granularity,
        }
        saveCapacityPlanView(view)
        setCapacityPlanView(view)
        syncCapacityMatrixScope(fallback.id, loadCapacityMatrixView())
      }
      if (scenarioToDelete?.plan.clientId && !next.some((item) => item.plan.clientId === scenarioToDelete.plan.clientId)) {
        deleteClientProfile(scenarioToDelete.plan.clientId)
      }
      if (activeId === id) selectScenario(next[0]!.id)
    },
    [
      accessSubject,
      activeId,
      capacityPlanView?.scenarioId,
      granularity,
      persist,
      rosterStore,
      rosterSyncMetaStore,
      scenarios,
      selectScenario,
    ],
  )

  const setBaseline = useCallback(
    (id: string) => {
      const next = scenarios.map((s) => ({ ...s, isBaseline: s.id === id, updatedAt: new Date().toISOString() }))
      persist(next)
    },
    [scenarios, persist],
  )

  const updateAssumptions = useCallback(
    (id: string, assumptions: PlannerAssumptions) => {
      const target = scenarios.find((s) => s.id === id)
      if (!target || !canEditCapacityPlan(target, accessSubject)) return
      const next = scenarios.map((s) =>
        s.id === id ? { ...s, assumptions: structuredClone(assumptions), updatedAt: new Date().toISOString() } : s,
      )
      persist(next)
    },
    [accessSubject, scenarios, persist],
  )

  const updateScenarioPlan = useCallback(
    (id: string, plan: PlannerPlanMetadata) => {
      const target = scenarios.find((s) => s.id === id)
      if (!target || !canEditCapacityPlan(target, accessSubject)) return
      const syncedPlan = syncClientProfileFromPlan(plan, target.plan.client)
      const next = scenarios.map((s) =>
        s.id === id ? { ...s, plan: syncedPlan, updatedAt: new Date().toISOString() } : s,
      )
      persist(next)
    },
    [accessSubject, scenarios, persist],
  )

  const applyScenarioPlanSettings = useCallback(
    (
      id: string,
      input: {
        plan: PlannerPlanMetadata
        assumptions: PlannerAssumptions
        scenarioName: string
        previousClientName?: string
      },
    ): boolean => {
      const target = scenarios.find((s) => s.id === id)
      if (!target || !canEditCapacityPlan(target, accessSubject)) return false

      const syncedPlan = syncClientProfileFromPlan(input.plan, input.previousClientName ?? target.plan.client)
      const trimmedName = input.scenarioName.trim()
      const next = scenarios.map((s) =>
        s.id === id
          ? {
              ...s,
              name: trimmedName || s.name,
              plan: syncedPlan,
              assumptions: structuredClone(input.assumptions),
              updatedAt: new Date().toISOString(),
            }
          : s,
      )
      persist(next)
      return true
    },
    [accessSubject, scenarios, persist],
  )

  const updateScenarioName = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim()
      if (!trimmed) return
      const next = scenarios.map((s) =>
        s.id === id ? { ...s, name: trimmed, updatedAt: new Date().toISOString() } : s,
      )
      persist(next)
    },
    [scenarios, persist],
  )

  const applyTemplate = useCallback(
    (templateId: string, scenarioId?: string) => {
      const tpl = SCENARIO_TEMPLATES.find((t) => t.id === templateId)
      if (!tpl) return
      const targetId = scenarioId ?? activeScenario?.id
      if (!targetId) return
      const target = scenarios.find((s) => s.id === targetId)
      if (!target) return
      const reference = scenarios.find((s) => s.isBaseline) ?? scenarios[0]
      const patch = tpl.patchFromReference
        ? tpl.patchFromReference(reference?.assumptions ?? target.assumptions, target.assumptions)
        : tpl.patch
      if (!patch) return
      let merged = mergeAssumptions(target.assumptions, patch as Partial<PlannerAssumptions>)
      merged = syncDerivedTenuredFields(syncBusinessDerivedFields(merged))
      updateAssumptions(targetId, merged)
    },
    [scenarios, activeScenario, updateAssumptions],
  )

  const hydrateCapacityStores = useCallback(() => {
    setCapacityPlanOverrides(loadCapacityPlanOverrides())
    setStageAttritionOverrides(loadStageAttritionOverrides())
    setShrinkageCategoryStore(loadShrinkageCategoryStore())
  }, [])

  const value: PlannerContextValue = {
    scenarios: accessibleScenarios,
    allScenarios: scenarios,
    canEditScenario,
    activeScenario,
    activeResult,
    granularity,
    setGranularity,
    comparisonIds,
    setComparisonIds,
    comparisonResults,
    comparisonTable,
    capacityPlanView,
    capacityPlanResult,
    activeLedger,
    getScenarioForecast,
    refreshAdvancedForecasts,
    getScenarioAdvancedSettings,
    updateForecastOverride,
    saveAsCapacityPlanView,
    publishScenarioToCapacity,
    resetToPreviousCapacityPlan,
    hasPreviousCapacityPlan,
    clearCapacityPlanViewLink,
    getScenarioResult,
    getScenarioLedger,
    getScenarioCapacityPlanOverrides,
    getScenarioStageAttritionOverrides,
    getScenarioShrinkageCategories,
    updatePlannedShrinkageCategory,
    updateActualShrinkageCategory,
    addScenarioShrinkageCategory,
    deleteScenarioShrinkageCategory,
    updateStageAttritionRate,
    clearCapacityPlanData,
    getScenarioRoster,
    saveScenarioRoster,
    getScenarioRosterSyncMeta,
    saveScenarioRosterSyncMeta,
    importActualOverrides,
    updateActualOverrideMetric,
    updatePlannedOverrideMetric,
    applyPlannedWeekOverrides,
    selectScenario,
    createNewScenario,
    cloneScenario,
    deleteScenario,
    setBaseline,
    updateAssumptions,
    updateScenarioPlan,
    applyScenarioPlanSettings,
    updateScenarioName,
    applyTemplate,
    hydrateCapacityStores,
  }

  return <PlannerContext.Provider value={value}>{children}</PlannerContext.Provider>
}

export function usePlanner(): PlannerContextValue {
  const ctx = useContext(PlannerContext)
  if (!ctx) throw new Error('usePlanner must be used within PlannerProvider')
  return ctx
}
