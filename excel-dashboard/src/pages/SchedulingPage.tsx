import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { HelpTip } from '../components/planner/HelpTip'
import { CollapsibleSection } from '../components/executive/CollapsibleSection'
import { StableNumberInput } from '../components/fields/StableNumberInput'
import { SchedulingGenerationStatus } from '../components/scheduling/SchedulingGenerationStatus'
import { ScheduleOptimizationHub } from '../components/scheduling/ScheduleOptimizationHub'
import { SchedulingDailyCharts } from '../components/scheduling/SchedulingDailyCharts'
import { SchedulingMetricsMatrixPanel } from '../components/scheduling/SchedulingMetricsMatrix'
import { ScenarioPicker } from '../components/planner/ScenarioPicker'
import { usePlanner } from '../context/PlannerContext'
import { useDemoSession } from '../context/DemoSessionContext'
import { SavedSchedulesLibrary } from '../components/scheduling/SavedSchedulesLibrary'
import { ScheduleDiagnosticsPanel } from '../components/scheduling/ScheduleDiagnosticsPanel'
import './schedulingPage.css'
import {
  capacityPlannedAbsenteeismPct,
  capacityPlannedInOfficeShrinkagePct,
  capacityPlannedProductionHc,
  capacityPlannedRequiredFte,
  capacityPlannedVlAllocationHc,
  deriveCapacityRowsForScenario,
  resolveCapacityRowForPlanningWeek,
} from '../planner/capacityLookup'
import { resolveCurrentCalendarWeek, snapToWeekStart } from '../planner/capacityWeekUtils'
import { fmtNum } from '../planner/format'
import { formatScenarioLabel } from '../planner/scenarioDisplay'
import { resolvePlanLob } from '../planner/planIdentity'
import {
  buildWeekIntervalPattern,
  hasUploadedPatternData,
  isPatternReady,
  parseIntervalPatternFile,
  reconcilePatternRowsToWeekDates,
} from '../planner/scheduling/intervalPattern'
import { allIntervalTimes, buildWeekDateKeys, formatDayLabel } from '../planner/scheduling/intervalSlots'
import {
  alignWorkspaceWeekStart,
  createDefaultSchedulingWorkspace,
  loadSchedulingWorkspace,
  resolveSchedulingWeekStart,
  saveSchedulingWorkspace,
} from '../planner/scheduling/persistence'
import {
  resolveDailyFteTargets,
  resolveProductionHc,
} from '../planner/scheduling/requirementGeneration'
import {
  analyzeUploadedPattern,
  buildDayVolumeWeights,
  resolveWeeklyFte,
} from '../planner/scheduling/schedulingEngine'
import { generateSchedulingPackage } from '../planner/scheduling/generateSchedule'
import { validateScheduleGeneration } from '../planner/scheduling/scheduleValidation'
import { listBlockSchedules } from '../planner/scheduling/blockSchedulePersistence'
import { loadSampleSchedulingBundle } from '../planner/scheduling/sampleSchedulingSeed'
import {
  agentNamesFromSchedulingAgents,
  eligibleRosterAgentsForScheduling,
  mergeAgentNames,
  padSchedulingAgents,
  resolvedAgentNames,
  rosterSupervisors,
  schedulingAgentsFromRoster,
} from '../planner/scheduling/scheduleRosterAgents'
import { defaultSchedulingRules } from '../planner/scheduling/scheduleOptimization'
import { restDayCountFromSettings, paidWorkingDaysFromSettings } from '../planner/scheduling/workingDaysUtils'
import {
  captureSchedulingChartsPng,
  downloadAgentScheduleExport,
  downloadBlob,
  downloadSchedulingExport,
} from '../planner/scheduling/schedulingExport'
import {
  downloadSampleIntervalPatternTemplate,
  SAMPLE_INTERVAL_WEEK_START,
} from '../planner/scheduling/sampleIntervalPattern'
import { downloadVolumeAhtTemplate } from '../planner/scheduling/sampleVolumeAht'
import { parseVolumeAhtFile } from '../planner/scheduling/volumeAhtPattern'
import {
  createArtifactId,
  deleteSavedComparison,
  deleteSavedRequirement,
  deleteSavedSchedule,
  draftScheduleId,
  listAllSavedSchedules,
  listSavedComparisons,
  listSavedRequirements,
  loadPersistedGeneratedPackage,
  persistGeneratedDraft,
  renameSavedSchedule,
  upsertSavedComparison,
  upsertSavedRequirement,
  upsertSavedSchedule,
  type SavedIntervalComparison,
  type SavedSchedulingRequirement,
  type SavedSchedulingSchedule,
} from '../planner/scheduling/schedulingArtifactPersistence'
import { applyAgentNamesToPackage, agentLabelForIndex, rebuildPackageFromAssignments, reapplyShrinkageToPackage, rebuildPackageFromRequirements, updateRequirementCell } from '../planner/scheduling/schedulingPackageUtils'
import { resolveBreakLunchColumns } from '../planner/scheduling/agentScheduleGrid'
import {
  buildApplyShrinkageOptions,
  clearApplyShrinkage,
  downloadShrinkageTemplate,
  effectiveApplyShrinkagePct,
  flatShrinkageAssumptionPct,
  parseShrinkageFile,
  withFlatShrinkageAssumption,
} from '../planner/scheduling/applyShrinkage'
import {
  parseScheduleDayCell,
  rebuildAssignmentsFromWeeklyGrid,
} from '../planner/scheduling/scheduleGridEdit'
import { settingsToSchedulingRules } from '../planner/scheduling/defaultSchedulingSettings'
import { flushWorkspaceSync } from '../data/workspaceSync'
import { clampOccupancyPct } from '../planner/scheduling/schedulingMetrics'
import { summarizeSchedulingPackage } from '../planner/scheduling/schedulingOutcomeSummary'
import { analyzeScheduleDemand } from '../planner/scheduling/scheduleDemandAnalytics'
import { analyzeServiceLevel } from '../planner/scheduling/serviceLevelOptimization'
import {
  buildCoverageOptimizedSettings,
  buildScheduleRecommendations,
  scenarioSnapshotFromPackage,
  type ScheduleRecommendation,
  type ScheduleScenarioSnapshot,
} from '../planner/scheduling/scheduleAdvisor'
import type {
  FteSourceMode,
  GeneratedSchedulingPackage,
  ScheduleHcSourceMode,
  SchedulingQualityInputs,
  SchedulingRules,
  SchedulingWorkspace,
} from '../planner/scheduling/types'

function fmtStaffingPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${value.toFixed(1)}%`
}

function fmtOccupancyPct(value: number | null | undefined): string {
  const capped = clampOccupancyPct(value)
  if (capped == null) return '—'
  return `${capped.toFixed(1)}%`
}

function fmtProjectedSl(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${value.toFixed(1)}%`
}

function projectedSlClass(value: number | null | undefined, slaTarget: number): string {
  if (value == null || !Number.isFinite(value)) return ''
  if (value >= slaTarget) return 'sched-variance--match'
  if (value >= slaTarget * 0.9) return ''
  return 'sched-variance--under'
}

function intervalProjectedSl(
  row: { projectedSlPct?: number | null; projectedSlErlangPct?: number | null },
  useErlang: boolean,
): number | null {
  if (useErlang) return row.projectedSlErlangPct ?? null
  return row.projectedSlPct ?? null
}

function varianceClass(variance: number): string {
  if (variance > 0.01) return 'sched-variance--over'
  if (variance < -0.01) return 'sched-variance--under'
  return 'sched-variance--match'
}

type TableView = 'daily' | 'requirements' | 'comparison' | 'schedules'

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 48)
    })
  })
}

