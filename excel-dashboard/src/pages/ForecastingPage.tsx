import { useCallback, useEffect, useMemo, useState } from 'react'
import { DriverForecastWorkspace } from '../components/planner/DriverForecastWorkspace'
import { DriverTimelineTable } from '../components/planner/DriverTimelineTable'
import { ScenarioPicker } from '../components/planner/ScenarioPicker'
import { UnsavedChangesDialog } from '../components/UnsavedChangesDialog'
import { StableNumberInput } from '../components/fields/StableNumberInput'
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard'
import { usePlanner } from '../context/PlannerContext'
import {
  analyzeHistoricalAhtMix,
  applyAhtAnalysisOverrides,
  capacityWeekHeadcount,
  countInactiveProductionRoster,
  deriveCapacityPlanRows,
  productionEquivalentAhtSeconds,
  plannedAhtFromNestingMix,
  nestingAnalysisForWeek,
  nestingContactShare,
  resolveNestingAht,
} from '../planner/capacityPlanDerived'
import { buildStageWeekMaps } from '../planner/capacityMatrixDisplay'
import { buildDriverTimeline, type AhtDetail } from '../planner/driverTimeline'
import { resolveCapacityPlanStartWeek, resolveCurrentCalendarWeek } from '../planner/capacityWeekUtils'
import { getScenarioAhtOverrides, setScenarioAhtOverrides } from '../planner/ahtAnalysisPersistence'
import {
  buildForecastDriverGroups,
  forecastMetricDisplayLabel,
  listCustomInOfficeForecastMetricIds,
  type MetricForecastResult,
} from '../planner/forecasting'
import {
  bestDriverModel,
  getDriverForecast,
  getScenarioDrivers,
  usesSampleData,
  type DriverForecastConfig,
} from '../planner/advancedForecastPersistence'
import {
  forecastModesEqual,
  loadScenarioForecastModes,
  saveScenarioForecastModes,
  type ScenarioForecastModes,
} from '../planner/capacityForecastModesPersistence'
import {
  driverPlanApplyEqual,
  restoreDriverPlanApply,
  snapshotDriverPlanApply,
  syncForecastModeForAppliedDrivers,
  type DriverPlanApplySnapshot,
} from '../planner/forecastPlanApply'
import type { ForecastMetricId } from '../planner/forecastPersistence'
import { fmtNum, fmtPct } from '../planner/format'
import { rosterHeadcountOverrides } from '../planner/rosterMetrics'
import { formatScenarioLabel } from '../planner/scenarioDisplay'
import { flushWorkspaceSync } from '../data/workspaceSync'

const HISTORY_OPTIONS = [8, 12, 24, 52] as const
const FORECAST_OPTIONS = [8, 12, 24, 52] as const
const FORECAST_HORIZON = 52
type CohortFilter = 'all' | 'production' | 'nesting' | 'training'
type PageSection = 'drivers' | 'aht' | 'both'


/**
 * Summary of one driver, and the way into its forecasting workspace.
 *
 * Each driver forecasts separately: volume is seasonal and holiday-driven,
 * attrition is a slow count, absenteeism a noisy rate. They need different data
 * and different models, so the detail lives behind this button rather than in a
 * single shared panel.
 */
function ForecastMetricModels({
  metric,
  config,
  onOpen,
}: {
  metric: MetricForecastResult
  config: DriverForecastConfig
  onOpen: () => void
}) {
  const best = bestDriverModel(config)
  const failures = (config.results ?? []).filter((model) => !model.success).length

  const sample = usesSampleData(config)
  const source = sample
    ? `${config.sampleMeta!.points} ${config.sampleMeta!.grain} points of generated sample data`
    : config.dataSource === 'upload' && config.uploadMeta
      ? `${config.uploadMeta.rows} ${config.uploadMeta.interval} points from ${config.uploadMeta.fileName}`
      : metric.actualSeries.length
        ? `${metric.actualSeries.length} weeks of plan actuals`
        : 'No historical actuals on this plan yet'

  return (
    <article className="cap-forecast-metric-card saas-card">
      <div className="cap-forecast-metric-card__head">
        <div>
          <h4 className="cap-forecast-metric-card__title">
            {forecastMetricDisplayLabel(metric.metricId as ForecastMetricId)}
          </h4>
          <p className="saas-muted m-0 text-xs">{source}</p>
          {sample ? <span className="cap-forecast-sample__tag">Sample data</span> : null}
        </div>
        <span className="cap-forecast-metric-card__badge">
          {best ? best.label : metric.selectedModel?.label ?? 'No model'}
        </span>
      </div>

      {best ? (
        <div className="cap-forecast-driver-summary">
          {(
            [
              ['WAPE', best.accuracy?.wape, '%'],
              ['Bias', best.accuracy?.bias, '%'],
              ['RMSE', best.accuracy?.rmse, ''],
              ['Plan weeks', best.weekly?.length, ''],
            ] as Array<[string, number | undefined, string]>
          ).map(([label, value, suffix]) => (
            <div key={label} className="cap-forecast-charts__metric">
              <span className="cap-forecast-charts__metric-label">{label}</span>
              <strong className="cap-forecast-charts__metric-value">
                {value != null && Number.isFinite(value)
                  ? `${fmtNum(value, label === 'Plan weeks' ? 0 : 2)}${suffix}`
                  : '—'}
              </strong>
            </div>
          ))}
        </div>
      ) : (
        <p className="saas-muted m-0 text-sm">
          No forecast yet. Open the forecast workspace to choose data and models for this driver.
        </p>
      )}

      {best ? (
        <p
          className={`cap-forecast-metric-card__apply${metric.usesAdvancedModel ? ' cap-forecast-metric-card__apply--on' : ''}`}
        >
          {metric.usesAdvancedModel
            ? 'Applied to future weeks on this Capacity Plan'
            : 'Analysis only — not driving the Capacity Plan'}
          {failures ? ` · ${failures} model${failures === 1 ? '' : 's'} failed` : ''}
        </p>
      ) : null}

      <button type="button" className="saas-btn saas-btn--primary cap-forecast-driver-open" onClick={onOpen}>
        {best ? 'Open forecast' : 'Forecast this driver'}
      </button>
    </article>
  )
}