export function SchedulingPage() {
  const {
    scenarios,
    activeScenario,
    getScenarioLedger,
    getScenarioForecast,
    getScenarioCapacityPlanOverrides,
    getScenarioRoster,
  } = usePlanner()
  const { user } = useDemoSession()

  const [workspace, setWorkspace] = useState<SchedulingWorkspace>(() => {
    const saved = loadSchedulingWorkspace()
    const initialScenario = activeScenario ?? scenarios[0] ?? null
    if (saved) {
      if (!saved.rules?.settings) saved.rules = defaultSchedulingRules()
      return alignWorkspaceWeekStart(saved, initialScenario)
    }
    return createDefaultSchedulingWorkspace(
      initialScenario?.id ?? '',
      undefined,
      initialScenario,
    )
  })
  const [generated, setGenerated] = useState<GeneratedSchedulingPackage | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [volumeUploadError, setVolumeUploadError] = useState<string | null>(null)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [tableView, setTableView] = useState<TableView>('requirements')
  const [selectedChartDay, setSelectedChartDay] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [agentNames, setAgentNames] = useState<Record<string, string>>({})
  const [savedRequirements, setSavedRequirements] = useState<SavedSchedulingRequirement[]>([])
  const [savedLibrary, setSavedLibrary] = useState<SavedSchedulingSchedule[]>([])
  const [activeLibraryId, setActiveLibraryId] = useState<string | null>(null)
  const [savedComparisons, setSavedComparisons] = useState<SavedIntervalComparison[]>([])
  const [requirementSaveName, setRequirementSaveName] = useState('')
  const [scheduleSaveName, setScheduleSaveName] = useState('')
  const [comparisonSaveName, setComparisonSaveName] = useState('')
  const [showErlangSl, setShowErlangSl] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatePhase, setGeneratePhase] = useState<string | null>(null)
  const [originalView, setOriginalView] = useState<{
    rules: SchedulingRules
    outcome: ReturnType<typeof summarizeSchedulingPackage>
  } | null>(null)
  const skipOriginalCaptureRef = useRef(false)
  const shrinkageSeededRef = useRef(false)
  const [comparingScenarios, setComparingScenarios] = useState(false)
  const [scenarioSnapshots, setScenarioSnapshots] = useState<ScheduleScenarioSnapshot[]>([])
  const scenarioBundleRef = useRef<{
    optimized: { pkg: GeneratedSchedulingPackage; rules: SchedulingRules } | null
    staffing: { pkg: GeneratedSchedulingPackage; extraAgents: number; hc: number } | null
  }>({ optimized: null, staffing: null })
  const [artifactNotice, setArtifactNotice] = useState<string | null>(null)
  const [showCoverageCheck, setShowCoverageCheck] = useState(false)
  const [showOptimization, setShowOptimization] = useState(false)
  const [scheduleEditError, setScheduleEditError] = useState<string | null>(null)
  const [scheduleGridDirty, setScheduleGridDirty] = useState(false)
  const [editedScheduleRows, setEditedScheduleRows] = useState<
    GeneratedSchedulingPackage['weeklyAgentGrid']['rows'] | null
  >(null)
  const [shrinkageUploadError, setShrinkageUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const volumeFileInputRef = useRef<HTMLInputElement>(null)
  const shrinkageFileInputRef = useRef<HTMLInputElement>(null)
  const chartsRef = useRef<HTMLDivElement>(null)

  const scenario = useMemo(
    () => scenarios.find((item) => item.id === workspace.scenarioId) ?? activeScenario ?? scenarios[0] ?? null,
    [activeScenario, scenarios, workspace.scenarioId],
  )

  const weekDates = useMemo(() => buildWeekDateKeys(workspace.weekStartIso), [workspace.weekStartIso])
  const intervalColumns = useMemo(() => allIntervalTimes(), [])

  const capacityRow = useMemo(() => {
    if (!scenario) return null
    const forecast = getScenarioForecast(scenario.id, 52)
    const rows = deriveCapacityRowsForScenario(
      getScenarioLedger(scenario.id),
      scenario,
      forecast,
      getScenarioCapacityPlanOverrides(scenario.id),
    )
    return resolveCapacityRowForPlanningWeek(rows, scenario, workspace.weekStartIso)
  }, [getScenarioCapacityPlanOverrides, getScenarioForecast, getScenarioLedger, scenario, workspace.weekStartIso])

  const pattern = useMemo(() => workspace.normalizedPattern, [workspace.normalizedPattern])

  const reconciledPatternRows = useMemo(
    () => reconcilePatternRowsToWeekDates(workspace.rawPattern, weekDates),
    [workspace.rawPattern, weekDates],
  )

  const patternMeta = useMemo(
    () => analyzeUploadedPattern(reconciledPatternRows, weekDates),
    [reconciledPatternRows, weekDates],
  )

  const schedulingWeekStart = useMemo(
    () => resolveSchedulingWeekStart(scenario, workspace.rules.settings),
    [scenario, workspace.rules.settings],
  )

  const patternUploaded = useMemo(
    () => hasUploadedPatternData(workspace.rawPattern, weekDates),
    [workspace.rawPattern, weekDates],
  )
  const patternReady = useMemo(() => {
    if (!patternUploaded) return false
    const live = buildWeekIntervalPattern(reconciledPatternRows, weekDates)
    return isPatternReady(live, weekDates)
  }, [patternUploaded, reconciledPatternRows, weekDates])
  const settingsReady = Boolean(workspace.settingsConfirmedAt)

  const persist = useCallback((next: SchedulingWorkspace) => {
    setWorkspace(next)
    saveSchedulingWorkspace(next)
  }, [])

  // Keep stored pattern ISO dates aligned to the current Sunday/Monday week.
  useEffect(() => {
    if (!workspace.rawPattern.length) return
    const weekSet = new Set(weekDates)
    const needsAlign = workspace.rawPattern.some((row) => row.value > 0 && !weekSet.has(row.day))
    if (!needsAlign) return
    const reconciled = reconcilePatternRowsToWeekDates(workspace.rawPattern, weekDates)
    persist({
      ...workspace,
      rawPattern: reconciled,
      normalizedPattern: buildWeekIntervalPattern(reconciled, weekDates),
      lastGeneratedAt: null,
    })
    setGenerated(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run when week or raw pattern day keys drift
  }, [weekDates, workspace.rawPattern, persist])

  useEffect(() => {
    if (!scenario) return
    const aligned = alignWorkspaceWeekStart(workspace, scenario)
    if (
      aligned.weekStartIso === workspace.weekStartIso &&
      aligned.rules.settings.weekStartDay === workspace.rules.settings.weekStartDay
    ) {
      return
    }
    persist(aligned)
    setGenerated(null)
    // Align when First working day / calendar week boundary changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snap only on boundary-relevant fields
  }, [
    scenario?.id,
    scenario?.plan.weekStart,
    workspace.rules.settings.weekStartDay,
    workspace.rules.settings.workingWeekStartDay,
    persist,
  ])

  useEffect(() => {
    const syncFromStorage = () => {
      const saved = loadSchedulingWorkspace()
      if (!saved) return
      const aligned = alignWorkspaceWeekStart(saved, scenario)
      setWorkspace(aligned)
    }
    window.addEventListener('focus', syncFromStorage)
    return () => window.removeEventListener('focus', syncFromStorage)
  }, [scenario])

  const qualityInputs = useMemo<SchedulingQualityInputs>(() => {
    const applied = effectiveApplyShrinkagePct(workspace)
    return {
      slaPercent: workspace.slaPercent,
      slaSeconds: workspace.slaSeconds,
      /** Prefer Apply Shrinkage so Staffing quality matrix stays in sync with Interval Comparison. */
      shrinkagePct: applied > 0 ? applied : workspace.shrinkagePct,
      volumeAhtRows: workspace.volumeAhtRows,
    }
  }, [
    workspace.slaPercent,
    workspace.slaSeconds,
    workspace.shrinkagePct,
    workspace.volumeAhtRows,
    workspace.applyAbsenteeismPct,
    workspace.applyInOfficePct,
    workspace.intervalApplyShrinkagePct,
    workspace.applyShrinkageMode,
  ])

  const capacityAbsenteeismPct100 = useMemo(
    () => Math.round(capacityPlannedAbsenteeismPct(capacityRow) * 10000) / 100,
    [capacityRow],
  )
  const capacityInOfficePct100 = useMemo(
    () => Math.round(capacityPlannedInOfficeShrinkagePct(capacityRow) * 10000) / 100,
    [capacityRow],
  )
  const capacityVlHc = useMemo(() => capacityPlannedVlAllocationHc(capacityRow), [capacityRow])
  const resolvedVlHc = useMemo(
    () => (workspace.vlHcOverride != null ? Math.max(0, Math.round(workspace.vlHcOverride)) : capacityVlHc),
    [capacityVlHc, workspace.vlHcOverride],
  )
  const applyShrinkageOptions = useMemo(() => buildApplyShrinkageOptions(workspace), [workspace])
  const schedulesLocked = workspace.schedulesLocked !== false

  // Seed apply-shrinkage from Capacity once when both workspace values are still 0.
  useEffect(() => {
    if (shrinkageSeededRef.current) return
    if ((workspace.applyAbsenteeismPct ?? 0) !== 0 || (workspace.applyInOfficePct ?? 0) !== 0) {
      shrinkageSeededRef.current = true
      return
    }
    if (capacityAbsenteeismPct100 <= 0 && capacityInOfficePct100 <= 0) return
    shrinkageSeededRef.current = true
    persist(
      withFlatShrinkageAssumption(
        workspace,
        Math.max(0, Math.min(100, capacityAbsenteeismPct100 + capacityInOfficePct100)),
      ),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed only once from capacity defaults
  }, [capacityAbsenteeismPct100, capacityInOfficePct100, workspace.applyAbsenteeismPct, workspace.applyInOfficePct])

  useEffect(() => {
    setEditedScheduleRows(null)
    setScheduleGridDirty(false)
    setScheduleEditError(null)
  }, [generated?.generatedAt])

  const rosterEmployees = useMemo(
    () => (scenario ? getScenarioRoster(scenario.id) : []),
    [getScenarioRoster, scenario],
  )
  const eligibleRoster = useMemo(
    () => eligibleRosterAgentsForScheduling(rosterEmployees),
    [rosterEmployees],
  )
  const teamSupervisor = workspace.teamSupervisor ?? ''
  const schedulingAgents = useMemo(
    () => schedulingAgentsFromRoster(eligibleRoster, teamSupervisor || undefined),
    [eligibleRoster, teamSupervisor],
  )
  const supervisorOptions = useMemo(() => rosterSupervisors(eligibleRoster), [eligibleRoster])
  const rosterHc = schedulingAgents.length
  const currentProductionHc = useMemo(
    () =>
      resolveProductionHc(
        capacityRow,
        workspace.scheduleHcSource,
        workspace.manualProductionHc,
        schedulingAgents.length,
      ),
    [capacityRow, schedulingAgents.length, workspace.manualProductionHc, workspace.scheduleHcSource],
  )
  const blockSchedules = useMemo(
    () => (scenario ? listBlockSchedules(scenario.id) : []),
    [scenario],
  )

  const refreshSavedArtifacts = useCallback(() => {
    setSavedRequirements(listSavedRequirements(workspace.scenarioId, workspace.weekStartIso))
    setSavedLibrary(listAllSavedSchedules())
    setSavedComparisons(listSavedComparisons(workspace.scenarioId, workspace.weekStartIso))
  }, [workspace.scenarioId, workspace.weekStartIso])

  useEffect(() => {
    refreshSavedArtifacts()
    const persisted = loadPersistedGeneratedPackage(workspace.scenarioId, workspace.weekStartIso)
    if (persisted && workspace.lastGeneratedAt && patternUploaded) {
      const names = resolvedAgentNames(persisted.agentNames ?? {}, persisted.productionHc)
      setGenerated(applyAgentNamesToPackage(persisted, names))
      setAgentNames(names)
      return
    }
    if (!patternUploaded) setGenerated(null)
  }, [patternUploaded, refreshSavedArtifacts, workspace.lastGeneratedAt, workspace.scenarioId, workspace.weekStartIso])

  const regenerateSchedulesFromRequirements = useCallback(
    (requirementTable: GeneratedSchedulingPackage['requirementTable']) => {
      if (!generated) return null
      const next = rebuildPackageFromRequirements(
        requirementTable,
        generated.productionHc,
        weekDates,
        workspace.rules,
        generated.patternMeta,
        workspace.rawPattern,
        pattern,
        qualityInputs,
        agentNames,
        { vlHc: resolvedVlHc, applyShrinkage: applyShrinkageOptions },
      )
      setGenerated(next)
      persist({ ...workspace, lastGeneratedAt: next.generatedAt })
      return next
    },
    [
      agentNames,
      applyShrinkageOptions,
      generated,
      pattern,
      persist,
      qualityInputs,
      resolvedVlHc,
      weekDates,
      workspace,
    ],
  )

  useEffect(() => {
    if (!scenario) return
    const sample = loadSampleSchedulingBundle(scenario.id)
    if (workspace.scenarioId === scenario.id) {
      if (!generated && sample) {
        setGenerated(sample.draft.package)
        setTableView('requirements')
      }
      return
    }
    if (sample) {
      persist(sample.workspace)
      setGenerated(sample.draft.package)
      setTableView('requirements')
      setUploadError(null)
      setGenerateError(null)
      return
    }
    persist(
      createDefaultSchedulingWorkspace(
        scenario.id,
        resolveCurrentCalendarWeek(scenario.plan.weekStart, scenario.plan.timezone),
        scenario,
      ),
    )
    setGenerated(null)
  }, [generated, persist, scenario, workspace.scenarioId])

  const handlePatternUpload = async (file: File) => {
    setUploadError(null)
    setGenerated(null)
    const parsed = await parseIntervalPatternFile(file, workspace.weekStartIso)
    if (parsed.errors.length) {
      setUploadError(parsed.errors.join(' '))
      return
    }
    const normalizedPattern = buildWeekIntervalPattern(parsed.rows, weekDates)
    persist({
      ...workspace,
      patternLabel: file.name,
      patternUploadedAt: new Date().toISOString(),
      rawPattern: parsed.rows,
      normalizedPattern,
    })
  }

  const handleVolumeAhtUpload = async (file: File) => {
    setVolumeUploadError(null)
    setGenerated(null)
    const parsed = await parseVolumeAhtFile(file, workspace.weekStartIso)
    if (parsed.errors.length) {
      setVolumeUploadError(parsed.errors.join(' '))
      return
    }
    persist({
      ...workspace,
      volumeAhtLabel: file.name,
      volumeAhtUploadedAt: new Date().toISOString(),
      volumeAhtRows: parsed.rows,
    })
  }

  const runGenerateAsync = useCallback(
    async (options?: {
      rulesOverride?: SchedulingRules
      appliedSuggestionId?: string
      hcOverride?: number
      commit?: boolean
      manageStatus?: boolean
    }) => {
      const rulesOverride = options?.rulesOverride
      const appliedSuggestionId = options?.appliedSuggestionId
      const commit = options?.commit !== false
      const manageStatus = options?.manageStatus !== false
      const hypotheticalHc = options?.hcOverride != null

      setGenerateError(null)
      if (manageStatus) {
        setIsGenerating(true)
        setGeneratePhase('Waiting Status — working on your request…')
        await yieldToMain()
      }

      const rules = rulesOverride ?? workspace.rules
      const useRoster = workspace.scheduleHcSource === 'roster' && !hypotheticalHc
      const weeklyFte = resolveWeeklyFte(capacityRow, workspace.fteSource, workspace.manualWeeklyFte)
      const productionHc =
        options?.hcOverride ??
        resolveProductionHc(
          capacityRow,
          workspace.scheduleHcSource,
          workspace.manualProductionHc,
          schedulingAgents.length,
        )
      const sourceAgents = workspace.scheduleHcSource === 'roster' ? schedulingAgents : []
      const agents = padSchedulingAgents(sourceAgents, productionHc)
      const names = mergeAgentNames(agentNamesFromSchedulingAgents(agents), agentNames)
      const dayWeights = buildDayVolumeWeights(reconciledPatternRows, weekDates)
      const workingDayIsos =
        patternMeta.workingDays.length > 0
          ? patternMeta.workingDays
          : weekDates.filter((day) => (dayWeights[day] ?? 0) > 0)
      const paidWorkingDays = paidWorkingDaysFromSettings(rules.settings)
      const dailyFteTargets = resolveDailyFteTargets(
        weekDates,
        weeklyFte,
        dayWeights,
        workspace.manualDailyFteByDay,
        workingDayIsos,
        paidWorkingDays,
      )
      const livePattern = buildWeekIntervalPattern(reconciledPatternRows, weekDates)
      const validationErrors = validateScheduleGeneration({
        settingsConfirmed: Boolean(workspace.settingsConfirmedAt),
        patternRows: reconciledPatternRows,
        weeklyFte,
        productionHc,
        rosterAgents: eligibleRoster,
        useRoster,
        settings: rules.settings,
        teamSupervisor: teamSupervisor || undefined,
      })
      if (validationErrors.length) {
        setGenerateError(validationErrors.join(' '))
        if (commit) setGenerated(null)
        if (manageStatus) {
          setIsGenerating(false)
          setGeneratePhase(null)
        }
        return null
      }

      if (manageStatus) {
        setGeneratePhase('Validating roster, interval demand, and scheduling rules…')
        await yieldToMain()
        setGeneratePhase('Analyzing peaks, valleys, and available headcount…')
        await yieldToMain()
        setGeneratePhase('Assigning agents to required intervals…')
        await yieldToMain()
        setGeneratePhase('Optimizing coverage without relaxing shift or rest rules…')
        await yieldToMain()
      }

      try {
        const result = await generateSchedulingPackage({
          settingsConfirmed: Boolean(workspace.settingsConfirmedAt),
          patternRows: reconciledPatternRows,
          weeklyFte,
          productionHc,
          rosterAgents: eligibleRoster,
          useRoster,
          teamSupervisor: teamSupervisor || undefined,
          pattern: livePattern,
          weekDates,
          dailyFteTargets,
          rules,
          qualityInputs,
          agentNames: names,
          agents,
          blockSchedules: scenario ? listBlockSchedules(scenario.id) : [],
          vlHc: resolvedVlHc,
          applyShrinkage: applyShrinkageOptions,
        })
        if (!result.ok) {
          setGenerateError(result.errors.join(' '))
          if (commit) setGenerated(null)
          return null
        }
        const pkg = result.pkg
        if (manageStatus) {
          setGeneratePhase(`Scoring service level and staffing gaps · ${result.engineNote}`)
          await yieldToMain()
        }
        if (!commit) return pkg

        setGenerated(pkg)
        setAgentNames(resolvedAgentNames(pkg.agentNames ?? names, pkg.productionHc))
        setSelectedChartDay(pkg.schedulingResult.days.find((day) => !day.isClosed)?.day ?? pkg.schedulingResult.days[0]?.day ?? null)
        persist({
          ...workspace,
          rules,
          lastGeneratedAt: pkg.generatedAt,
          settingsConfirmedAt: workspace.settingsConfirmedAt ?? new Date().toISOString(),
          ...(hypotheticalHc
            ? { scheduleHcSource: 'manual' as const, manualProductionHc: productionHc }
            : {}),
        })
        setScenarioSnapshots([])
        scenarioBundleRef.current = { optimized: null, staffing: null }
        const draft = persistGeneratedDraft({
          id: draftScheduleId(workspace.scenarioId, workspace.weekStartIso, teamSupervisor),
          name: `Draft · ${scenario ? formatScenarioLabel(scenario) : 'schedule'} · week of ${workspace.weekStartIso}`,
          scenarioId: workspace.scenarioId,
          weekStartIso: workspace.weekStartIso,
          clientName: scenario?.plan.client,
          lobName: scenario ? resolvePlanLob(scenario.plan) : undefined,
          teamSupervisor: teamSupervisor || undefined,
          coverageStart: weekDates[0],
          coverageEnd: weekDates[weekDates.length - 1],
          createdBy: user?.email,
          engine: pkg.engine,
          settingsSnapshot: rules.settings,
          package: pkg,
          agentNames: pkg.agentNames ?? names,
          generatedAt: pkg.generatedAt,
        })
        setActiveLibraryId(draft.id)
        refreshSavedArtifacts()
        if (!skipOriginalCaptureRef.current && !appliedSuggestionId) {
          setOriginalView({
            rules: structuredClone(rules),
            outcome: summarizeSchedulingPackage(pkg),
          })
        }
        skipOriginalCaptureRef.current = false
        return pkg
      } finally {
        if (manageStatus) {
          setIsGenerating(false)
          setGeneratePhase(null)
        }
      }
    },
    [
      agentNames,
      applyShrinkageOptions,
      capacityRow,
      eligibleRoster,
      patternMeta.workingDays,
      persist,
      qualityInputs,
      reconciledPatternRows,
      refreshSavedArtifacts,
      resolvedVlHc,
      scenario,
      schedulingAgents,
      teamSupervisor,
      user?.email,
      weekDates,
      workspace,
    ],
  )

  const handleGenerate = () => {
    void runGenerateAsync()
  }

  const demandAnalytics = useMemo(
    () => (generated ? analyzeScheduleDemand(generated) : null),
    [generated],
  )
  const serviceLevelInsight = useMemo(
    () =>
      generated
        ? analyzeServiceLevel(
            generated,
            workspace.slaPercent,
            workspace.slaSeconds,
            workspace.rules.settings.scheduleIntervalMinutes,
            workspace.volumeAhtRows,
          )
        : null,
    [
      generated,
      workspace.rules.settings.scheduleIntervalMinutes,
      workspace.slaPercent,
      workspace.slaSeconds,
      workspace.volumeAhtRows,
    ],
  )
  const scheduleRecommendations = useMemo(
    () =>
      demandAnalytics && serviceLevelInsight
        ? buildScheduleRecommendations(workspace.rules.settings, demandAnalytics, serviceLevelInsight)
        : [],
    [demandAnalytics, serviceLevelInsight, workspace.rules.settings],
  )

  const hasDeviatedFromOriginalView = useMemo(() => {
    if (!originalView) return false
    return JSON.stringify(workspace.rules.settings) !== JSON.stringify(originalView.rules.settings)
  }, [originalView, workspace.rules.settings])

  const handleResetOriginalView = () => {
    if (!originalView || isGenerating) return
    persist({
      ...workspace,
      rules: originalView.rules,
      settingsConfirmedAt: workspace.settingsConfirmedAt ?? new Date().toISOString(),
    })
    setArtifactNotice('Restored original scheduling settings.')
    skipOriginalCaptureRef.current = true
    void runGenerateAsync({ rulesOverride: originalView.rules })
  }

  const applyLivePackage = useCallback(
    (pkg: GeneratedSchedulingPackage, rules: SchedulingRules, workspacePatch?: Partial<SchedulingWorkspace>) => {
      setGenerated(pkg)
      setAgentNames(resolvedAgentNames(pkg.agentNames ?? agentNames, pkg.productionHc))
      setSelectedChartDay(
        pkg.schedulingResult.days.find((day) => !day.isClosed)?.day ?? pkg.schedulingResult.days[0]?.day ?? null,
      )
      persist({
        ...workspace,
        ...workspacePatch,
        rules,
        lastGeneratedAt: pkg.generatedAt,
        settingsConfirmedAt: workspace.settingsConfirmedAt ?? new Date().toISOString(),
      })
      const draft = persistGeneratedDraft({
        id: draftScheduleId(workspace.scenarioId, workspace.weekStartIso, teamSupervisor),
        name: `Draft · ${scenario ? formatScenarioLabel(scenario) : 'schedule'} · week of ${workspace.weekStartIso}`,
        scenarioId: workspace.scenarioId,
        weekStartIso: workspace.weekStartIso,
        clientName: scenario?.plan.client,
        lobName: scenario ? resolvePlanLob(scenario.plan) : undefined,
        teamSupervisor: teamSupervisor || undefined,
        coverageStart: weekDates[0],
        coverageEnd: weekDates[weekDates.length - 1],
        createdBy: user?.email,
        engine: pkg.engine,
        settingsSnapshot: rules.settings,
        package: pkg,
        agentNames: pkg.agentNames ?? agentNames,
        generatedAt: pkg.generatedAt,
      })
      setActiveLibraryId(draft.id)
      refreshSavedArtifacts()
    },
    [
      agentNames,
      persist,
      refreshSavedArtifacts,
      scenario,
      teamSupervisor,
      user?.email,
      weekDates,
      workspace,
    ],
  )

  const handleApplyRecommendation = (item: ScheduleRecommendation) => {
    if (isGenerating) return
    setIsGenerating(true)
    setGeneratePhase(`Waiting Status — applying “${item.title}”…`)
    if (item.applySettings) {
      const nextRules = settingsToSchedulingRules(item.applySettings(workspace.rules.settings))
      persist({ ...workspace, rules: nextRules, settingsConfirmedAt: new Date().toISOString() })
      setArtifactNotice(`Applied “${item.title}” and regenerated with the same rule engine.`)
      void runGenerateAsync({ rulesOverride: nextRules, appliedSuggestionId: item.id })
      return
    }
    if (item.extraAgents && item.extraAgents > 0) {
      const nextHc = currentProductionHc + item.extraAgents
      persist({
        ...workspace,
        scheduleHcSource: 'manual',
        manualProductionHc: nextHc,
      })
      setArtifactNotice(`Using ${nextHc} schedules (${item.extraAgents} additional) and regenerating.`)
      void runGenerateAsync({ hcOverride: nextHc, appliedSuggestionId: item.id })
      return
    }
    setIsGenerating(false)
    setGeneratePhase(null)
  }

  const handleRunScenarios = async () => {
    if (!generated || isGenerating || comparingScenarios) return
    setComparingScenarios(true)
    setGenerateError(null)
    try {
      const optimized = buildCoverageOptimizedSettings(workspace.rules.settings)
      const optimizedRules = settingsToSchedulingRules(optimized.settings)
      const extraAgents = serviceLevelInsight?.recommendedExtraAgents ?? 0
      const staffingHc = currentProductionHc + extraAgents

      const [optimizedPkg, staffingPkg] = await Promise.all([
        optimized.changes.length === 0
          ? Promise.resolve(generated)
          : runGenerateAsync({
              rulesOverride: optimizedRules,
              commit: false,
              manageStatus: false,
            }),
        extraAgents > 0
          ? runGenerateAsync({
              hcOverride: staffingHc,
              commit: false,
              manageStatus: false,
            })
          : Promise.resolve(generated),
      ])

      const currentSnap = scenarioSnapshotFromPackage(
        'current',
        'Current settings',
        'Confirmed rules and current HC. Shift length and rest days are unchanged.',
        generated,
      )
      const optimizedSnap = scenarioSnapshotFromPackage(
        'optimized',
        'Optimized settings',
        optimized.changes.length
          ? `Same HC. ${optimized.changes.join(', ')}.`
          : 'Current settings are already using coverage-optimized start and relief options.',
        optimizedPkg ?? generated,
      )
      const staffingSnap = scenarioSnapshotFromPackage(
        'staffing',
        'Additional staffing',
        extraAgents > 0
          ? `Same rules with ${extraAgents} extra schedule${extraAgents === 1 ? '' : 's'} (${staffingHc} HC). Minimum HC to close the weakest interval — not week-wide overstaffing.`
          : 'No extra schedules are indicated. Coverage or service level is limited by rules, not headcount.',
        staffingPkg ?? generated,
        extraAgents,
      )
      scenarioBundleRef.current = {
        optimized: optimizedPkg ? { pkg: optimizedPkg, rules: optimizedRules } : null,
        staffing: staffingPkg && extraAgents > 0 ? { pkg: staffingPkg, extraAgents, hc: staffingHc } : null,
      }
      setScenarioSnapshots([currentSnap, optimizedSnap, staffingSnap])
    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : 'Scenario comparison failed.')
    } finally {
      setComparingScenarios(false)
    }
  }

  const handleApplyScenario = (id: ScheduleScenarioSnapshot['id']) => {
    if (isGenerating) return
    setIsGenerating(true)
    setGeneratePhase('Waiting Status — applying scenario…')
    void (async () => {
      await yieldToMain()
      try {
        if (id === 'optimized') {
          const bundle = scenarioBundleRef.current.optimized
          if (!bundle) return
          setArtifactNotice('Applied optimized settings scenario as the live draft.')
          applyLivePackage(bundle.pkg, bundle.rules)
          return
        }
        if (id === 'staffing') {
          const bundle = scenarioBundleRef.current.staffing
          if (!bundle) return
          setArtifactNotice(`Applied additional staffing scenario (${bundle.hc} schedules).`)
          applyLivePackage(bundle.pkg, workspace.rules, {
            scheduleHcSource: 'manual',
            manualProductionHc: bundle.hc,
          })
        }
      } finally {
        setIsGenerating(false)
        setGeneratePhase(null)
      }
    })()
  }

  const handleExportExcel = async () => {
    if (!generated || !scenario) return
    if (scheduleGridDirty && !workspace.schedulesLocked) {
      setScheduleEditError('Save or discard schedule grid edits before exporting.')
      return
    }
    setIsExporting(true)
    try {
      downloadSchedulingExport(generated, formatScenarioLabel(scenario), workspace.rules.settings)
      const chartRoots = chartsRef.current
        ? Array.from(chartsRef.current.querySelectorAll<HTMLElement>('[data-sched-chart]'))
        : []
      if (chartRoots.length) {
        const png = await captureSchedulingChartsPng(chartRoots)
        if (png) downloadBlob(png, 'Scheduling_Charts.png')
      }
    } finally {
      setIsExporting(false)
    }
  }

  const updateFteSource = (fteSource: FteSourceMode) => {
    setGenerated(null)
    persist({ ...workspace, fteSource })
  }
  const updateHcSource = (scheduleHcSource: ScheduleHcSourceMode) => {
    setGenerated(null)
    persist({ ...workspace, scheduleHcSource })
  }

  const handleSaveRequirements = () => {
    if (!generated || !requirementSaveName.trim()) return
    const label = requirementSaveName.trim()
    upsertSavedRequirement({
      id: createArtifactId('req'),
      name: label,
      scenarioId: workspace.scenarioId,
      weekStartIso: workspace.weekStartIso,
      requirementTable: generated.requirementTable,
      savedAt: new Date().toISOString(),
    })
    setRequirementSaveName('')
    setArtifactNotice(`Saved requirements "${label}".`)
    refreshSavedArtifacts()
  }

  const handleLoadRequirements = (entry: SavedSchedulingRequirement) => {
    regenerateSchedulesFromRequirements(entry.requirementTable)
    setArtifactNotice(`Loaded requirements "${entry.name}" and regenerated schedules.`)
  }

  const handleDeleteRequirements = (id: string) => {
    deleteSavedRequirement(id)
    refreshSavedArtifacts()
    setArtifactNotice('Deleted saved requirements.')
  }

  const handleSaveSchedule = () => {
    if (!generated || !scheduleSaveName.trim()) return
    if (scheduleGridDirty && !workspace.schedulesLocked) {
      setScheduleEditError('Save or discard schedule grid edits before saving to the library.')
      return
    }
    const label = scheduleSaveName.trim()
    const named = applyAgentNamesToPackage({ ...generated, status: 'saved' }, agentNames)
    setGenerated(named)
    const saved = upsertSavedSchedule({
      id: createArtifactId('sched'),
      name: label,
      status: 'saved',
      scenarioId: workspace.scenarioId,
      weekStartIso: workspace.weekStartIso,
      clientName: scenario?.plan.client,
      lobName: scenario ? resolvePlanLob(scenario.plan) : undefined,
      teamSupervisor: generated.teamSupervisor || teamSupervisor || undefined,
      coverageStart: weekDates[0],
      coverageEnd: weekDates[weekDates.length - 1],
      createdBy: user?.email,
      engine: named.engine,
      settingsSnapshot: workspace.rules.settings,
      package: named,
      agentNames,
      savedAt: new Date().toISOString(),
      generatedAt: named.generatedAt,
    })
    setActiveLibraryId(saved.id)
    setScheduleSaveName('')
    setArtifactNotice(`Saved schedule "${label}" to the library.`)
    refreshSavedArtifacts()
    void flushWorkspaceSync()
  }

  const handleLoadSchedule = (entry: SavedSchedulingSchedule) => {
    if (entry.settingsSnapshot) {
      persist({
        ...workspace,
        scenarioId: entry.scenarioId,
        weekStartIso: entry.weekStartIso,
        teamSupervisor: entry.teamSupervisor ?? workspace.teamSupervisor,
        rules: settingsToSchedulingRules(entry.settingsSnapshot),
        settingsConfirmedAt: workspace.settingsConfirmedAt ?? new Date().toISOString(),
        lastGeneratedAt: entry.package.generatedAt,
      })
    } else {
      persist({
        ...workspace,
        scenarioId: entry.scenarioId,
        weekStartIso: entry.weekStartIso,
        lastGeneratedAt: entry.package.generatedAt,
      })
    }
    const names = resolvedAgentNames(entry.agentNames ?? entry.package.agentNames ?? {}, entry.package.productionHc)
    setGenerated(applyAgentNamesToPackage(entry.package, names))
    setAgentNames(names)
    setActiveLibraryId(entry.id)
    setArtifactNotice(`Opened ${entry.status === 'draft' ? 'draft' : 'saved'} schedule "${entry.name}".`)
    window.requestAnimationFrame(() => {
      document.getElementById('sched-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const handleRenameSchedule = (entry: SavedSchedulingSchedule) => {
    const nextName = window.prompt('Rename schedule', entry.name)
    if (nextName == null) return
    const trimmed = nextName.trim()
    if (!trimmed || trimmed === entry.name) return
    const renamed = renameSavedSchedule(entry.id, trimmed)
    if (!renamed) {
      setArtifactNotice(`Could not rename "${entry.name}".`)
      return
    }
    refreshSavedArtifacts()
    void flushWorkspaceSync()
    setArtifactNotice(`Renamed schedule to "${trimmed}".`)
  }

  const handleDownloadSchedule = (entry: SavedSchedulingSchedule) => {
    try {
      if (!entry.package?.weeklyAgentGrid?.rows?.length) {
        setArtifactNotice(`"${entry.name}" has no agent schedule to download.`)
        return
      }
      downloadAgentScheduleExport(entry.package)
      setArtifactNotice(`Downloaded "${entry.name}".`)
    } catch (error) {
      console.error(error)
      setArtifactNotice(`Download failed for "${entry.name}".`)
    }
  }

  const handleDeleteSchedule = (entry: SavedSchedulingSchedule | string) => {
    const item = typeof entry === 'string' ? savedLibrary.find((row) => row.id === entry) : entry
    if (!item) return
    if (!window.confirm(`Delete "${item.name}"? This cannot be undone.`)) return
    deleteSavedSchedule(item.id)
    if (activeLibraryId === item.id) {
      setActiveLibraryId(null)
      setGenerated(null)
      persist({ ...workspace, lastGeneratedAt: null })
    }
    refreshSavedArtifacts()
    void flushWorkspaceSync()
    setArtifactNotice(`Deleted schedule "${item.name}".`)
  }

  const handleRequirementCellChange = (dayIso: string, interval: string, value: number) => {
    if (!generated) return
    if (scheduleGridDirty && !workspace.schedulesLocked) {
      setScheduleEditError('Save or discard schedule grid edits before changing requirements.')
      return
    }
    if (!Number.isFinite(value) || value < 0) return
    const current = generated.requirementTable.days.find((day) => day.day === dayIso)?.intervals[interval] ?? 0
    if (current === value) return
    const nextTable = updateRequirementCell(
      generated.requirementTable,
      dayIso,
      interval,
      value,
      workspace.rules.settings.fteRequiredDailyDivisorHours,
      workspace.rules.settings.scheduleIntervalMinutes,
    )
    regenerateSchedulesFromRequirements(nextTable)
  }

  const handleAgentNameChange = (agentIndex: number, name: string) => {
    const nextNames = { ...agentNames, [String(agentIndex)]: name }
    setAgentNames(nextNames)
    if (!generated) return
    setGenerated(applyAgentNamesToPackage(generated, nextNames))
  }

  const rebuildGeneratedWithShrinkage = useCallback(
    (nextWorkspace: SchedulingWorkspace) => {
      if (!generated) return
      const applied = effectiveApplyShrinkagePct(nextWorkspace)
      const syncedWorkspace = { ...nextWorkspace, shrinkagePct: applied }
      // Only recompute Net FTE after shrinkage — never rebuild coverage / Scheduled / Net FTE.
      const next = reapplyShrinkageToPackage(
        generated,
        syncedWorkspace.rules,
        {
          slaPercent: syncedWorkspace.slaPercent,
          slaSeconds: syncedWorkspace.slaSeconds,
          shrinkagePct: applied,
          volumeAhtRows: syncedWorkspace.volumeAhtRows,
        },
        buildApplyShrinkageOptions(syncedWorkspace),
      )
      setGenerated(next)
      persist({ ...syncedWorkspace, lastGeneratedAt: next.generatedAt })
      persistGeneratedDraft({
        id: draftScheduleId(syncedWorkspace.scenarioId, syncedWorkspace.weekStartIso, teamSupervisor),
        name: `Draft · ${scenario ? formatScenarioLabel(scenario) : 'schedule'} · week of ${syncedWorkspace.weekStartIso}`,
        scenarioId: syncedWorkspace.scenarioId,
        weekStartIso: syncedWorkspace.weekStartIso,
        clientName: scenario?.plan.client,
        lobName: scenario ? resolvePlanLob(scenario.plan) : undefined,
        teamSupervisor: teamSupervisor || undefined,
        coverageStart: weekDates[0],
        coverageEnd: weekDates[weekDates.length - 1],
        createdBy: user?.email,
        engine: next.engine,
        settingsSnapshot: syncedWorkspace.rules.settings,
        package: next,
        agentNames: next.agentNames ?? agentNames,
        generatedAt: next.generatedAt,
      })
    },
    [agentNames, generated, persist, scenario, teamSupervisor, user?.email, weekDates],
  )

  const handleUnlockSchedules = () => {
    setScheduleEditError(null)
    if (generated) {
      setEditedScheduleRows(generated.weeklyAgentGrid.rows.map((row) => ({ ...row, days: { ...row.days } })))
    }
    persist({ ...workspace, schedulesLocked: false })
  }

  const handleScheduleCellChange = (agentIndex: number, day: string, value: string) => {
    setScheduleGridDirty(true)
    setScheduleEditError(null)
    setEditedScheduleRows((prev) => {
      const base = prev ?? generated?.weeklyAgentGrid.rows ?? []
      return base.map((row) =>
        row.agentIndex === agentIndex ? { ...row, days: { ...row.days, [day]: value } } : row,
      )
    })
  }

  const handleSaveScheduleEdits = () => {
    if (!generated || !editedScheduleRows) return
    setScheduleEditError(null)
    for (const row of editedScheduleRows) {
      for (const day of generated.weeklyAgentGrid.weekDates) {
        const parsed = parseScheduleDayCell(row.days[day] ?? 'OFF')
        if (!parsed.ok) {
          setScheduleEditError(`Agent ${row.agentIndex + 1} · ${day}: ${parsed.error}`)
          return
        }
      }
    }
    const rebuilt = rebuildAssignmentsFromWeeklyGrid(
      editedScheduleRows,
      generated.weeklyAgentGrid.weekDates,
      workspace.rules.shiftTemplates,
      workspace.rules.settings,
    )
    if (rebuilt.errors.length) {
      setScheduleEditError(rebuilt.errors[0] ?? 'Invalid schedule edits')
      return
    }
    const next = rebuildPackageFromAssignments(
      generated,
      rebuilt.assignmentsByDay,
      workspace.rules,
      qualityInputs,
      agentNames,
      applyShrinkageOptions,
    )
    setGenerated(next)
    setEditedScheduleRows(null)
    setScheduleGridDirty(false)
    persist({ ...workspace, schedulesLocked: true, lastGeneratedAt: next.generatedAt })
    persistGeneratedDraft({
      id: draftScheduleId(workspace.scenarioId, workspace.weekStartIso, teamSupervisor),
      name: `Draft · ${scenario ? formatScenarioLabel(scenario) : 'schedule'} · week of ${workspace.weekStartIso}`,
      scenarioId: workspace.scenarioId,
      weekStartIso: workspace.weekStartIso,
      clientName: scenario?.plan.client,
      lobName: scenario ? resolvePlanLob(scenario.plan) : undefined,
      teamSupervisor: teamSupervisor || undefined,
      coverageStart: weekDates[0],
      coverageEnd: weekDates[weekDates.length - 1],
      createdBy: user?.email,
      engine: next.engine,
      settingsSnapshot: workspace.rules.settings,
      package: next,
      agentNames: next.agentNames ?? agentNames,
      generatedAt: next.generatedAt,
    })
    setArtifactNotice('Schedule changes saved. Interval comparison updated.')
    refreshSavedArtifacts()
  }

  const handleLoadShrinkageFromCapacity = () => {
    void (async () => {
      setIsGenerating(true)
      setGeneratePhase('Waiting Status — loading shrinkage from Capacity…')
      await yieldToMain()
      try {
        const next = withFlatShrinkageAssumption(
          workspace,
          Math.max(0, Math.min(100, capacityAbsenteeismPct100 + capacityInOfficePct100)),
        )
        persist(next)
        if (generated) rebuildGeneratedWithShrinkage(next)
        setArtifactNotice(
          `Loaded Shrinkage Assumption ${flatShrinkageAssumptionPct(next).toFixed(1)}% from Capacity (Absenteeism + In-office).`,
        )
      } finally {
        setIsGenerating(false)
        setGeneratePhase(null)
      }
    })()
  }

  const handleApplyShrinkage = () => {
    void (async () => {
      setIsGenerating(true)
      setGeneratePhase('Waiting Status — applying shrinkage to Interval Comparison…')
      await yieldToMain()
      try {
        const mode = workspace.applyShrinkageMode === 'per_interval' ? 'per_interval' : 'flat'
        const next =
          mode === 'flat'
            ? withFlatShrinkageAssumption(workspace, flatShrinkageAssumptionPct(workspace))
            : {
                ...workspace,
                applyShrinkageMode: 'per_interval' as const,
                shrinkagePct: effectiveApplyShrinkagePct(workspace),
              }
        persist(next)
        if (generated) rebuildGeneratedWithShrinkage(next)
        const pct = effectiveApplyShrinkagePct(next)
        setArtifactNotice(
          pct <= 0
            ? 'Applied 0% shrinkage — Variance, Projected SL, Occupancy, and Staffing % use Net FTE for every interval.'
            : `Applied Shrinkage Assumption ${pct.toFixed(1)}% → Net FTE after shrinkage = Net FTE × (1 − ${pct.toFixed(1)}%). Variance, Projected SL, Occupancy, and Staffing % use that value on every interval.`,
        )
      } finally {
        setIsGenerating(false)
        setGeneratePhase(null)
      }
    })()
  }

  const handleClearShrinkage = () => {
    void (async () => {
      setIsGenerating(true)
      setGeneratePhase('Waiting Status — clearing shrinkage…')
      await yieldToMain()
      try {
        const next = clearApplyShrinkage(workspace)
        persist(next)
        if (generated) rebuildGeneratedWithShrinkage(next)
        setShrinkageUploadError(null)
        setArtifactNotice('Cleared apply shrinkage. Staffing quality matrix updated.')
      } finally {
        setIsGenerating(false)
        setGeneratePhase(null)
      }
    })()
  }

  const handleShrinkageUpload = async (file: File) => {
    setShrinkageUploadError(null)
    setIsGenerating(true)
    setGeneratePhase('Waiting Status — uploading shrinkage template…')
    await yieldToMain()
    try {
      const parsed = await parseShrinkageFile(file, weekDates)
      if (!parsed.rows.length) {
        setShrinkageUploadError(parsed.errors.join(' ') || 'Could not parse shrinkage file.')
        return
      }
      const avgPct =
        parsed.rows.reduce((sum, row) => sum + row.shrinkagePct, 0) / Math.max(1, parsed.rows.length)
      const next: SchedulingWorkspace = withFlatShrinkageAssumption(
        {
          ...workspace,
          applyShrinkageMode: 'per_interval',
          intervalApplyShrinkagePct: parsed.intervalApplyShrinkagePct,
        },
        avgPct,
      )
      persist(next)
      if (generated) {
        rebuildGeneratedWithShrinkage(next)
      } else {
        setShrinkageUploadError(
          'Shrinkage uploaded. Generate or load a schedule first so Interval Comparison can refresh.',
        )
      }
      setArtifactNotice(
        `Uploaded interval shrinkage (${parsed.rows.length} rows, avg ${avgPct.toFixed(1)}%). Net FTE after shrinkage = Net FTE × (1 − Shrinkage%) on every interval.`,
      )
      if (parsed.errors.length) setShrinkageUploadError(parsed.errors.slice(0, 3).join(' '))
    } catch (error) {
      setShrinkageUploadError(error instanceof Error ? error.message : 'Could not read shrinkage file.')
    } finally {
      setIsGenerating(false)
      setGeneratePhase(null)
    }
  }

  const handleSaveComparison = () => {
    if (!generated || !comparisonSaveName.trim()) return
    const label = comparisonSaveName.trim()
    upsertSavedComparison({
      id: createArtifactId('cmp'),
      name: label,
      scenarioId: workspace.scenarioId,
      weekStartIso: workspace.weekStartIso,
      schedulingResult: generated.schedulingResult,
      metricsMatrix: generated.metricsMatrix,
      qualityInputs,
      agentNames,
      savedAt: new Date().toISOString(),
    })
    setComparisonSaveName('')
    setArtifactNotice(`Saved interval comparison "${label}".`)
    refreshSavedArtifacts()
  }

  const handleLoadComparison = (entry: SavedIntervalComparison) => {
    if (!generated) return
    setGenerated({
      ...generated,
      schedulingResult: entry.schedulingResult,
      metricsMatrix: entry.metricsMatrix,
      agentNames: entry.agentNames,
    })
    setAgentNames(entry.agentNames)
    setArtifactNotice(`Loaded interval comparison "${entry.name}".`)
  }

  const handleDeleteComparison = (id: string) => {
    deleteSavedComparison(id)
    refreshSavedArtifacts()
    setArtifactNotice('Deleted saved interval comparison.')
  }

  const capacityWeeklyRequired = capacityPlannedRequiredFte(capacityRow)
  const capacityProductionHc = capacityPlannedProductionHc(capacityRow)
  const schedulingResult = generated?.schedulingResult ?? null
  const requirementTable = generated?.requirementTable ?? null
  const shiftHours = workspace.rules.settings.shiftLengthHours
  const fteDailyHours = workspace.rules.settings.fteDailyDivisorHours
  const fteWeeklyHours = workspace.rules.settings.fteWeeklyDivisorHours
  const intervalDivisor = 60 / workspace.rules.settings.scheduleIntervalMinutes
  const rosterPoolHc = schedulingResult?.totals.rosterPoolHc ?? generated?.productionHc ?? 0
  const agentBreakColumns =
    generated?.weeklyAgentGrid.breakColumns?.length
      ? generated.weeklyAgentGrid.breakColumns
      : resolveBreakLunchColumns(workspace.rules.settings)
  const displayScheduleRows = editedScheduleRows ?? generated?.weeklyAgentGrid.rows ?? []
  const flatCombinedShrinkage = flatShrinkageAssumptionPct(workspace)

  return (
    <div className="sched-page">
      <section className="exec-dashboard__hero sched-page__hero">
        <h1 className="exec-dashboard__title">Scheduling</h1>
        <div className="sched-workflow">
          <div className={`sched-workflow__step${settingsReady ? ' sched-workflow__step--done' : ' sched-workflow__step--active'}`}>
            <span>1</span> Scheduling settings
          </div>
          <div className={`sched-workflow__step${patternReady ? ' sched-workflow__step--done' : settingsReady ? ' sched-workflow__step--active' : ''}`}>
            <span>2</span> Upload pattern
          </div>
          <div className={`sched-workflow__step${generated ? ' sched-workflow__step--done' : patternReady && settingsReady ? ' sched-workflow__step--active' : ''}`}>
            <span>3</span> Optimize coverage
          </div>
          <div className={`sched-workflow__step${generated?.status === 'saved' ? ' sched-workflow__step--done' : generated ? ' sched-workflow__step--active' : ''}`}>
            <span>4</span> Save schedule
          </div>
        </div>
      </section>

      {!settingsReady ? (
        <section className="sched-panel saas-card sched-settings-banner">
          <h2 className="sched-section-title m-0">Scheduling settings required</h2>
          <p className="saas-muted m-0">
            Define shift rules, breaks, lunches, and constraints before generating requirements or schedules.
          </p>
          <Link to={`/scheduling/settings?scenarioId=${workspace.scenarioId}`} className="saas-btn saas-btn--primary sched-settings-banner__cta">
            Open Scheduling Settings
          </Link>
        </section>
      ) : (
        <section className="sched-panel saas-card sched-settings-banner sched-settings-banner--ok">
          <p className="m-0 sched-settings-banner__status">
            Settings confirmed
            {workspace.settingsConfirmedAt ? ` · ${new Date(workspace.settingsConfirmedAt).toLocaleString()}` : ''}
          </p>
          <Link
            to={`/scheduling/settings?scenarioId=${workspace.scenarioId}`}
            className="saas-btn saas-btn--secondary sched-settings-banner__cta sched-settings-banner__cta--highlight"
          >
            Open Scheduling Settings
          </Link>
        </section>
      )}

      <CollapsibleSection
        title="Saved / generated schedules"
        subtitle={
          savedLibrary.length
            ? `${savedLibrary.length} stored · drafts keep automatically after generate`
            : 'Generate a schedule to create a draft'
        }
        defaultExpanded={false}
        className="sched-collapsible"
      >
        <SavedSchedulesLibrary
          hideHeader
          entries={savedLibrary}
          activeId={activeLibraryId}
          onOpen={handleLoadSchedule}
          onRename={handleRenameSchedule}
          onDownload={handleDownloadSchedule}
          onDelete={handleDeleteSchedule}
        />
      </CollapsibleSection>

      <section className="sched-panel saas-card sched-panel--stacked">
        {isGenerating && generatePhase ? (
          <SchedulingGenerationStatus title="Waiting Status" phase={generatePhase} />
        ) : null}
        <div className="sched-panel__grid">
          <ScenarioPicker
            value={workspace.scenarioId}
            onChange={(scenarioId) => {
              const nextScenario = scenarios.find((item) => item.id === scenarioId)
              setGenerated(null)
              persist(
                createDefaultSchedulingWorkspace(
                  scenarioId,
                  nextScenario ? resolveCurrentCalendarWeek(nextScenario.plan.weekStart, nextScenario.plan.timezone) : workspace.weekStartIso,
                  nextScenario ?? null,
                ),
              )
            }}
            label="LOB / Scenario"
            help="Capacity matrix values use the selected planning week row. Override with manual inputs if needed."
          />

          <label className="cap-field">
            <span className="cap-field__label">
              Planning week
              <HelpTip text={`Week columns start on ${schedulingWeekStart === 'sunday' ? 'Sunday' : 'Monday'} (from Scheduling Settings / LOB plan).`} />
            </span>
            <input
              className="cap-field__input"
              type="date"
              value={workspace.weekStartIso}
              onChange={(event) => {
                setGenerated(null)
                const weekStartIso = snapToWeekStart(event.target.value, schedulingWeekStart)
                persist({ ...workspace, weekStartIso, manualDailyFteByDay: { ...workspace.manualDailyFteByDay } })
              }}
            />
            <span className="saas-muted text-xs">
              Starts {formatDayLabel(workspace.weekStartIso)} ({schedulingWeekStart === 'sunday' ? 'Sunday' : 'Monday'} week)
            </span>
          </label>

          <div className="sched-upload">
            <span className="cap-field__label">Interval pattern file</span>
            <p className="saas-muted sched-upload__hint m-0">
              CSV or Excel with Day, Interval, Value columns. Values define percentage distribution only — not FTE or
              headcount. Demo week: {SAMPLE_INTERVAL_WEEK_START}.
            </p>
            <div className="sched-upload__actions">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="sched-upload__input"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void handlePatternUpload(file)
                  event.target.value = ''
                }}
              />
              <button type="button" className="saas-btn saas-btn--secondary" onClick={() => fileInputRef.current?.click()}>
                Upload pattern
              </button>
              <button
                type="button"
                className="saas-btn saas-btn--ghost sched-template-btn"
                title="Download sample Excel with Day, Interval, Value columns and user guide"
                onClick={() => downloadSampleIntervalPatternTemplate(workspace.weekStartIso)}
              >
                <svg className="sched-template-btn__icon" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M12 3v10m0 0l4-4m-4 4L8 9M5 21h14"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Sample template
              </button>
              {workspace.patternLabel ? (
                <span className="sched-upload__meta">
                  {workspace.patternLabel}
                  {workspace.patternUploadedAt ? ` · ${new Date(workspace.patternUploadedAt).toLocaleString()}` : ''}
                </span>
              ) : null}
            </div>
            {uploadError ? <p className="sched-upload__error m-0">{uploadError}</p> : null}
            {patternReady && workspace.rawPattern.length > 0 ? (
              <CollapsibleSection
                title="Uploaded pattern & working days"
                subtitle={`HoOP: ${patternMeta.hoursOfOperation.label}`}
                defaultExpanded={false}
                className="sched-collapsible"
              >
                <div className="sched-pattern-meta">
                  <p className="sched-pattern-meta__title m-0">
                    <strong>Hours of Operation (HoOP):</strong> {patternMeta.hoursOfOperation.label}
                  </p>
                  <p className="saas-muted m-0 text-xs">
                    Working days ({patternMeta.workingDays.length}):{' '}
                    {patternMeta.workingDays.map((day) => formatDayLabel(day)).join(', ') || '—'}
                    {patternMeta.restDays.length > 0 ? (
                      <>
                        {' '}
                        · Rest days ({patternMeta.restDays.length}):{' '}
                        {patternMeta.restDays.map((day) => formatDayLabel(day)).join(', ')}
                      </>
                    ) : null}
                  </p>
                  <p className="saas-muted m-0 text-xs">
                    Requirements and schedules follow uploaded pattern intervals only. Rest days are taken from days with
                    no volume in the file — not grouped unless the upload is grouped.
                  </p>
                </div>
              </CollapsibleSection>
            ) : null}
          </div>
        </div>

        <div className="sched-source-grid">
          <fieldset className="sched-fieldset">
            <legend>Required Production FTE source</legend>
            <label className="sched-radio">
              <input
                type="radio"
                name="fte-source"
                checked={workspace.fteSource === 'capacity'}
                onChange={() => updateFteSource('capacity')}
              />
              Capacity matrix · Planning week ({formatDayLabel(workspace.weekStartIso)}) — Required FTE{' '}
              {fmtNum(capacityWeeklyRequired, 1)}
            </label>
            <label className="sched-radio">
              <input
                type="radio"
                name="fte-source"
                checked={workspace.fteSource === 'manual'}
                onChange={() => updateFteSource('manual')}
              />
              Manual input
            </label>
            {workspace.fteSource === 'manual' ? (
              <label className="cap-field sched-manual-input">
                <span className="cap-field__label">Weekly Required FTE</span>
                <StableNumberInput
                  className="cap-field__input"
                  min={0}
                  step={0.1}
                  value={workspace.manualWeeklyFte || ''}
                  onCommit={(parsed) => {
                    setGenerated(null)
                    persist({ ...workspace, manualWeeklyFte: parsed == null ? 0 : parsed })
                  }}
                  aria-label="Weekly Required FTE"
                />
              </label>
            ) : null}
            {workspace.fteSource === 'capacity' && capacityWeeklyRequired <= 0 ? (
              <p className="sched-upload__error m-0 text-xs">
                No Required FTE for this planning week in Capacity. Enter values on the Capacity page or switch to manual.
              </p>
            ) : null}
          </fieldset>

          <fieldset className="sched-fieldset">
            <legend>Scheduled Production HC source</legend>
            <label className="sched-radio">
              <input
                type="radio"
                name="hc-source"
                checked={workspace.scheduleHcSource === 'roster'}
                onChange={() => updateHcSource('roster')}
              />
              Roster production agents{teamSupervisor ? ` · ${teamSupervisor}` : ''} — {rosterHc} agents
            </label>
            <label className="sched-radio">
              <input
                type="radio"
                name="hc-source"
                checked={workspace.scheduleHcSource === 'capacity'}
                onChange={() => updateHcSource('capacity')}
              />
              Capacity matrix · Planning week ({formatDayLabel(workspace.weekStartIso)}) — Production HC{' '}
              {fmtNum(capacityProductionHc, 0)} agents
            </label>
            <label className="sched-radio">
              <input
                type="radio"
                name="hc-source"
                checked={workspace.scheduleHcSource === 'manual'}
                onChange={() => updateHcSource('manual')}
              />
              Manual input
            </label>
            <label className="cap-field sched-manual-input">
              <span className="cap-field__label">Generate by supervisor / team</span>
              <select
                className="cap-field__input"
                value={teamSupervisor}
                onChange={(event) => {
                  setGenerated(null)
                  persist({ ...workspace, teamSupervisor: event.target.value })
                }}
              >
                <option value="">All teams</option>
                {supervisorOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                    {blockSchedules.some((block) => block.supervisor === name) ? ' · block schedule' : ''}
                  </option>
                ))}
              </select>
            </label>
            {workspace.scheduleHcSource === 'manual' ? (
              <label className="cap-field sched-manual-input">
                <span className="cap-field__label">Agents to schedule</span>
                <StableNumberInput
                  className="cap-field__input"
                  min={0}
                  step={1}
                  value={workspace.manualProductionHc || ''}
                  onCommit={(parsed) => {
                    setGenerated(null)
                    persist({ ...workspace, manualProductionHc: parsed == null ? 0 : parsed })
                  }}
                  aria-label="Agents to schedule"
                />
              </label>
            ) : null}
            {workspace.scheduleHcSource === 'roster' && rosterHc <= 0 ? (
              <p className="sched-upload__error m-0 text-xs">
                No production roster agents{teamSupervisor ? ` for ${teamSupervisor}` : ''} on this LOB. Assign
                supervisors on the Roster page or switch HC source.
              </p>
            ) : null}
            {workspace.scheduleHcSource === 'capacity' && capacityProductionHc <= 0 ? (
              <p className="sched-upload__error m-0 text-xs">
                No Production HC for this planning week in Capacity. Enter values on the Capacity page or switch to manual.
              </p>
            ) : null}
          </fieldset>
        </div>

        <div className="sched-quality-grid">
          <fieldset className="sched-fieldset">
            <legend>SLA (for quality matrix)</legend>
            <div className="sched-quality-inputs">
              <label className="cap-field">
                <span className="cap-field__label">SLA Percent</span>
                <StableNumberInput
                  className="cap-field__input"
                  min={0}
                  max={100}
                  step={1}
                  value={workspace.slaPercent}
                  allowEmpty={false}
                  onCommit={(parsed) => {
                    if (parsed == null) return
                    setGenerated(null)
                    persist({ ...workspace, slaPercent: parsed })
                  }}
                  aria-label="SLA Percent"
                />
              </label>
              <label className="cap-field">
                <span className="cap-field__label">SLA Seconds</span>
                <StableNumberInput
                  className="cap-field__input"
                  min={1}
                  step={1}
                  value={workspace.slaSeconds}
                  allowEmpty={false}
                  onCommit={(parsed) => {
                    if (parsed == null) return
                    setGenerated(null)
                    persist({ ...workspace, slaSeconds: parsed })
                  }}
                  aria-label="SLA Seconds"
                />
              </label>
            </div>
          </fieldset>

          <div className="sched-upload sched-upload--volume">
            <span className="cap-field__label">Volume &amp; AHT file (for Projected Service Level)</span>
            <p className="saas-muted sched-upload__hint m-0">
              Optional — upload Day, Interval, Volume, AHT_Seconds to calculate Occupancy and Projected SL per interval.
            </p>
            <div className="sched-upload__actions">
              <input
                ref={volumeFileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="sched-upload__input"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void handleVolumeAhtUpload(file)
                  event.target.value = ''
                }}
              />
              <button
                type="button"
                className="saas-btn saas-btn--secondary"
                onClick={() => volumeFileInputRef.current?.click()}
              >
                Upload Volume/AHT
              </button>
              <button
                type="button"
                className="saas-btn saas-btn--ghost sched-template-btn"
                onClick={() => downloadVolumeAhtTemplate(workspace.weekStartIso)}
              >
                Volume/AHT template
              </button>
              {workspace.volumeAhtLabel ? (
                <span className="sched-upload__meta">
                  {workspace.volumeAhtLabel}
                  {workspace.volumeAhtUploadedAt
                    ? ` · ${new Date(workspace.volumeAhtUploadedAt).toLocaleString()}`
                    : ''}
                  {' · '}
                  {workspace.volumeAhtRows.length} rows
                </span>
              ) : (
                <span className="saas-muted text-xs">Without upload: Occupancy uses Req÷Sched proxy; SL unavailable.</span>
              )}
            </div>
            {volumeUploadError ? <p className="sched-upload__error m-0">{volumeUploadError}</p> : null}
          </div>
        </div>

        <div className="sched-quality-grid">
          <fieldset className="sched-fieldset">
            <legend>VL allocation HC</legend>
            <p className="saas-muted m-0 text-xs mb-2">
              Capacity VL Allocation HC: {fmtNum(capacityVlHc, 0)}. Tagged agents are excluded from Interval Comparison
              Scheduled / Net FTE after shrinkage.
            </p>
            <label className="cap-field sched-manual-input">
              <span className="cap-field__label">VL HC (override)</span>
              <StableNumberInput
                className="cap-field__input"
                min={0}
                step={1}
                value={workspace.vlHcOverride ?? capacityVlHc}
                allowEmpty={false}
                onCommit={(parsed) => {
                  if (parsed == null) return
                  setGenerated(null)
                  persist({ ...workspace, vlHcOverride: Math.max(0, Math.round(parsed)) })
                }}
                aria-label="VL HC override"
              />
            </label>
            <button
              type="button"
              className="saas-btn saas-btn--ghost text-xs mt-2"
              onClick={() => {
                setGenerated(null)
                persist({ ...workspace, vlHcOverride: null })
              }}
            >
              Use Capacity VL HC ({fmtNum(capacityVlHc, 0)})
            </button>
          </fieldset>
        </div>

        <div className="sched-generate-bar">
          <button
            type="button"
            className="saas-btn saas-btn--primary sched-generate-btn"
            disabled={!patternReady || !settingsReady || isGenerating}
            onClick={handleGenerate}
          >
            {isGenerating ? 'Generating…' : 'Generate Requirements and Schedule'}
          </button>
          {generateError ? <p className="sched-upload__error m-0">{generateError}</p> : null}
          {!settingsReady ? (
            <p className="saas-muted m-0 text-sm">Confirm scheduling settings to enable generation.</p>
          ) : !patternUploaded ? (
            <div className="sched-pattern-prompt" role="status">
              <p className="m-0 text-sm font-semibold text-slate-800">Upload an interval pattern to continue</p>
              <p className="saas-muted m-0 text-sm">
                Requirements and schedules are not generated until a pattern file is uploaded. Days and intervals with
                pattern values stay open; days without values remain closed.
              </p>
              <div className="sched-empty__actions mt-2">
                <button type="button" className="saas-btn saas-btn--secondary" onClick={() => fileInputRef.current?.click()}>
                  Choose pattern file
                </button>
                <button
                  type="button"
                  className="saas-btn saas-btn--ghost"
                  onClick={() => downloadSampleIntervalPatternTemplate(workspace.weekStartIso)}
                >
                  Download sample template
                </button>
              </div>
            </div>
          ) : !patternReady && !generateError ? (
            <p className="saas-muted m-0 text-sm">Uploaded file has no positive interval values for this planning week.</p>
          ) : null}
        </div>

        {scenario ? (
          <p className="saas-muted sched-context m-0">
            Active scope: <strong>{formatScenarioLabel(scenario)}</strong> · Week of {formatDayLabel(workspace.weekStartIso)}
          </p>
        ) : null}
      </section>

      {schedulingResult && requirementTable && generated && patternUploaded ? (
        <>
          <section id="sched-results" className="sched-results-card saas-card">
            <div className={`sched-draft-banner${generated.status === 'saved' ? ' sched-draft-banner--saved' : ''}`}>
              {generated.status === 'saved' ? (
                <p className="m-0">
                  <strong>Saved schedule.</strong> This is a stored copy with its original settings.
                </p>
              ) : (
                <p className="m-0">
                  <strong>Draft.</strong> Kept if you leave this page. Save it from Agent schedules to add a library copy.
                </p>
              )}
            </div>

            <div className="sched-results-kpis sched-kpi-grid">
              <article className="sched-kpi-card sched-kpi-card--indigo">
                <span className="sched-kpi-card__label">Required FTE</span>
                <strong className="sched-kpi-card__value">
                  {fmtNum(schedulingResult.totals.weeklySumRequired ?? requirementTable.weeklyFteTarget, 1)}
                </strong>
                <span className="sched-kpi-card__sub">Week total from requirements</span>
              </article>
              <article className="sched-kpi-card sched-kpi-card--teal">
                <span className="sched-kpi-card__label">Scheduled FTE</span>
                <strong className="sched-kpi-card__value">
                  {fmtNum(schedulingResult.totals.weeklySumScheduled ?? 0, 1)}
                </strong>
                <span className="sched-kpi-card__sub">Net of lunch and breaks</span>
              </article>
              <article
                className={`sched-kpi-card sched-kpi-card--variance ${varianceClass(
                  (schedulingResult.totals.staffingPct ?? 100) - 100,
                )}`}
              >
                <span className="sched-kpi-card__label">Staffing %</span>
                <strong className="sched-kpi-card__value">{fmtStaffingPct(schedulingResult.totals.staffingPct)}</strong>
                <span className="sched-kpi-card__sub">Scheduled FTE ÷ required FTE</span>
              </article>
              <article
                className={`sched-kpi-card ${
                  (generated.metricsMatrix?.projectedServiceLevelPct ?? 0) + 0.05 >= workspace.slaPercent
                    ? 'sched-kpi-card--variance sched-variance--match'
                    : 'sched-kpi-card--rose'
                }`}
              >
                <span className="sched-kpi-card__label">Projected SL</span>
                <strong className="sched-kpi-card__value">
                  {fmtProjectedSl(generated.metricsMatrix?.projectedServiceLevelPct)}
                </strong>
                <span className="sched-kpi-card__sub">Goal {fmtProjectedSl(workspace.slaPercent)}</span>
              </article>
              <article className="sched-kpi-card sched-kpi-card--rose">
                <span className="sched-kpi-card__label">Under / over</span>
                <strong className="sched-kpi-card__value">
                  {schedulingResult.totals.understaffedIntervals} / {schedulingResult.totals.overstaffedIntervals}
                </strong>
                <span className="sched-kpi-card__sub">Understaffed / overstaffed intervals</span>
              </article>
              <article className="sched-kpi-card sched-kpi-card--slate">
                <span className="sched-kpi-card__label">HC</span>
                <strong className="sched-kpi-card__value">{fmtNum(rosterPoolHc, 0)}</strong>
                <span className="sched-kpi-card__sub">Schedules in this run</span>
              </article>
            </div>

            <div className="sched-toggle-row" role="toolbar" aria-label="Schedule insight panels">
              <button
                type="button"
                className={`saas-btn sched-toggle-btn sched-toggle-btn--check${showCoverageCheck ? ' is-on' : ''}`}
                aria-pressed={showCoverageCheck}
                disabled={!generated.diagnostics}
                onClick={() => {
                  setShowCoverageCheck((open) => !open)
                  if (!showCoverageCheck) setShowOptimization(false)
                }}
              >
                {showCoverageCheck ? 'Hide coverage and rule check' : 'Coverage and rule check'}
              </button>
              <button
                type="button"
                className={`saas-btn sched-toggle-btn sched-toggle-btn--opt${showOptimization ? ' is-on' : ''}`}
                aria-pressed={showOptimization}
                disabled={!demandAnalytics || !serviceLevelInsight}
                onClick={() => {
                  setShowOptimization((open) => !open)
                  if (!showOptimization) setShowCoverageCheck(false)
                }}
              >
                {showOptimization ? 'Hide optimization' : 'Optimization'}
              </button>
              <p className="sched-toggle-hint">
                {showCoverageCheck || showOptimization
                  ? 'Click the active button again to hide this panel.'
                  : 'Open a highlighted button for coverage gaps or staffing recommendations. Details stay hidden until you choose one.'}
              </p>
            </div>
          </section>

          {showCoverageCheck && generated.diagnostics ? (
            <ScheduleDiagnosticsPanel diagnostics={generated.diagnostics}>
              <p className="saas-muted m-0 text-sm">
                <strong>{fmtNum(rosterPoolHc, 0)} agents</strong> are Scheduled HC.{' '}
                <strong>{fmtNum(schedulingResult.totals.weeklySumScheduled ?? 0, 1)} FTE</strong> is the week total after
                lunch and breaks. Daily FTE = Σ interval Scheduled HC ÷ {fteDailyHours}h ÷ {intervalDivisor}. Week FTE
                (net after shrinkage) = Σ Net FTE after shrinkage intervals ÷ {fteWeeklyHours}h ÷ {intervalDivisor}.
              </p>
            </ScheduleDiagnosticsPanel>
          ) : null}

          {showOptimization && demandAnalytics && serviceLevelInsight ? (
            <ScheduleOptimizationHub
              demand={demandAnalytics}
              serviceLevel={serviceLevelInsight}
              recommendations={scheduleRecommendations}
              scenarios={scenarioSnapshots}
              slaTarget={workspace.slaPercent}
              comparing={comparingScenarios}
              busy={isGenerating}
              settingsHref={`/scheduling/settings?scenarioId=${workspace.scenarioId}`}
              hasOriginalView={hasDeviatedFromOriginalView}
              onResetOriginalView={handleResetOriginalView}
              onApplyRecommendation={handleApplyRecommendation}
              onRunScenarios={() => void handleRunScenarios()}
              onApplyScenario={handleApplyScenario}
            />
          ) : null}

          <section className="sched-panel saas-card" ref={chartsRef}>
            <div className="sched-panel__toolbar">
              <div>
                <h2 className="sched-section-title m-0">Coverage &amp; quality</h2>
                <p className="saas-muted m-0 text-xs">
                  Charts use this week’s generated intervals
                  {generated?.patternMeta ? ` · HoOP ${generated.patternMeta.hoursOfOperation.label}` : ''}.
                </p>
              </div>
              <button
                type="button"
                className="saas-btn saas-btn--secondary"
                disabled={isExporting}
                onClick={() => void handleExportExcel()}
              >
                {isExporting ? 'Exporting…' : 'Download Excel + charts'}
              </button>
            </div>

            {generated.metricsMatrix ? (
              <SchedulingMetricsMatrixPanel matrix={generated.metricsMatrix} />
            ) : null}

            <SchedulingDailyCharts
              result={schedulingResult}
              fteWeeklyHours={fteWeeklyHours}
              shiftLengthHours={shiftHours}
              intervalMinutes={workspace.rules.settings.scheduleIntervalMinutes}
              selectedDay={selectedChartDay}
              onSelectDay={setSelectedChartDay}
            />
          </section>

          <section className="sched-panel saas-card">
            <div className="sched-panel__toolbar">
              <div className="sched-tabs" role="tablist" aria-label="Scheduling tables">
                {(
                  [
                    ['daily', 'Daily FTE summary'],
                    ['requirements', 'Generated requirements'],
                    ['comparison', 'Interval comparison'],
                    ['schedules', 'Agent schedules'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    className={`sched-tabs__btn${tableView === id ? ' sched-tabs__btn--active' : ''}`}
                    aria-selected={tableView === id}
                    onClick={() => setTableView(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="saas-muted m-0 sched-legend">
                <span className="sched-legend__swatch sched-variance--over">Over</span>
                <span className="sched-legend__swatch sched-variance--under">Under</span>
                <span className="sched-legend__swatch sched-variance--match">Match</span>
              </p>
            </div>

            {artifactNotice ? (
              <p className="cap-save-flash m-0 mb-3" role="status">
                {artifactNotice}
              </p>
            ) : null}

            {tableView === 'daily' ? (
              <div className="sched-table-wrap">
                <table className="sched-table sched-table--daily">
                  <caption>
                    Daily FTE summary · required vs Net FTE after shrinkage · week of{' '}
                    {formatDayLabel(workspace.weekStartIso)}
                  </caption>
                  <thead>
                    <tr>
                      <th>Day</th>
                      <th>Required FTE</th>
                      <th>Net FTE after shrinkage</th>
                      <th>Variance</th>
                      <th>Staffing %</th>
                      <th>Over</th>
                      <th>Under</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedulingResult.days.map((day) => (
                      <tr key={day.day} className={day.isClosed ? 'sched-table__closed-day' : varianceClass(day.dailyVariance)}>
                        <th scope="row">
                          {day.dateLabel}
                          {day.isClosed ? <span className="saas-muted"> · closed</span> : null}
                        </th>
                        <td>{day.isClosed ? '—' : fmtNum(day.dailyRequiredTotal, 1)}</td>
                        <td>{day.isClosed ? '—' : fmtNum(day.dailyNetFteTotal ?? 0, 2)}</td>
                        <td>
                          {day.isClosed
                            ? '—'
                            : `${day.dailyVariance > 0 ? '+' : ''}${fmtNum(day.dailyVariance, 1)}`}
                        </td>
                        <td>{day.isClosed ? '—' : fmtStaffingPct(day.dailyStaffingPct)}</td>
                        <td className="sched-variance--over">{day.isClosed ? '—' : day.overstaffedIntervals}</td>
                        <td className="sched-variance--under">{day.isClosed ? '—' : day.understaffedIntervals}</td>
                      </tr>
                    ))}
                    <tr className="sched-table__summary-row">
                      <th scope="row">Week total</th>
                      <td>{fmtNum(schedulingResult.totals.weeklySumRequired ?? requirementTable.weeklyFteTarget, 1)}</td>
                      <td>{fmtNum(schedulingResult.totals.weeklySumScheduled ?? 0, 2)}</td>
                      <td>
                        {schedulingResult.totals.variance > 0 ? '+' : ''}
                        {fmtNum(schedulingResult.totals.variance, 1)}
                      </td>
                      <td>{fmtStaffingPct(schedulingResult.totals.staffingPct)}</td>
                      <td className="sched-variance--over">{schedulingResult.totals.overstaffedIntervals}</td>
                      <td className="sched-variance--under">{schedulingResult.totals.understaffedIntervals}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : null}

            {tableView === 'requirements' ? (
              <div className="sched-table-wrap">
                <div className="sched-artifact-toolbar">
                  <p className="saas-muted m-0 text-xs">
                    Edit interval headcount — schedules regenerate automatically when Required &gt; 0.
                  </p>
                  <div className="sched-artifact-toolbar__actions">
                    <input
                      className="cap-field__input sched-artifact-toolbar__name"
                      placeholder="Save as name…"
                      value={requirementSaveName}
                      onChange={(event) => setRequirementSaveName(event.target.value)}
                    />
                    <button type="button" className="saas-btn saas-btn--secondary" onClick={handleSaveRequirements}>
                      Save requirements
                    </button>
                  </div>
                  {savedRequirements.length ? (
                    <ul className="sched-artifact-list">
                      {savedRequirements.map((entry) => (
                        <li key={entry.id} className="sched-artifact-list__item">
                          <span>{entry.name}</span>
                          <div className="sched-artifact-list__buttons">
                            <button type="button" className="cap-link" onClick={() => handleLoadRequirements(entry)}>
                              Load
                            </button>
                            <button type="button" className="cap-link cap-link--danger" onClick={() => handleDeleteRequirements(entry.id)}>
                              Delete
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <table className="sched-table">
                  <caption>
                    Generated interval requirements (headcount). Editing a cell regenerates schedules for values above 0.
                  </caption>
                  <thead>
                    <tr>
                      <th>Interval</th>
                      {requirementTable.days.map((day) => (
                        <th key={day.day}>{formatDayLabel(day.day)}</th>
                      ))}
                      <th>Week total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {intervalColumns.map((interval) => (
                      <tr key={interval}>
                        <th scope="row">{interval}</th>
                        {requirementTable.days.map((day) => (
                          <td key={`${day.day}-${interval}`}>
                            <StableNumberInput
                              className="cap-field__input sched-req-cell"
                              min={0}
                              step={0.1}
                              value={day.intervals[interval] ?? 0}
                              allowEmpty={false}
                              onCommit={(parsed) => {
                                if (parsed == null) return
                                handleRequirementCellChange(day.day, interval, parsed)
                              }}
                              aria-label={`${formatDayLabel(day.day)} ${interval} required headcount`}
                            />
                          </td>
                        ))}
                        <td className="sched-table__total">{fmtNum(requirementTable.totals[interval] ?? 0, 2)}</td>
                      </tr>
                    ))}
                    <tr className="sched-table__summary-row">
                      <th scope="row">Daily FTE (sum ÷ {workspace.rules.settings.shiftLengthHours}h)</th>
                      {requirementTable.days.map((day) => (
                        <td key={`total-${day.day}`} className="sched-table__total">
                          {fmtNum(day.dailyFte, 1)}
                        </td>
                      ))}
                      <td className="sched-table__total">
                        {fmtNum(schedulingResult.totals.weeklySumRequired ?? schedulingResult.totals.requiredFte, 1)}
                      </td>
                    </tr>
                    <tr className="sched-table__summary-row">
                      <th scope="row">Weekly avg FTE (sum daily ÷ {schedulingResult.days.length})</th>
                      {requirementTable.days.map((day) => (
                        <td key={`avg-${day.day}`} className="sched-table__total">—</td>
                      ))}
                      <td className="sched-table__total">{fmtNum(schedulingResult.totals.requiredFte, 1)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : null}

            {tableView === 'comparison' ? (
              <div className="sched-day-stack">
                <div className="sched-artifact-toolbar">
                  <p className="saas-muted m-0 text-xs">Required vs scheduled by interval, with projected service level.</p>
                  <div className="sched-artifact-toolbar__actions">
                    <button
                      type="button"
                      className={`saas-btn saas-btn--secondary sched-erlang-toggle${showErlangSl ? ' is-active' : ''}`}
                      onClick={() => setShowErlangSl((prev) => !prev)}
                      title="Toggle Erlang C service level when Volume/AHT is uploaded"
                    >
                      {showErlangSl ? 'Erlang SL on' : 'Erlang SL'}
                    </button>
                    <input
                      className="cap-field__input sched-artifact-toolbar__name"
                      placeholder="Save comparison as…"
                      value={comparisonSaveName}
                      onChange={(event) => setComparisonSaveName(event.target.value)}
                    />
                    <button type="button" className="saas-btn saas-btn--secondary" onClick={handleSaveComparison}>
                      Save comparison
                    </button>
                  </div>
                  {savedComparisons.length ? (
                    <ul className="sched-artifact-list">
                      {savedComparisons.map((entry) => (
                        <li key={entry.id} className="sched-artifact-list__item">
                          <span>
                            {entry.name}
                            <span className="saas-muted text-xs"> · {new Date(entry.savedAt).toLocaleString()}</span>
                          </span>
                          <div className="sched-artifact-list__buttons">
                            <button type="button" className="cap-link" onClick={() => handleLoadComparison(entry)}>
                              View
                            </button>
                            <button
                              type="button"
                              className="cap-link cap-link--danger"
                              onClick={() => handleDeleteComparison(entry.id)}
                            >
                              Delete
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>

                <div className="sched-fieldset sched-apply-shrinkage mb-4">
                  <h3 className="sched-section-title m-0 mb-2">Apply Shrinkage</h3>
                  <p className="saas-muted m-0 text-xs mb-3">
                    One Shrinkage Assumption for flat mode. Net FTE = Scheduled after Break and Lunch (unchanged by
                    Apply Shrinkage). Formula:{' '}
                    <strong>Net FTE after shrinkage = Net FTE × (1 − Shrinkage%)</strong>
                    {' '}(example: 7 × (1 − 1%) = 6.93). Only that column changes when you Apply — Scheduled and Net FTE
                    stay the same. At 0% shrinkage, Variance / Projected SL / Occupancy / Staffing % use Net FTE.
                    Capacity planned Absenteeism {fmtNum(capacityAbsenteeismPct100, 1)}% + In-office{' '}
                    {fmtNum(capacityInOfficePct100, 1)}% ={' '}
                    {fmtNum(capacityAbsenteeismPct100 + capacityInOfficePct100, 1)}%. Current assumption:{' '}
                    {fmtNum(flatCombinedShrinkage, 1)}%.
                  </p>
                  <div className="sched-quality-inputs">
                    <label className="cap-field">
                      <span className="cap-field__label">Shrinkage Assumption %</span>
                      <StableNumberInput
                        className="cap-field__input"
                        min={0}
                        max={100}
                        step={0.1}
                        value={flatCombinedShrinkage}
                        allowEmpty={false}
                        onCommit={(parsed) => {
                          if (parsed == null) return
                          persist(withFlatShrinkageAssumption(workspace, Math.max(0, Math.min(100, parsed))))
                        }}
                        aria-label="Shrinkage Assumption percent for all intervals"
                      />
                    </label>
                    <label className="cap-field">
                      <span className="cap-field__label">Mode</span>
                      <select
                        className="cap-field__input"
                        value={workspace.applyShrinkageMode ?? 'flat'}
                        onChange={(event) =>
                          persist({
                            ...workspace,
                            applyShrinkageMode: event.target.value === 'per_interval' ? 'per_interval' : 'flat',
                          })
                        }
                      >
                        <option value="flat">Flat (all intervals)</option>
                        <option value="per_interval">Per-interval (upload)</option>
                      </select>
                    </label>
                  </div>
                  <div className="sched-upload__actions mt-3">
                    <input
                      ref={shrinkageFileInputRef}
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      className="sched-upload__input"
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        if (file) void handleShrinkageUpload(file)
                        event.target.value = ''
                      }}
                    />
                    <button
                      type="button"
                      className="saas-btn saas-btn--ghost"
                      disabled={isGenerating}
                      onClick={handleLoadShrinkageFromCapacity}
                    >
                      Load from Capacity
                    </button>
                    <button
                      type="button"
                      className="saas-btn saas-btn--ghost"
                      disabled={isGenerating}
                      onClick={() => downloadShrinkageTemplate(workspace.weekStartIso, weekDates, intervalColumns)}
                    >
                      Download template
                    </button>
                    <button
                      type="button"
                      className="saas-btn saas-btn--secondary"
                      disabled={isGenerating}
                      onClick={() => shrinkageFileInputRef.current?.click()}
                    >
                      Upload template
                    </button>
                    <button
                      type="button"
                      className="saas-btn saas-btn--primary"
                      disabled={isGenerating}
                      onClick={handleApplyShrinkage}
                    >
                      {isGenerating ? 'Waiting…' : 'Apply'}
                    </button>
                    <button
                      type="button"
                      className="saas-btn saas-btn--ghost"
                      disabled={isGenerating}
                      onClick={handleClearShrinkage}
                    >
                      Clear
                    </button>
                  </div>
                  {shrinkageUploadError ? <p className="sched-upload__error m-0 mt-2">{shrinkageUploadError}</p> : null}
                </div>

                {schedulingResult.days.map((day) =>
                  day.isClosed ? (
                    <article key={day.day} className="sched-day-card sched-day-card--closed">
                      <header className="sched-day-card__head">
                        <div>
                          <h3 className="sched-day-card__title">{day.dateLabel}</h3>
                          <p className="saas-muted m-0 text-xs">Closed / rest — outside pattern ∩ working-day settings</p>
                        </div>
                      </header>
                    </article>
                  ) : (
                  <article key={day.day} className="sched-day-card">
                    <header className="sched-day-card__head">
                      <div>
                        <h3 className="sched-day-card__title">{day.dateLabel}</h3>
                        <p className="saas-muted m-0 text-xs">
                          Required {fmtNum(day.dailyRequiredTotal, 1)} · Net FTE after shrinkage (Daily){' '}
                          {fmtNum(day.dailyNetFteTotal ?? 0, 2)}
                        </p>
                      </div>
                      <div className="sched-day-card__badges">
                        <span className="sched-badge sched-badge--over">{day.overstaffedIntervals} over</span>
                        <span className="sched-badge sched-badge--under">{day.understaffedIntervals} under</span>
                      </div>
                    </header>
                    <div className="sched-table-wrap">
                      <table className="sched-table sched-table--compact">
                        <caption>
                          {day.dateLabel} · required vs scheduled · projected SL vs {workspace.slaPercent}% goal
                        </caption>
                        <thead>
                          <tr>
                            <th>Interval</th>
                            <th>Required</th>
                            <th>Scheduled</th>
                            <th>Net FTE</th>
                            <th>Net FTE after shrinkage</th>
                            <th>Variance</th>
                            <th>{showErlangSl ? 'Projected SL (Erlang)' : 'Projected SL'}</th>
                            <th>Occupancy</th>
                            <th>Staffing %</th>
                          </tr>
                        </thead>
                        <tbody>
                          {day.intervals
                            .filter((row) => row.requiredFte > 0.01)
                            .map((row) => (
                            <tr key={row.interval} className={varianceClass(row.variance)}>
                              <th scope="row">{row.interval}</th>
                              <td>{fmtNum(row.requiredFte, 1)}</td>
                              <td>{fmtNum(row.scheduledFte, 2)}</td>
                              <td>{fmtNum(row.netFte ?? 0, 2)}</td>
                              <td>{fmtNum(row.netFteAfterShrinkage ?? row.netFte ?? 0, 2)}</td>
                              <td>
                                {row.variance > 0 ? '+' : ''}
                                {fmtNum(row.variance, 2)}
                              </td>
                              <td className={projectedSlClass(intervalProjectedSl(row, showErlangSl), workspace.slaPercent)}>
                                {fmtProjectedSl(intervalProjectedSl(row, showErlangSl))}
                              </td>
                              <td>{fmtOccupancyPct(row.occupancyPct)}</td>
                              <td>{fmtStaffingPct(row.staffingPct)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </article>
                  ),
                )}
              </div>
            ) : null}

            {tableView === 'schedules' ? (
              <div className="sched-agent-grid-wrap">
                <div className="sched-panel__toolbar sched-agent-grid-toolbar">
                  <p className="saas-muted m-0 text-xs">
                    {generated.productionHc} schedules (Agent 1–{generated.productionHc})
                    {generated.teamSupervisor ? ` · ${generated.teamSupervisor}` : ''}
                    {generated.status === 'saved' ? ' · saved copy' : ' · draft'}
                    {schedulesLocked ? ' · locked' : ' · unlocked'}
                    {resolvedVlHc > 0 ? ` · VL HC ${resolvedVlHc}` : ''}
                  </p>
                  <div className="sched-artifact-toolbar__actions">
                    {schedulesLocked ? (
                      <button type="button" className="saas-btn saas-btn--secondary" onClick={handleUnlockSchedules}>
                        Unlock Schedule
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="saas-btn saas-btn--primary"
                        disabled={!scheduleGridDirty}
                        onClick={handleSaveScheduleEdits}
                      >
                        Save Changes
                      </button>
                    )}
                    <input
                      className="cap-field__input sched-artifact-toolbar__name"
                      placeholder="Save as name…"
                      value={scheduleSaveName}
                      onChange={(event) => setScheduleSaveName(event.target.value)}
                    />
                    <button type="button" className="saas-btn saas-btn--secondary" onClick={handleSaveSchedule}>
                      Save to library
                    </button>
                    <button
                      type="button"
                      className="saas-btn saas-btn--secondary"
                      onClick={() => downloadAgentScheduleExport(generated)}
                    >
                      Download schedule
                    </button>
                  </div>
                </div>
                {scheduleEditError ? <p className="sched-upload__error m-0 mb-2">{scheduleEditError}</p> : null}
                {!schedulesLocked ? (
                  <p className="saas-muted m-0 text-xs mb-2">
                    Edit day cells: <code>OFF</code>, <code>VL</code>, or <code>HH:MM-HH:MM</code> (24h). Save Changes
                    rebuilds lunch/breaks and Interval Comparison, then re-locks.
                  </p>
                ) : null}
                <div className="sched-table-wrap">
                  <table className="sched-table sched-agent-grid">
                    <caption>
                      Agent 1 through Agent {generated.productionHc}. Extra staffing continues that numbering instead of
                      restarting as Additional 1. Rename any row to a real name if needed · max{' '}
                      {restDayCountFromSettings(workspace.rules.settings)} rest days on open days
                    </caption>
                    <thead>
                      <tr>
                        <th>Agent</th>
                        <th>Supervisor</th>
                        {generated.weeklyAgentGrid.dayHeaders.map((header, index) => (
                          <th key={`${header}-${index}`}>{header}</th>
                        ))}
                        <th aria-hidden />
                        {agentBreakColumns.map((column) => (
                          <th key={column.key}>{column.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {displayScheduleRows.map((row) => (
                        <tr key={row.agentIndex}>
                          <th scope="row">
                            <input
                              className="cap-field__input sched-agent-name"
                              value={agentLabelForIndex(row.agentIndex, agentNames)}
                              onChange={(event) => handleAgentNameChange(row.agentIndex, event.target.value)}
                            />
                          </th>
                          <td>{row.supervisor || '—'}</td>
                          {generated.weeklyAgentGrid.weekDates.map((day) => {
                            const cell = row.days[day] ?? 'OFF'
                            const cellClass =
                              cell === 'OFF'
                                ? 'sched-agent-grid__off'
                                : cell.toUpperCase() === 'VL'
                                  ? 'sched-agent-grid__vl'
                                  : undefined
                            return (
                              <td key={`${row.agentIndex}-${day}`} className={cellClass}>
                                {schedulesLocked ? (
                                  cell
                                ) : (
                                  <input
                                    className="cap-field__input sched-agent-day-cell"
                                    value={cell}
                                    onChange={(event) =>
                                      handleScheduleCellChange(row.agentIndex, day, event.target.value)
                                    }
                                    aria-label={`Agent ${row.agentIndex + 1} ${day}`}
                                  />
                                )}
                              </td>
                            )
                          })}
                          <td aria-hidden />
                          {agentBreakColumns.map((column) => (
                            <td key={`${row.agentIndex}-${column.key}`}>{row[column.key]}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </section>
        </>
      ) : (
        <section className="sched-empty saas-card">
          <h2 className="sched-empty__title">
            {!patternUploaded ? 'Upload an interval pattern' : 'Ready to generate schedules'}
          </h2>
          <p className="saas-muted m-0">
            {!patternUploaded ? (
              <>
                Requirements and schedules are based on your uploaded pattern. Upload a file with Day, Interval, and
                Value columns — any interval with a value gets requirements and schedules; days with no values stay
                closed.
              </>
            ) : (
              <>
                Confirm FTE and HC sources, then click <strong>Generate Requirements and Schedule</strong>.
              </>
            )}
          </p>
          <div className="sched-empty__actions">
            {!patternUploaded ? (
              <button type="button" className="saas-btn saas-btn--primary" onClick={() => fileInputRef.current?.click()}>
                Upload pattern
              </button>
            ) : null}
            <button
              type="button"
              className="saas-btn saas-btn--secondary"
              onClick={() => downloadSampleIntervalPatternTemplate(workspace.weekStartIso)}
            >
              Download sample template
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