export function ForecastingPage() {
  const {
    activeScenario,
    scenarios,
    getScenarioForecast,
    getScenarioLedger,
    getScenarioCapacityPlanOverrides,
    getScenarioRoster,
    getScenarioStageAttritionOverrides,
    refreshAdvancedForecasts,
  } = usePlanner()
  const [viewId, setViewId] = useState(activeScenario?.id ?? '')
  const scenarioId = viewId || activeScenario?.id || ''
  const scenario = scenarios.find((item) => item.id === scenarioId) ?? activeScenario ?? null
  const [historyWeeks, setHistoryWeeks] = useState<(typeof HISTORY_OPTIONS)[number]>(12)
  const [forecastWeeks, setForecastWeeks] = useState<(typeof FORECAST_OPTIONS)[number]>(52)
  const [cohortFilter, setCohortFilter] = useState<CohortFilter>('all')
  const [pageSection, setPageSection] = useState<PageSection>('both')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [methodologyOpen, setMethodologyOpen] = useState(false)
  /** Driver whose forecast workspace is open, or null for the overview. */
  const [openDriver, setOpenDriver] = useState<string | null>(null)
  const [autoOpenedVolume, setAutoOpenedVolume] = useState(false)

  const forecast = getScenarioForecast(scenarioId, FORECAST_HORIZON)
  const openMetric = openDriver
    ? (forecast?.metrics.find((metric) => metric.metricId === openDriver) ?? null)
    : null

  useEffect(() => {
    setAutoOpenedVolume(false)
    setOpenDriver(null)
  }, [scenarioId])

  useEffect(() => {
    if (autoOpenedVolume || openDriver) return
    const volume = getDriverForecast(scenarioId, 'callVolume')
    if (volume.applyToCapacityPlan && (volume.results?.length ?? 0) > 0) {
      setOpenDriver('callVolume')
      setAutoOpenedVolume(true)
    }
  }, [autoOpenedVolume, openDriver, scenarioId])
  const ledger = scenario ? getScenarioLedger(scenario.id) : []
  const plannedOverrides = scenario ? getScenarioCapacityPlanOverrides(scenario.id) : {}
  const currentPlanningWeek = useMemo(
    () => (scenario ? resolveCurrentCalendarWeek(scenario.plan.weekStart, scenario.plan.timezone) : resolveCurrentCalendarWeek('sunday')),
    [scenario],
  )
  /**
   * The same seed the Capacity tab uses for the plan's first forward week.
   *
   * Production headcount at the start week is taken from the roster where one
   * exists. Omitting it fell through to last week's actual less inactive staff,
   * which came out one lower — and because every later week is derived from the
   * one before, that single seed shifted the entire forward series. The two tabs
   * were showing different plans for the same scenario.
   */
  const planStartWeek = scenario ? resolveCapacityPlanStartWeek(scenario.plan) : null
  const rosterPlanStartProductionHc = useMemo(() => {
    if (!planStartWeek || !scenario) return null
    return rosterHeadcountOverrides(getScenarioRoster(scenario.id), planStartWeek).productionHc
  }, [getScenarioRoster, planStartWeek, scenario])

  /** Stage attrition the planner has overridden, which resizes every cohort. */
  const stageAttritionOverrides = useMemo(
    () => (scenario ? getScenarioStageAttritionOverrides(scenario.id) : null),
    [getScenarioStageAttritionOverrides, scenario],
  )

  const inactiveProductionRosterCount = useMemo(() => {
    if (!scenario) return 0
    return countInactiveProductionRoster(getScenarioRoster(scenario.id), currentPlanningWeek)
  }, [currentPlanningWeek, getScenarioRoster, scenario])
  const storedOverrides = scenario ? getScenarioAhtOverrides(scenario.id) : {}
  const [nestingMultiplierInput, setNestingMultiplierInput] = useState(String(storedOverrides.nestingMultiplier ?? ''))
  const [learningCurveInput, setLearningCurveInput] = useState(
    String(storedOverrides.learningCurveWeeklyImprovementPct != null ? storedOverrides.learningCurveWeeklyImprovementPct * 100 : ''),
  )
  const [nestingAhtInput, setNestingAhtInput] = useState(
    String(storedOverrides.nestingAhtSeconds ?? ''),
  )
  const [nestingRampInput, setNestingRampInput] = useState(
    String(storedOverrides.nestingRampWeeks ?? ''),
  )
  const [nestingShareInput, setNestingShareInput] = useState(
    String(storedOverrides.nestingContactShare != null ? storedOverrides.nestingContactShare * 100 : ''),
  )
  const [savedAhtDraft, setSavedAhtDraft] = useState(() => ({
    nesting: String(storedOverrides.nestingMultiplier ?? ''),
    learning:
      storedOverrides.learningCurveWeeklyImprovementPct != null
        ? String(storedOverrides.learningCurveWeeklyImprovementPct * 100)
        : '',
    nestingAht: String(storedOverrides.nestingAhtSeconds ?? ''),
    nestingShare:
      storedOverrides.nestingContactShare != null
        ? String(storedOverrides.nestingContactShare * 100)
        : '',
    nestingRamp: String(storedOverrides.nestingRampWeeks ?? ''),
  }))
  const [applyBaseline, setApplyBaseline] = useState<DriverPlanApplySnapshot>(() =>
    snapshotDriverPlanApply(activeScenario?.id ?? ''),
  )
  const [savedForecastModes, setSavedForecastModes] = useState<ScenarioForecastModes>(() =>
    loadScenarioForecastModes(activeScenario?.id ?? ''),
  )
  const [draftForecastModes, setDraftForecastModes] = useState<ScenarioForecastModes>(() =>
    loadScenarioForecastModes(activeScenario?.id ?? ''),
  )

  useEffect(() => {
    const stored = scenario ? getScenarioAhtOverrides(scenario.id) : {}
    const nesting = String(stored.nestingMultiplier ?? '')
    const learning =
      stored.learningCurveWeeklyImprovementPct != null ? String(stored.learningCurveWeeklyImprovementPct * 100) : ''
    const nestingAht = String(stored.nestingAhtSeconds ?? '')
    const nestingShare =
      stored.nestingContactShare != null ? String(stored.nestingContactShare * 100) : ''
    setNestingMultiplierInput(nesting)
    setLearningCurveInput(learning)
    const nestingRamp = String(stored.nestingRampWeeks ?? '')
    setNestingAhtInput(nestingAht)
    setNestingShareInput(nestingShare)
    setNestingRampInput(nestingRamp)
    setSavedAhtDraft({ nesting, learning, nestingAht, nestingShare, nestingRamp })
  }, [scenario?.id])

  useEffect(() => {
    if (!scenarioId) {
      setApplyBaseline({})
      setSavedForecastModes({})
      setDraftForecastModes({})
      return
    }
    const modes = loadScenarioForecastModes(scenarioId)
    setApplyBaseline(snapshotDriverPlanApply(scenarioId))
    setSavedForecastModes(modes)
    setDraftForecastModes(modes)
  }, [scenarioId])

  const ahtDirty =
    nestingMultiplierInput !== savedAhtDraft.nesting ||
    learningCurveInput !== savedAhtDraft.learning ||
    nestingAhtInput !== savedAhtDraft.nestingAht ||
    nestingShareInput !== savedAhtDraft.nestingShare ||
    nestingRampInput !== savedAhtDraft.nestingRamp
  const applyDirty = !driverPlanApplyEqual(snapshotDriverPlanApply(scenarioId), applyBaseline)
  const modesDirty = !forecastModesEqual(draftForecastModes, savedForecastModes)
  const forecastDirty = ahtDirty || applyDirty || modesDirty
  const { isBlocked: navigationBlocked, proceed: proceedNavigation, cancel: cancelNavigation } =
    useUnsavedChangesGuard({ when: forecastDirty })

  const ahtOverrides = useMemo(
    () => ({
      nestingMultiplier: nestingMultiplierInput.trim() === '' ? undefined : Number(nestingMultiplierInput),
      learningCurveWeeklyImprovementPct:
        learningCurveInput.trim() === '' ? undefined : Number(learningCurveInput) / 100,
      nestingAhtSeconds: nestingAhtInput.trim() === '' ? undefined : Number(nestingAhtInput),
      // Entered as a percentage, stored as a share, and clamped: a contact share
      // above one is not a stronger assumption, it is an impossible one.
      nestingContactShare:
        nestingShareInput.trim() === ''
          ? undefined
          : Math.min(1, Math.max(0, Number(nestingShareInput) / 100)),
      // A ramp shorter than a week is not a ramp; below one the cohort has had
      // no time to improve and the flat penalty is already the right answer.
      nestingRampWeeks:
        nestingRampInput.trim() === '' ? undefined : Math.max(1, Math.round(Number(nestingRampInput))),
    }),
    [
      learningCurveInput,
      nestingAhtInput,
      nestingMultiplierInput,
      nestingRampInput,
      nestingShareInput,
    ],
  )

  const capacityRows = useMemo(
    () =>
      scenario
        ? deriveCapacityPlanRows(
            ledger,
            scenario,
            forecast,
            plannedOverrides,
            // The plan's own forecast modes, not the defaults: reading a
            // different plan than the Capacity tab shows is the whole problem
            // this argument list is here to avoid.
            savedForecastModes,
            inactiveProductionRosterCount,
            ahtOverrides,
            stageAttritionOverrides,
            undefined,
            rosterPlanStartProductionHc,
          )
        : [],
    [
      ahtOverrides,
      forecast,
      inactiveProductionRosterCount,
      ledger,
      plannedOverrides,
      rosterPlanStartProductionHc,
      savedForecastModes,
      scenario,
      stageAttritionOverrides,
    ],
  )

  /**
   * One analysis, used by the plan and by the panel describing the plan.
   *
   * The ramp default belongs here rather than beside the calculation, because it
   * was previously applied to planned weeks while the panel above them read from
   * an analysis that knew nothing about it — the plan ramped, the screen said it
   * did not. It stays out of the stored overrides so the plan's own nesting
   * period keeps flowing through when it changes.
   */
  const historicalAnalysis = useMemo(() => {
    const analysis = applyAhtAnalysisOverrides(
      analyzeHistoricalAhtMix(ledger, capacityRows),
      ahtOverrides,
    )
    const plannedNestingWeeks = scenario?.assumptions.newHire.nestingWeeks
    const fallback =
      plannedNestingWeeks != null && plannedNestingWeeks >= 1
        ? Math.round(plannedNestingWeeks)
        : undefined
    return { ...analysis, nestingRampWeeks: analysis.nestingRampWeeks ?? fallback }
  }, [ahtOverrides, capacityRows, ledger, scenario?.assumptions.newHire.nestingWeeks])

  const driverMetrics = useMemo(() => {
    const byId = new Map(forecast?.metrics.map((metric) => [metric.metricId, metric]))
    const customInOfficeIds = listCustomInOfficeForecastMetricIds(ledger)
    return buildForecastDriverGroups(customInOfficeIds).map((group) => ({
      ...group,
      metrics: group.metricIds
        .map((metricId) => byId.get(metricId))
        .filter((metric): metric is MetricForecastResult => metric != null),
    }))
  }, [forecast?.metrics, ledger])

  const ahtMetric = useMemo(
    () => forecast?.metrics.find((metric) => metric.metricId === 'ahtSeconds') ?? null,
    [forecast?.metrics],
  )
  const hasHistoricalAht = (ahtMetric?.actualSeries.length ?? 0) >= 3
  /**
   * AHT is described the same way as any other driver: by the model actually
   * driving it. The nesting-mix adjustment is applied on top, so it is named
   * alongside rather than instead of the model.
   */
  const ahtMethodLabel = ahtMetric?.usesAdvancedModel
    ? `${ahtMetric.selectedModel?.label ?? 'service model'} + nesting mix`
    : hasHistoricalAht
      ? `${ahtMetric?.selectedModel?.label ?? 'best RMSE'} + nesting mix`
      : `Nesting multiplier ×${fmtNum(historicalAnalysis.nestingMultiplier, 2)} (no AHT history yet)`

  const saveAhtSettings = () => {
    if (!scenario) return
    setScenarioAhtOverrides(scenario.id, ahtOverrides)
    setSavedAhtDraft({
      nesting: nestingMultiplierInput,
      learning: learningCurveInput,
      nestingAht: nestingAhtInput,
      nestingShare: nestingShareInput,
      nestingRamp: nestingRampInput,
    })
    void flushWorkspaceSync()
  }

  const restoreAhtDraft = () => {
    setNestingMultiplierInput(savedAhtDraft.nesting)
    setLearningCurveInput(savedAhtDraft.learning)
    setNestingAhtInput(savedAhtDraft.nestingAht)
    setNestingShareInput(savedAhtDraft.nestingShare)
    setNestingRampInput(savedAhtDraft.nestingRamp)
  }

  const handleForecastSaved = useCallback(() => {
    refreshAdvancedForecasts()
    if (!scenarioId) return
    const nextModes = syncForecastModeForAppliedDrivers(scenarioId, savedForecastModes)
    setDraftForecastModes(nextModes)
  }, [refreshAdvancedForecasts, savedForecastModes, scenarioId])

  const saveForecastSetup = () => {
    if (!scenarioId) return
    saveAhtSettings()
    const nextModes = syncForecastModeForAppliedDrivers(scenarioId, savedForecastModes)
    saveScenarioForecastModes(scenarioId, nextModes)
    setDraftForecastModes(nextModes)
    setSavedForecastModes(nextModes)
    setApplyBaseline(snapshotDriverPlanApply(scenarioId))
    refreshAdvancedForecasts()
    void flushWorkspaceSync()
  }

  const undoForecastSetup = () => {
    if (!scenarioId) return
    restoreDriverPlanApply(scenarioId, applyBaseline)
    saveScenarioForecastModes(scenarioId, savedForecastModes)
    setDraftForecastModes(savedForecastModes)
    restoreAhtDraft()
    refreshAdvancedForecasts()
  }

  const resetAhtSettings = () => {
    if (!scenario) return
    setScenarioAhtOverrides(scenario.id, {})
    setNestingMultiplierInput('')
    setLearningCurveInput('')
    setNestingAhtInput('')
    setNestingShareInput('')
    setNestingRampInput('')
    setSavedAhtDraft({ nesting: '', learning: '', nestingAht: '', nestingShare: '', nestingRamp: '' })
  }

  /**
   * What the blend will actually use, resolved by the blend's own function so
   * the explanation on screen cannot drift away from the model.
   */
  /**
   * The nesting multiplier and nesting AHT are one setting expressed two ways —
   * seconds = production baseline x multiplier. Whichever the planner states
   * drives, and the other shows what that implies, so the pair can never sit on
   * screen disagreeing with each other.
   */
  const nestingAhtStated = nestingAhtInput.trim() !== ''
  const nestingBaselineAht =
    historicalAnalysis.productionOnlyAht ?? scenario?.assumptions.tenured.ahtSeconds ?? null

  const impliedMultiplier = useMemo(() => {
    if (!nestingAhtStated || !nestingBaselineAht) return null
    const seconds = Number(nestingAhtInput)
    if (!Number.isFinite(seconds) || nestingBaselineAht <= 0) return null
    return seconds / nestingBaselineAht
  }, [nestingAhtInput, nestingAhtStated, nestingBaselineAht])

  const impliedNestingAht = useMemo(() => {
    if (nestingAhtStated || !nestingBaselineAht) return null
    const typed = Number(nestingMultiplierInput)
    const multiplier =
      nestingMultiplierInput.trim() !== '' && Number.isFinite(typed)
        ? typed
        : historicalAnalysis.nestingMultiplier
    return nestingBaselineAht * multiplier
  }, [
    historicalAnalysis.nestingMultiplier,
    nestingAhtStated,
    nestingBaselineAht,
    nestingMultiplierInput,
  ])


  const effectiveNesting = useMemo(
    () =>
      resolveNestingAht(
        historicalAnalysis.productionOnlyAht ?? scenario?.assumptions.tenured.ahtSeconds ?? 300,
        historicalAnalysis,
        scenario?.assumptions.tenured.ahtSeconds ?? undefined,
      ),
    [historicalAnalysis, scenario?.assumptions.tenured.ahtSeconds],
  )

  /**
   * The ramp stated in the terms a planner set it in: starts here, ends at
   * production, and the cohort on the floor averages this. Reading the average
   * back is what makes the setting checkable rather than a number on faith.
   */
  const rampSummary = useMemo(() => {
    const weeks = Number(nestingRampInput)
    if (nestingRampInput.trim() === '' || !Number.isFinite(weeks) || weeks < 1) return null
    const start = effectiveNesting.startSeconds ?? effectiveNesting.seconds
    const baseline = historicalAnalysis.productionOnlyAht ?? scenario?.assumptions.tenured.ahtSeconds
    if (!baseline) return null
    return `Starts at ${fmtNum(start, 0)} sec and reaches ${fmtNum(baseline, 0)} sec after ${fmtNum(weeks, 0)} weeks. Spread across that ramp the cohort averages ${fmtNum(effectiveNesting.seconds, 0)} sec, which is what the plan uses.`
  }, [
    effectiveNesting,
    historicalAnalysis.productionOnlyAht,
    nestingRampInput,
    scenario?.assumptions.tenured.ahtSeconds,
  ])

  const historicalAhtRows = useMemo(() => {
    const actualRows = capacityRows.filter((row) => row.timeline === 'historical_actual').slice(-historyWeeks)
    return actualRows
      .map((row) => {
        const headcount = capacityWeekHeadcount(row)
        const nestingHc = headcount.nestingHc
        const productionHc = headcount.productionHc
        const trainingHc = headcount.trainingHc
        const cohort = nestingHc > 0 ? 'nesting' : trainingHc > 0 ? 'training' : 'production'
        const actualAht = headcount.actualAhtSeconds
        if (actualAht == null) return null
        const adjustedAht = productionEquivalentAhtSeconds(
          actualAht,
          nestingHc,
          productionHc,
          historicalAnalysis,
          headcount.actualNestingPhoneTimePct,
        )
        return {
          week: row.week,
          cohort,
          cohortLabel: nestingHc > 0 ? 'Nesting present' : trainingHc > 0 ? 'Training only' : 'Production only',
          nestingHc,
          productionHc,
          actualAht,
          adjustedAht,
          nestingLiftSec: nestingHc > 0 ? actualAht - adjustedAht : 0,
        }
      })
      .filter((row): row is NonNullable<typeof row> => row != null)
      .filter((row) => cohortFilter === 'all' || row.cohort === cohortFilter)
  }, [capacityRows, cohortFilter, historicalAnalysis, historyWeeks])

  /**
   * How many agents sit in each week of nesting, per plan week.
   *
   * The hiring pipeline already walks every training class through nesting one
   * stage at a time, so the tenure mix behind a week's nesting headcount is
   * known rather than assumed. That is what lets the ramp be weighted by who is
   * actually on the floor instead of averaged as though intake were steady.
   */
  const nestingStageMaps = useMemo(() => {
    if (!scenario) return null
    const trainingWeeks = Math.max(1, Math.round(scenario.assumptions.newHire.trainingWeeks))
    const nestingWeeks = Math.max(1, Math.round(scenario.assumptions.newHire.nestingWeeks))
    return buildStageWeekMaps(capacityRows, trainingWeeks, nestingWeeks, scenario.assumptions).nesting
  }, [capacityRows, scenario])

  /**
   * Weeks the ramp runs over, defaulting to the plan's own nesting period.
   *
   * The plan already states how long nesting lasts, so asking again with a blank
   * box was asking twice. It stays overridable because AHT often keeps improving
   * after graduation — the ramp can legitimately outlast the cohort.
   */
  const plannedAhtRows = useMemo(() => {
    const futureRows = capacityRows.filter((row) => row.timeline === 'forward_plan').slice(0, forecastWeeks)
    const tenuredAht = scenario?.assumptions.tenured.ahtSeconds ?? null
    const historyReady = (ahtMetric?.actualSeries.length ?? 0) >= 3
    /** Production-only forecast by plan week — never the Capacity remixed Planned AHT. */
    const productionForecastByWeek = new Map<string, number>()
    for (const point of ahtMetric?.forecast ?? []) {
      if (Number.isFinite(point.value)) productionForecastByWeek.set(point.label, point.value)
    }
    /** Row positions in the full plan, which is how the stage maps are keyed. */
    const rowIndexByWeek = new Map(capacityRows.map((row, index) => [row.week, index]))
    const lastActualProductionHc = (() => {
      const history = capacityRows.filter((row) => row.timeline === 'historical_actual')
      const last = history[history.length - 1]
      return last ? capacityWeekHeadcount(last).productionHc : null
    })()
    const assumptionPhoneTimePct = scenario?.assumptions.newHire.nestingPhoneTimePct ?? null
    return futureRows.map((row, index) => {
      const headcount = capacityWeekHeadcount(row)
      const modelValue = productionForecastByWeek.get(row.week)
      /**
       * AHT (sec) is production-only. Do not fall back to Capacity planned AHT —
       * when the driver mode is forecast that cell is already Mix-adj, which made
       * both timeline columns read the same number.
       */
      const baseForecastAht = historyReady
        ? (modelValue ?? tenuredAht)
        : (tenuredAht ?? modelValue)
      if (baseForecastAht == null || !Number.isFinite(baseForecastAht)) return null

      /**
       * This week's nesting handle time, from the tenure mix actually on the
       * floor. Passed as a stated figure with the ramp cleared, because the
       * weighting has already walked the ramp — leaving it set would apply the
       * ramp twice.
       *
       * Falls back to the ramp average whenever the pipeline has no cohort
       * detail for the week, which happens when nesting headcount was keyed
       * directly rather than arriving from a training class.
       */
      const rowIndex = rowIndexByWeek.get(row.week)
      const stageHeadcounts =
        nestingStageMaps && rowIndex != null
          ? nestingStageMaps.map((stage) => stage.get(rowIndex) ?? 0)
          : []

      const { analysis: weekAnalysis, basis } = nestingAnalysisForWeek(
        baseForecastAht,
        stageHeadcounts,
        historicalAnalysis,
        historicalAnalysis.nestingRampWeeks ?? null,
        tenuredAht ?? undefined,
      )

      /**
       * Match Capacity Plan mix math: the first forward week blends against the
       * prior actual production HC, then subsequent weeks use planned production.
       */
      const productionHcForMix =
        index === 0 && lastActualProductionHc != null && lastActualProductionHc > 0
          ? lastActualProductionHc
          : headcount.plannedProductionHc

      const adjustedAht = plannedAhtFromNestingMix(
        baseForecastAht,
        headcount.plannedNestingHc,
        productionHcForMix,
        weekAnalysis,
        tenuredAht ?? undefined,
        headcount.nestingPhoneTimePct,
        assumptionPhoneTimePct,
      )
      return {
        week: row.week,
        nestingHc: headcount.plannedNestingHc,
        productionHc: headcount.plannedProductionHc,
        historicalNestingHc: historicalAnalysis.historicalAvgNestingHc,
        baseForecastAht,
        adjustedAht,
        nestingUpliftSec: adjustedAht - baseForecastAht,
        nestingBasis: basis,
        nestingPhoneTimePct: headcount.nestingPhoneTimePct,
        // The plan's own leavers for the week, so the timeline can show a
        // headcount and an attrition that belong to each other.
        attritionHc: row.planned.attritionHc ?? 0,
        method: historyReady ? ('time_series' as const) : ('multiplier' as const),
      }
    }).filter((row): row is NonNullable<typeof row> => row != null)
  }, [
    ahtMetric,
    capacityRows,
    forecastWeeks,
    historicalAnalysis,
    nestingStageMaps,
    scenario?.assumptions.newHire.nestingPhoneTimePct,
    scenario?.assumptions.tenured.ahtSeconds,
  ])

  /**
   * What the learning curve is worth on this plan, in seconds.
   *
   * Stated as a rate per week it reads like compounding weekly improvement, and
   * a planner sizing its importance from the label would be badly out: it is a
   * single small trim on the nesting portion of the blend. Showing the seconds
   * it actually removes is the only description that cannot mislead, and it
   * lets someone decide in one glance whether the setting is worth their time.
   */
  /** Planned weeks that actually schedule nesting, which is what the mix needs. */
  const plannedNestingWeeks = useMemo(
    () => plannedAhtRows.filter((row) => row.nestingHc > 0).length,
    [plannedAhtRows],
  )

  /**
   * What headcount would have implied, when a stated contact share is overriding
   * it. Taken from the heaviest nesting week, where the two diverge most.
   *
   * A stated share silently outranks the roster on every week, and a figure left
   * behind from an earlier session distorts the whole plan while reading as a
   * normal setting. Showing what it replaced makes the difference obvious
   * instead of leaving it to be reverse-engineered from the numbers.
   */
  const headcountImpliedShare = useMemo(() => {
    if (historicalAnalysis.assumedNestingContactShare == null) return null
    const heaviest = plannedAhtRows
      .filter((row) => row.nestingHc > 0)
      .sort((a, b) => b.nestingHc - a.nestingHc)[0]
    if (!heaviest) return null
    const nestingAht = resolveNestingAht(
      heaviest.baseForecastAht,
      historicalAnalysis,
      scenario?.assumptions.tenured.ahtSeconds ?? undefined,
    ).seconds
    return nestingContactShare(
      heaviest.nestingHc,
      heaviest.productionHc,
      nestingAht,
      heaviest.baseForecastAht,
      heaviest.nestingPhoneTimePct,
    )
  }, [historicalAnalysis, plannedAhtRows, scenario?.assumptions.tenured.ahtSeconds])

  /**
   * Settings that cannot change this plan, and so should not invite input.
   *
   * Every nesting figure multiplies by the week's nesting headcount, so a plan
   * scheduling none is untouched by all of them; and the learning curve stands
   * down whenever a ramp is modelling the same improvement. Leaving those
   * editable invites a planner to tune a number, watch nothing move, and
   * conclude the tab is broken.
   */
  /**
   * Weeks where Nesting HC is on the floor and Mix-adj. AHT moves.
   *
   * Phone time of zero no longer zeroes the mix — Nesting HC alone lifts
   * Mix-adj above production-only AHT — so settings stay live whenever nesting
   * headcount is scheduled.
   */
  const nestingWeeksOnPhone = useMemo(
    () => plannedAhtRows.filter((row) => row.nestingHc > 0).length,
    [plannedAhtRows],
  )

  const nestingSettingsInert = nestingWeeksOnPhone === 0
  const nestingScheduledButSilent = false
  const rampInEffect = historicalAnalysis.nestingRampWeeks != null

  const learningCurveEffect = useMemo(() => {
    const week = plannedAhtRows.find((row) => row.nestingHc > 0)
    if (!week) return null
    const withoutCurve = plannedAhtFromNestingMix(
      week.baseForecastAht,
      week.nestingHc,
      week.productionHc,
      { ...historicalAnalysis, learningCurveWeeklyImprovementPct: 0 },
      scenario?.assumptions.tenured.ahtSeconds ?? undefined,
      week.nestingPhoneTimePct,
      scenario?.assumptions.newHire.nestingPhoneTimePct,
    )
    const seconds = withoutCurve - week.adjustedAht
    return { seconds, pct: week.adjustedAht > 0 ? seconds / week.adjustedAht : 0, week: week.week }
  }, [historicalAnalysis, plannedAhtRows, scenario?.assumptions.tenured.ahtSeconds])

  /** Real calendar weeks behind the series, so the service can align holidays. */
  const historyWeekStarts = useMemo(
    () => ledger.filter((row) => row.timeline === 'historical_actual').map((row) => row.week),
    [ledger],
  )
  const futureWeekStarts = useMemo(
    () =>
      ledger
        .filter((row) => row.timeline === 'forward_plan')
        .slice(0, FORECAST_HORIZON)
        .map((row) => row.week),
    [ledger],
  )

  /**
   * Per-driver configs, re-read whenever the forecast package changes — which is
   * what a saved run and a model choice both produce.
   */
  const driverConfigs = useMemo(
    () => getScenarioDrivers(scenarioId),
    [scenarioId, forecast],
  )

  /**
   * AHT nesting detail per week, feeding the shared timeline. Built from the
   * same rows the two AHT tables used, so the numbers are unchanged — only
   * where they are shown.
   */
  const ahtDetailByWeek = useMemo(() => {
    const detail = new Map<string, AhtDetail>()
    for (const row of historicalAhtRows) {
      detail.set(row.week, {
        // Recorded AHT already carries whatever nesting was on the floor; the
        // production-equivalent figure is the one derived from it.
        productionOnlyAht: row.adjustedAht,
        withNestingAht: row.actualAht,
        nestingHc: row.nestingHc,
        productionHc: row.productionHc,
        note: row.cohortLabel,
      })
    }
    for (const row of plannedAhtRows) {
      detail.set(row.week, {
        /**
         * Both columns, meaning on planned weeks what they mean on actual ones:
         * the handle time the floor will run at with nesting in it, and the
         * production-equivalent figure underneath with nesting taken out.
         *
         * The adjusted column previously repeated the blended value, so the two
         * were identical down every forecast row — including the weeks carrying
         * ten and twenty agents in nesting, which are precisely the weeks a
         * planner opens this table to see.
         */
        productionOnlyAht: row.baseForecastAht,
        withNestingAht: row.adjustedAht,
        attritionHc: row.attritionHc,
        nestingHc: row.nestingHc,
        productionHc: row.productionHc,
        note: row.method === 'time_series' ? 'Time series + nesting mix' : 'Nesting multiplier',
      })
    }
    return detail
  }, [historicalAhtRows, plannedAhtRows])

  /** Capacity staffing HC for every plan week — fills timeline Nesting / Production HC. */
  const staffingHcByWeek = useMemo(() => {
    const map = new Map<string, { nestingHc: number | null; productionHc: number | null }>()
    for (const row of capacityRows) {
      const headcount = capacityWeekHeadcount(row)
      if (row.timeline === 'historical_actual') {
        map.set(row.week, {
          nestingHc: headcount.nestingHc,
          productionHc: headcount.productionHc,
        })
      } else {
        map.set(row.week, {
          nestingHc: headcount.plannedNestingHc,
          productionHc: headcount.plannedProductionHc,
        })
      }
    }
    return map
  }, [capacityRows])

  const timelineRows = useMemo(
    () =>
      buildDriverTimeline({
        ledger,
        forecast,
        ahtDetail: ahtDetailByWeek,
        staffingHc: staffingHcByWeek,
        historyWeeks,
        forecastWeeks,
      }),
    [ahtDetailByWeek, forecast, forecastWeeks, historyWeeks, ledger, staffingHcByWeek],
  )

  /** Drivers currently fed by a service model, for the timeline's header note. */
  /** Drivers whose forecast came from generated sample data, not real history. */
  const sampleDrivenDrivers = useMemo(
    () =>
      Object.entries(driverConfigs)
        .filter(([, config]) => config && usesSampleData(config) && config.results?.length)
        .map(([metricId]) => forecastMetricDisplayLabel(metricId as ForecastMetricId)),
    [driverConfigs],
  )

  /**
   * Drivers that have a fitted forecast nobody switched on.
   *
   * Running a forecast and seeing the timeline unchanged is the most confusing
   * state in this tab: the models fitted, the accuracy is on screen, and the
   * plan quietly carries on with its own baseline because applying is a separate
   * step. Naming those drivers turns a silence into an instruction.
   */
  /**
   * Forward weeks carrying a hand-set attrition rate on the Capacity Plan.
   *
   * A per-week rate outranks the applied forecast, and it is stored as a rate
   * rather than a count — so once hiring changes the headcount it applies to, a
   * figure captured as two of eight becomes five of eighteen, or none of sixty
   * three. The forecast is left on screen looking ignored, which is what it is.
   */
  const attritionOverrideWeeks = useMemo(
    () =>
      Object.entries(plannedOverrides).filter(
        ([week, override]) => override?.attritionPct != null && futureWeekStarts.includes(week),
      ).length,
    [futureWeekStarts, plannedOverrides],
  )

  const analysisOnlyDrivers = useMemo(
    () =>
      Object.entries(driverConfigs)
        .filter(
          ([, config]) =>
            config &&
            !config.applyToCapacityPlan &&
            (config.results ?? []).some((model) => model.success),
        )
        .map(([metricId]) => forecastMetricDisplayLabel(metricId as ForecastMetricId)),
    [driverConfigs],
  )

  const serviceDrivenDrivers = useMemo(
    () =>
      (forecast?.metrics ?? [])
        .filter((metric) => metric.usesAdvancedModel)
        .map((metric) => forecastMetricDisplayLabel(metric.metricId as ForecastMetricId)),
    [forecast?.metrics],
  )

  /**
   * A driver workspace takes over the page while it is open.
   *
   * Forecasting one driver is a focused job, and the page furniture below it —
   * AHT benchmarks, nesting settings, the whole-plan timeline — belongs to the
   * overview. Left on screen underneath, it read as though the AHT model
   * mattered to the volume forecast being worked on.
   */
  const inWorkspace = Boolean(openMetric)
  const showAht = (pageSection === 'both' || pageSection === 'aht') && !inWorkspace

  /**
   * Driver cards belonging to the chosen view.
   *
   * The three views read as a partition — drivers, AHT, or both — so AHT has to
   * leave the driver list when it is not the subject and arrive in the AHT view
   * when it is. Previously the driver list always held it and the AHT view never
   * did, so "AHT only" was the one view with no AHT forecast in it.
   */
  const visibleDriverGroups = useMemo(
    () =>
      driverMetrics.filter((group) =>
        pageSection === 'both' ? true : pageSection === 'aht' ? group.id === 'aht' : group.id !== 'aht',
      ),
    [driverMetrics, pageSection],
  )

  return (
    <div className="cap-forecast-page space-y-4">
      <section className="cap-forecast-hero saas-card">
        <div className="cap-forecast-hero__copy">
          <h2 className="cap-forecast-hero__title">Drivers & AHT</h2>
          {scenario ? (
            <p className="cap-forecast-hero__meta m-0 text-sm">{formatScenarioLabel(scenario)}</p>
          ) : null}
        </div>
        <ScenarioPicker value={scenarioId} onChange={setViewId} help="Plan to forecast." />
      </section>

      <section className="cap-forecast-filters saas-card">
        <div className="cap-forecast-filters__head">
          <div>
            <h3 className="m-0 text-sm font-bold text-slate-900">View</h3>
          </div>
          <div className="cap-forecast-filters__tabs" role="tablist" aria-label="Forecasting section">
            {(
              [
                ['both', 'Drivers & AHT'],
                ['drivers', 'Driver models'],
                ['aht', 'AHT only'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={pageSection === id}
                className={`cap-forecast-filters__tab${pageSection === id ? ' cap-forecast-filters__tab--active' : ''}`}
                onClick={() => setPageSection(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {showAht ? (
          <div className="cap-forecast-filters__grid">
            <label className="saas-field">
              <span className="saas-field__label">Historical weeks (AHT)</span>
              <select
                className="cap-field__input"
                value={historyWeeks}
                onChange={(event) => setHistoryWeeks(Number(event.target.value) as (typeof HISTORY_OPTIONS)[number])}
              >
                {HISTORY_OPTIONS.map((weeks) => (
                  <option key={`hist-${weeks}`} value={weeks}>
                    Last {weeks} weeks
                  </option>
                ))}
              </select>
            </label>
            <label className="saas-field">
              <span className="saas-field__label">Forecast weeks (AHT)</span>
              <select
                className="cap-field__input"
                value={forecastWeeks}
                onChange={(event) => setForecastWeeks(Number(event.target.value) as (typeof FORECAST_OPTIONS)[number])}
              >
                {FORECAST_OPTIONS.map((weeks) => (
                  <option key={`fc-${weeks}`} value={weeks}>
                    Next {weeks} weeks
                  </option>
                ))}
              </select>
            </label>
            <label className="saas-field">
              <span className="saas-field__label">Historical cohort</span>
              <select
                className="cap-field__input"
                value={cohortFilter}
                onChange={(event) => setCohortFilter(event.target.value as CohortFilter)}
              >
                <option value="all">All cohorts</option>
                <option value="production">Production only</option>
                <option value="nesting">Nesting present</option>
                <option value="training">Training only</option>
              </select>
            </label>
          </div>
        ) : null}
      </section>

      {openMetric ? (
        <DriverForecastWorkspace
          key={openMetric.metricId}
          scenarioId={scenarioId}
          weekStart={scenario?.plan.weekStart ?? 'sunday'}
          metric={openMetric}
          historyWeeks={historyWeekStarts}
          futureWeeks={futureWeekStarts}
          onClose={() => setOpenDriver(null)}
          onResultsSaved={handleForecastSaved}
        />
      ) : null}

      {!openMetric && visibleDriverGroups.length ? (
        <div className="cap-forecast-drivers space-y-4">
          {visibleDriverGroups.map((group) => (
            <section key={group.id} className="cap-forecast-driver-group saas-card">
              <div className="cap-forecast-driver-group__head">
                <h3 className="m-0 text-sm font-bold text-slate-900">{group.title}</h3>
              </div>
              <div className="cap-forecast-driver-group__grid">
                {group.metrics.map((metric) => (
                  <ForecastMetricModels
                    key={metric.metricId}
                    metric={metric}
                    config={driverConfigs[metric.metricId] ?? getDriverForecast(scenarioId, metric.metricId)}
                    onOpen={() => setOpenDriver(metric.metricId)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}

      {showAht ? (
        <>
          <div className="cap-forecast-kpi-grid">
            <div className="cap-forecast-kpi cap-forecast-kpi--actual">
              <p className="cap-forecast-kpi__label">Production-only AHT</p>
              <p className="cap-forecast-kpi__value">
                {historicalAnalysis.productionOnlyAht != null ? `${fmtNum(historicalAnalysis.productionOnlyAht, 1)} sec` : '—'}
              </p>
              <p className="cap-forecast-kpi__meta">{historicalAnalysis.weeksProductionOnly} weeks in sample</p>
            </div>
            <div className="cap-forecast-kpi cap-forecast-kpi--actual">
              <p className="cap-forecast-kpi__label">With nesting AHT</p>
              {/*
                The figure the plan will actually use, not the measured
                benchmark it may have replaced. A tile that ignores the
                assumption a planner just typed is worse than no tile.
              */}
              <p className="cap-forecast-kpi__value">{fmtNum(effectiveNesting.seconds, 1)} sec</p>
              <p className="cap-forecast-kpi__meta">
                {effectiveNesting.source === 'stated'
                  ? 'Your assumption — used instead of the multiplier'
                  : effectiveNesting.source === 'measured'
                    ? `${historicalAnalysis.weeksWithNesting} weeks in sample`
                    : 'No nesting weeks observed — implied by the multiplier'}
              </p>
            </div>
            <div className="cap-forecast-kpi cap-forecast-kpi--highlight">
              <p className="cap-forecast-kpi__label">Nesting multiplier</p>
              <p className="cap-forecast-kpi__value">{fmtNum(historicalAnalysis.nestingMultiplier, 3)}×</p>
              {/*
                Named honestly. Only 'measured' means this plan's own nesting
                weeks produced the figure; 'assumed' is an industry default
                standing in for evidence this account has not yet produced, and
                a planner defending a number to a client needs to know which.
              */}
              <p className="cap-forecast-kpi__meta">
                {historicalAnalysis.nestingMultiplierSource === 'measured'
                  ? `Measured from ${historicalAnalysis.weeksWithNesting} nesting weeks`
                  : historicalAnalysis.nestingMultiplierSource === 'override'
                    ? 'Set by you, overriding the plan history'
                    : 'Assumed default — no nesting history to measure from'}
              </p>
            </div>
            <div className="cap-forecast-kpi">
              <p className="cap-forecast-kpi__label">Avg historical nesting HC</p>
              <p className="cap-forecast-kpi__value">{fmtNum(historicalAnalysis.historicalAvgNestingHc, 0)}</p>
              <p className="cap-forecast-kpi__meta">Used when planned nesting is zero</p>
            </div>
            <div className="cap-forecast-kpi cap-forecast-kpi--planned">
              <p className="cap-forecast-kpi__label">Learning curve</p>
              <p className="cap-forecast-kpi__value">{fmtPct(historicalAnalysis.learningCurveWeeklyImprovementPct)} / week</p>
              <p className="cap-forecast-kpi__meta">Scaled by nesting share</p>
            </div>
          </div>

          <section className="cap-forecast-panel saas-card">
            <div className="cap-forecast-panel__head">
              <div>
                <h3 className="m-0 text-sm font-bold text-slate-900">AHT model settings</h3>
              </div>
              <button
                type="button"
                className={`cap-forecast-panel__toggle${settingsOpen ? ' is-active' : ''}`}
                onClick={() => setSettingsOpen((prev) => !prev)}
              >
                {settingsOpen ? 'Hide' : 'Show'}
              </button>
            </div>
            {settingsOpen ? (
              <div className="cap-forecast-panel__body">
                {/*
                  Four inputs that overlap, where two silently outrank the others.
                  Left unexplained a planner sets a multiplier, then states a
                  nesting AHT, and never learns the multiplier stopped counting.
                */}
                <div className="cap-forecast-aht-guide">
                  <p className="cap-forecast-aht-guide__lead">
                    Two questions decide planned AHT: how slowly nesting agents handle, and how much
                    of the queue reaches them. Answer each one way or the other — you do not need all
                    four boxes.
                  </p>
                  <ol className="cap-forecast-aht-guide__steps">
                    <li>
                      <strong>How slowly does nesting handle?</strong> If this plan has run nesting
                      before, leave both boxes empty and it is measured from those weeks. If it has
                      not, either state <em>Nesting AHT</em> in seconds, or set a{' '}
                      <em>multiplier</em> on the production baseline. Stating the seconds is the
                      better answer when you know it; the multiplier is for when you only know it is
                      &ldquo;about a third slower&rdquo;.
                    </li>
                    <li>
                      <strong>How much of the queue reaches nesting?</strong> Normally leave this
                      empty — it follows from headcount and the two handle times each week. Set{' '}
                      <em>share of contacts</em> only if you deliberately throttle what routes to a
                      nesting cohort, because nothing in the roster reveals that.
                    </li>
                    <li>
                      <strong>Learning curve</strong> is how fast a nesting agent improves each week
                      they are in nesting. It is measured by comparing weeks heavy in nesting
                      against weeks light in it, and you can override it if you know this programme
                      ramps differently.
                      <br />
                      <em>
                        It is the smallest of these settings by some distance. The nesting benchmark
                        is already an average over agents at every stage of nesting, so most of the
                        ramp is inside that number — the curve only corrects for how far through
                        nesting this week&rsquo;s cohort sits. Expect it to move planned AHT by a
                        fraction of a second, not by the headline percentage.
                      </em>
                    </li>
                  </ol>
                </div>

                <div className="cap-forecast-info__grid">
                  <label className="saas-field">
                    <span className="saas-field__label">Nesting multiplier (override)</span>
                    <StableNumberInput
                      className="cap-field__input"
                      min={0.5}
                      max={2}
                      step={0.01}
                      disabled={nestingAhtStated || nestingSettingsInert}
                      placeholder={
                        nestingAhtStated && impliedMultiplier != null
                          ? fmtNum(impliedMultiplier, 3)
                          : fmtNum(historicalAnalysis.nestingMultiplier, 3)
                      }
                      value={nestingAhtStated ? '' : nestingMultiplierInput}
                      onChange={setNestingMultiplierInput}
                      aria-label="Nesting multiplier override"
                    />
                    {/*
                      The two describe one thing: nesting AHT is the production
                      baseline times this. Leaving both editable let them drift —
                      450s beside 1.28x on a 300s baseline is really 1.50x — so
                      whichever is stated drives, and the other shows what it
                      implies rather than a stale figure of its own.
                    */}
                    <span className="saas-field__hint">
                      {nestingSettingsInert
                        ? (nestingScheduledButSilent
                          ? 'Nesting agents in this plan have no phone time, so they take no contacts and this cannot change it.'
                          : 'No planned week has anyone in nesting, so this cannot change the plan.')
                        : nestingAhtStated
                        ? impliedMultiplier != null
                          ? `Not used — Nesting AHT is set, which is ${fmtNum(impliedMultiplier, 2)}× the production baseline. Clear that box to set a multiplier instead.`
                          : 'Not used while Nesting AHT is set.'
                        : `How much slower nesting handles than production. ${
                            impliedNestingAht != null
                              ? `Currently ${fmtNum(impliedNestingAht, 0)} sec.`
                              : ''
                          }`}
                    </span>
                  </label>
                  <label className="saas-field">
                    <span className="saas-field__label">Learning curve % / week (override)</span>
                    <StableNumberInput
                      className="cap-field__input"
                      min={0}
                      max={10}
                      step={0.1}
                      disabled={nestingSettingsInert || rampInEffect}
                      placeholder={fmtNum(historicalAnalysis.learningCurveWeeklyImprovementPct * 100, 2)}
                      value={learningCurveInput}
                      onChange={setLearningCurveInput}
                      aria-label="Learning curve percent per week override"
                    />
                    <span className="saas-field__hint">
                      {nestingSettingsInert
                        ? (nestingScheduledButSilent
                          ? 'Nesting agents in this plan have no phone time, so they take no contacts and this cannot change it.'
                          : 'No planned week has anyone in nesting, so this cannot change the plan.')
                        : rampInEffect
                          ? 'Not used while a ramp is set — the ramp models the same improvement, and both would count it twice.'
                          : 'How fast a nesting agent improves each week. Its effect is small; the nesting benchmark already averages over agents at every stage.'}
                    </span>
                  </label>
                  {/*
                    For accounts with no nesting history there is nothing to
                    measure, and a multiplier on a number never derived from this
                    programme is a guess wearing a decimal point. A planner who
                    knows what nesting handles can say so directly.
                  */}
                  <label className="saas-field">
                    <span className="saas-field__label">Nesting AHT, seconds (assumption)</span>
                    <StableNumberInput
                      className="cap-field__input"
                      min={0}
                      max={5000}
                      step={1}
                      disabled={nestingSettingsInert}
                      placeholder={
                        impliedNestingAht != null ? fmtNum(impliedNestingAht, 0) : 'e.g. 420'
                      }
                      value={nestingAhtInput}
                      onChange={setNestingAhtInput}
                      aria-label="Nesting AHT seconds assumption"
                    />
                    <span className="saas-field__hint">
                      {nestingSettingsInert
                        ? (nestingScheduledButSilent
                          ? 'Nesting agents in this plan have no phone time, so they take no contacts and this cannot change it.'
                          : 'No planned week has anyone in nesting, so this cannot change the plan.')
                        : nestingAhtStated
                          ? 'Driving the forecast. Clear it to go back to the multiplier or the measured benchmark.'
                          : 'What a nesting agent handles at. Leave blank to keep the figure on the left.'}
                    </span>
                  </label>
                  {/*
                    The ramp is the honest version of the learning curve: a real
                    trajectory from nesting handle time down to production, whose
                    average is what the cohort on the floor actually costs.
                  */}
                  <label className="saas-field">
                    <span className="saas-field__label">
                      Weeks to reach production AHT (assumption)
                    </span>
                    <StableNumberInput
                      className="cap-field__input"
                      min={1}
                      max={52}
                      step={1}
                      disabled={nestingSettingsInert}
                      placeholder={
                        scenario?.assumptions.newHire.nestingWeeks != null
                          ? fmtNum(scenario.assumptions.newHire.nestingWeeks, 0)
                          : 'e.g. 8'
                      }
                      value={nestingRampInput}
                      onChange={setNestingRampInput}
                      aria-label="Weeks for nesting AHT to reach production AHT"
                    />
                    <span className="saas-field__hint">
                      {nestingSettingsInert
                        ? (nestingScheduledButSilent
                          ? 'Nesting agents in this plan have no phone time, so they take no contacts and this cannot change it.'
                          : 'No planned week has anyone in nesting, so this cannot change the plan.')
                        : rampSummary ??
                        `How long a nesting agent takes to handle at production speed, improving in a straight line. Defaults to the plan's nesting period; set it longer if agents keep improving after they graduate.`}
                    </span>
                  </label>
                  <label className="saas-field">
                    <span className="saas-field__label">Nesting share of contacts % (assumption)</span>
                    <StableNumberInput
                      className="cap-field__input"
                      min={0}
                      max={100}
                      step={0.5}
                      disabled={nestingSettingsInert}
                      placeholder="from headcount"
                      value={nestingShareInput}
                      onChange={setNestingShareInput}
                      aria-label="Nesting contact share percent assumption"
                    />
                    <span className="saas-field__hint">
                      {nestingSettingsInert
                        ? (nestingScheduledButSilent
                          ? 'Nesting agents in this plan have no phone time, so they take no contacts and this cannot change it.'
                          : 'No planned week has anyone in nesting, so this cannot change the plan.')
                        : 'Set this only if the queue into nesting is throttled, so the cohort handles less than its headcount implies.'}
                    </span>
                  </label>
                </div>

                {/*
                  The resolved answer, from the same function the blend uses. It
                  is the only thing here that cannot drift from the model, and it
                  is what settles "which of my settings is actually doing this".
                */}
                <div className="cap-forecast-aht-effect">
                  <p className="saas-field__label m-0">In effect now</p>
                  {/*
                    Every nesting setting multiplies by the nesting headcount, so
                    a plan that schedules none is untouched by all of them. Said
                    once and up front, because otherwise the lines below read as
                    though they are doing something.
                  */}
                  {nestingScheduledButSilent ? (
                    <p className="cap-forecast-aht-effect__inert">
                      {plannedNestingWeeks} planned {plannedNestingWeeks === 1 ? 'week has' : 'weeks have'}{' '}
                      agents in nesting, but this plan gives them no phone time, so they take no
                      contacts — they cannot change handle time and the plan does not count them as
                      capacity either. Set a nesting phone time on the Capacity Plan if they handle
                      live calls.
                    </p>
                  ) : !plannedNestingWeeks ? (
                    <p className="cap-forecast-aht-effect__inert">
                      No planned week has anyone in nesting, so nothing below changes planned AHT on
                      this scenario. These settings start applying the moment the plan schedules
                      nesting headcount.
                    </p>
                  ) : null}
                  <ul>
                    <li>
                      <strong>Nesting handles at {fmtNum(effectiveNesting.seconds, 0)} sec</strong>
                      <span>
                        {effectiveNesting.rampWeeks != null
                          ? `averaged across a ramp of ${effectiveNesting.rampWeeks} weeks, from ${fmtNum(effectiveNesting.startSeconds ?? 0, 0)} sec down to production — the cohort on the floor is spread over it`
                          : effectiveNesting.source === 'stated'
                            ? 'from your assumption — the nesting multiplier is not being used'
                            : effectiveNesting.source === 'measured'
                              ? `measured from this plan's ${historicalAnalysis.weeksWithNesting} nesting weeks`
                              : `the production baseline times ${fmtNum(historicalAnalysis.nestingMultiplier, 2)}, because there are no nesting weeks to measure`}
                      </span>
                    </li>
                    <li>
                      <strong>
                        {historicalAnalysis.assumedNestingContactShare != null
                          ? `Nesting handles ${fmtPct(historicalAnalysis.assumedNestingContactShare)} of contacts`
                          : 'Nesting share of contacts is worked out weekly'}
                      </strong>
                      <span>
                        {historicalAnalysis.assumedNestingContactShare != null
                          ? `from your assumption — headcount is not being used for the share${
                              headcountImpliedShare != null
                                ? `. The heaviest nesting week in this plan would imply ${fmtPct(headcountImpliedShare)} from its headcount, so this assumption is doing real work — clear it to go back to headcount.`
                                : ''
                            }`
                          : 'from each week’s nesting and production headcount, and the two handle times'}
                      </span>
                    </li>
                    <li>
                      <strong>
                        Learning curve {fmtPct(historicalAnalysis.learningCurveWeeklyImprovementPct)} a
                        week
                      </strong>
                      <span>
                        {effectiveNesting.rampWeeks != null
                          ? 'Not used — the ramp above models the same improvement properly, so applying both would count it twice.'
                          : learningCurveEffect
                            ? `Trims ${fmtNum(learningCurveEffect.seconds, 2)} sec off the week of ${learningCurveEffect.week} — the nesting benchmark already reflects agents part-way through nesting, so this is a small correction, not a weekly compounding gain.`
                            : 'No planned week has anyone in nesting, so this changes nothing.'}
                      </span>
                    </li>
                  </ul>
                </div>
                <div className="cap-forecast-panel__actions">
                  <button type="button" className="saas-btn" onClick={saveAhtSettings} disabled={!scenario}>
                    Save Setup
                  </button>
                  <button type="button" className="saas-btn saas-btn--secondary" onClick={resetAhtSettings}>
                    Reset to data analysis
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          <section className="cap-forecast-panel saas-card">
            <div className="cap-forecast-panel__head">
              <div>
                <h3 className="m-0 text-sm font-bold text-slate-900">How planned AHT is calculated</h3>
              </div>
              <button
                type="button"
                className={`cap-forecast-panel__toggle${methodologyOpen ? ' is-active' : ''}`}
                onClick={() => setMethodologyOpen((prev) => !prev)}
              >
                {methodologyOpen ? 'Hide' : 'Show'}
              </button>
            </div>
            {methodologyOpen ? (
              <div className="cap-forecast-panel__body">
                <ol className="m-0 space-y-2 pl-5 text-sm text-slate-700">
                  <li>
                    <strong>The baseline.</strong> Production-only AHT is forecast by the model
                    chosen for the AHT driver, from history with any nesting inflation already taken
                    out. Everything below is layered on that.
                  </li>
                  <li>
                    <strong>What nesting handles at.</strong>{' '}
                    {effectiveNesting.rampWeeks != null
                      ? `A nesting agent starts at ${fmtNum(effectiveNesting.startSeconds ?? 0, 0)} sec and improves in a straight line to production over ${effectiveNesting.rampWeeks} weeks.`
                      : `Taken as ${fmtNum(effectiveNesting.seconds, 0)} sec, ${
                          effectiveNesting.source === 'stated'
                            ? 'which you stated.'
                            : effectiveNesting.source === 'measured'
                              ? `measured from ${historicalAnalysis.weeksWithNesting} nesting weeks in this plan.`
                              : `the production baseline times ${fmtNum(historicalAnalysis.nestingMultiplier, 2)}, since no nesting weeks exist to measure.`
                        }`}
                  </li>
                  <li>
                    <strong>Who is on the floor.</strong> Where the hiring plan supplies cohorts, each
                    week is weighted by how far through the ramp its nesting agents actually are — a
                    class that graduated last week costs more than one nearly finished. Without cohort
                    detail the ramp average is used instead, which assumes steady intake.
                  </li>
                  <li>
                    <strong>Combining the two.</strong> AHT averages over contacts, not over agents,
                    so the cohorts are weighted by the contacts each handles rather than by headcount.
                    A slower cohort gets through proportionally fewer, which makes its share of the
                    average smaller than its share of the floor:
                    <code className="cap-forecast-method__formula">
                      share = (Nn / AHTn) ÷ (Np / AHTp + Nn / AHTn)
                    </code>
                    <code className="cap-forecast-method__formula">
                      planned AHT = production × (1 − share) + nesting × share
                    </code>
                  </li>
                  <li>
                    <strong>Reading history back.</strong> Mix-adjusted AHT is that same calculation
                    run backwards: a measured week is divided by the factor its own nesting mix
                    implies, recovering what production alone was handling at. The two directions are
                    exact inverses, so a week put through both comes back unchanged.
                  </li>
                </ol>
              </div>
            ) : null}
          </section>

        </>
      ) : null}

      {/*
        The timeline covers every driver, so it belongs to the page rather than
        to the AHT section it used to be nested inside — where choosing "Driver
        models" hid the one table showing those drivers together.
      */}
      {!inWorkspace ? (
        <DriverTimelineTable
          rows={timelineRows}
          ahtMethod={ahtMethodLabel}
          serviceDrivers={serviceDrivenDrivers}
          sampleDrivers={sampleDrivenDrivers}
          analysisOnlyDrivers={analysisOnlyDrivers}
          attritionOverrideWeeks={attritionOverrideWeeks}
        />
      ) : null}

      {/*
        Only shown when there is something to save. The bar is sticky-positioned
        over the page, so leaving it up to announce that nothing needs doing cost
        a strip of every screen to say nothing.
      */}
      {forecastDirty ? (
        <div className="cap-revproj__save-bar" data-clean="false">
          <p className="cap-revproj__save-bar-copy">
            Save to keep this forecast on the Capacity Plan, or undo to restore the previous plan.
          </p>
          <div className="cap-capacity-sidebar__actions">
            <button type="button" className="saas-btn saas-btn--secondary" onClick={undoForecastSetup}>
              Undo
            </button>
            <button
              type="button"
              className="saas-btn saas-btn--primary"
              onClick={saveForecastSetup}
              disabled={!scenarioId}
              title="Save forecast setup to Capacity Plan"
            >
              Save Setup
            </button>
          </div>
        </div>
      ) : null}

      {navigationBlocked ? (
        <UnsavedChangesDialog
          title="Save or undo?"
          message="This forecast was applied to future weeks on the Capacity Plan. Save to keep it, or undo to restore the previous plan before leaving."
          saveLabel="Save Setup"
          discardLabel="Undo changes"
          onSave={() => {
            saveForecastSetup()
            proceedNavigation()
          }}
          onDiscard={() => {
            undoForecastSetup()
            proceedNavigation()
          }}
          onCancel={cancelNavigation}
        />
      ) : null}
    </div>
  )
}
