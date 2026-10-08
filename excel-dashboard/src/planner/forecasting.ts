import { runForecastModels, type ForecastModelResult } from '../utils/staffingCapacity/forecastModels'
import type { ScenarioDriverForecasts, StoredWfmModel } from './advancedForecastPersistence'
import { applyAdjustments } from './forecastAdjustments'
import { isCustomShrinkageCategoryId } from './shrinkageCategories'
import {
  SHRINKAGE_FORECAST_METRIC_IDS,
  type ScenarioForecastOverrides,
  type ForecastMetricId,
} from './forecastPersistence'
import type { WeeklyLedgerRow } from './weeklyLedger'
import {
  analyzeHistoricalAhtMix,
  ledgerHeadcount,
  productionEquivalentAhtSeconds,
  type HistoricalAhtAnalysis,
} from './capacityPlanDerived'

export type ForecastMetricUnit = 'number' | 'percent' | 'seconds'

/** No sample in-office drivers — only user-added custom categories appear. */
export const IN_OFFICE_SHRINKAGE_FORECAST_IDS: readonly ForecastMetricId[] = []

export const SHRINKAGE_BEST_MODEL_METRIC_IDS: ForecastMetricId[] = [
  'totalShrinkagePct',
  'ahtSeconds',
  ...SHRINKAGE_FORECAST_METRIC_IDS,
]

export function usesBestForecastModel(metricId: ForecastMetricId): boolean {
  return SHRINKAGE_BEST_MODEL_METRIC_IDS.includes(metricId) || isCustomShrinkageCategoryId(metricId)
}

export const FORECAST_DRIVER_METRIC_IDS: ForecastMetricId[] = [
  'callVolume',
  'attritionHc',
  'absenteeism',
]

export function buildForecastDriverGroups(
  customInOfficeMetricIds: ForecastMetricId[] = [],
): Array<{ id: string; title: string; metricIds: ForecastMetricId[] }> {
  const groups: Array<{ id: string; title: string; metricIds: ForecastMetricId[] }> = [
    { id: 'volume', title: 'Volume', metricIds: ['callVolume'] },
    { id: 'attrition', title: 'Attrition', metricIds: ['attritionHc'] },
    { id: 'absenteeism', title: 'Absenteeism', metricIds: ['absenteeism'] },
    /**
     * AHT sits last, against the AHT analytics that follow it on the page.
     *
     * It forecasts like any other driver, but it is the only one with a second
     * panel reading its result — the nesting mix, the benchmarks, the
     * assumptions. Placed among the others it left that panel stranded below
     * three unrelated drivers.
     */
    { id: 'aht', title: 'AHT', metricIds: ['ahtSeconds'] },
  ]
  if (customInOfficeMetricIds.length) {
    groups.push({ id: 'in_office', title: 'In office shrinkage', metricIds: customInOfficeMetricIds })
  }
  return groups
}

/** @deprecated Prefer buildForecastDriverGroups(customIds) so sample categories are not shown. */
export const FORECAST_DRIVER_GROUPS = buildForecastDriverGroups()

const METRIC_MODEL_PREFERENCE: Partial<Record<string, string>> = {
  callVolume: 'trend',
  attritionHc: 'ma',
  absenteeism: 'ses',
  ahtSeconds: 'holt',
  occupancy: 'ma',
  totalShrinkagePct: 'trend',
}

export function forecastMetricDisplayLabel(metricId: ForecastMetricId | string): string {
  switch (metricId) {
    case 'callVolume':
      return 'Volume'
    case 'attritionHc':
      return 'Attrition HC'
    case 'absenteeism':
      return 'Absenteeism'
    case 'ahtSeconds':
      return 'AHT'
    case 'occupancy':
      return 'Occupancy'
    case 'totalShrinkagePct':
      return 'Shrinkage'
    default:
      if (isCustomShrinkageCategoryId(metricId)) {
        return metricId.replace(/^custom_/, '').replace(/_/g, ' ')
      }
      return metricId
        .split('_')
        .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
        .join(' ')
  }
}

export type ForecastPoint = {
  weekIndex: number
  label: string
  value: number
  source: 'model' | 'override'
}

/** A model result plus the engine that produced it, so the UI can label provenance. */
export type ForecastModelEntry = ForecastModelResult & {
  engine: 'browser' | 'python'
  /** Weighted absolute percentage error — the headline accuracy figure. */
  wape?: number | null
  /** Mean signed error; positive means the forecast runs high. */
  bias?: number | null
  /** Planned weeks this model actually produced a value for. */
  weeksCovered?: number
  diagnostics?: Record<string, string>
  failed?: boolean
  error?: string | null
}

export type MetricForecastResult = {
  metricId: ForecastMetricId
  label: string
  unit: ForecastMetricUnit
  actualSeries: number[]
  /**
   * The same actuals, each still carrying the week it belongs to.
   *
   * `actualSeries` drops weeks with no value, so its positions no longer
   * correspond to the plan's history weeks. Anything that needs to know *when* a
   * value happened — a forecast fit, a holiday effect — must use this.
   */
  actualPoints: { date: string; value: number }[]
  modelResults: ForecastModelEntry[]
  selectedModel: ForecastModelEntry | null
  forecast: ForecastPoint[]
  /** True when the active model came from the Python forecasting service. */
  usesAdvancedModel: boolean
}

export type ScenarioForecastPackage = {
  horizonWeeks: number
  metrics: MetricForecastResult[]
}

type ForecastMetricDef = {
  metricId: ForecastMetricId
  label: string
  unit: ForecastMetricUnit
  pickActual: (row: WeeklyLedgerRow) => number | null
}

/**
 * Driver definitions, built per scenario because AHT can only be read correctly
 * against that plan's own nesting analysis.
 */
export type AhtMixHeadcountLookup = {
  nestingHc: number
  productionHc: number
  nestingPhoneTimePct: number
}

function coreForecastMetrics(
  ahtAnalysis: HistoricalAhtAnalysis,
  ahtMixByWeek?: Map<string, AhtMixHeadcountLookup>,
): ForecastMetricDef[] {
  return [
  {
    metricId: 'callVolume',
    label: 'Volume',
    unit: 'number',
    pickActual: (row) => row.actual?.callVolume ?? null,
  },
  {
    metricId: 'ahtSeconds',
    label: 'AHT',
    unit: 'seconds',
    /**
     * Production-equivalent AHT, not the raw recorded figure.
     *
     * Recorded AHT for a week with agents in nesting is a blend: nesting agents
     * handle calls more slowly, so the week reads high because of who was on the
     * floor rather than because the work changed. Planned AHT is then rebuilt by
     * `plannedAhtFromNestingMix`, which takes its input to be production-only
     * and adds the nesting premium back on top.
     *
     * Forecasting the raw blend therefore charged for nesting twice — once
     * inherited from history, once added by the mix. Dividing the mix out here
     * puts the forecast on the basis the planner already assumes, and on the
     * same basis as the production-equivalent figure the AHT panel displays.
     *
     * Weeks with no nesting pass through unchanged.
     */
    pickActual: (row) => {
      const raw = row.actual?.ahtSeconds
      if (raw == null || !Number.isFinite(raw)) return null
      const mix = ahtMixByWeek?.get(row.week)
      return productionEquivalentAhtSeconds(
        raw,
        mix?.nestingHc ?? ledgerHeadcount(row, 'nestingHc') ?? 0,
        mix?.productionHc ?? ledgerHeadcount(row, 'productionHc') ?? 0,
        ahtAnalysis,
        mix?.nestingPhoneTimePct ?? 1,
      )
    },
  },
  {
    metricId: 'occupancy',
    label: 'Occupancy',
    unit: 'percent',
    pickActual: (row) => row.actual?.occupancy ?? null,
  },
  {
    metricId: 'totalShrinkagePct',
    label: 'Shrinkage',
    unit: 'percent',
    pickActual: (row) =>
      row.shrinkage.reduce((sum, item) => sum + Math.max(0, item.actualPct ?? 0), 0),
  },
  {
    metricId: 'attritionHc',
    label: 'Attrition HC',
    unit: 'number',
    pickActual: (row) => row.actual?.attritionHc ?? null,
  },
  ...SHRINKAGE_FORECAST_METRIC_IDS.map((metricId) => ({
    metricId: metricId as ForecastMetricId,
    label: metricId === 'absenteeism' ? 'Absenteeism' : forecastMetricDisplayLabel(metricId),
    unit: 'percent' as const,
    pickActual: (row: WeeklyLedgerRow) => row.shrinkage.find((item) => item.id === metricId)?.actualPct ?? null,
  })),
  ]
}

function collectCustomInOfficeMetrics(rows: WeeklyLedgerRow[]): ForecastMetricDef[] {
  const byId = new Map<string, string>()
  for (const row of rows) {
    for (const item of row.shrinkage) {
      if (item.group !== 'in_office') continue
      if (!isCustomShrinkageCategoryId(item.id)) continue
      if (!byId.has(item.id)) byId.set(item.id, item.name)
    }
  }
  return [...byId.entries()].map(([id, name]) => ({
    metricId: id as ForecastMetricId,
    label: name,
    unit: 'percent' as const,
    pickActual: (row: WeeklyLedgerRow) => row.shrinkage.find((item) => item.id === id)?.actualPct ?? null,
  }))
}

/**
 * Historical actuals for one driver, each kept against its own week.
 *
 * Weeks with no value are dropped rather than zero-filled — a missing actual is
 * unknown, not zero, and zero would drag a fit down. Because they are dropped,
 * the surviving values must carry their dates: rebuilding them by counting
 * backwards from the end of history silently shifts every value onto a
 * neighbouring week as soon as one week is missing.
 */
function actualPointsOf(
  rows: WeeklyLedgerRow[],
  pick: (row: WeeklyLedgerRow) => number | null,
): { date: string; value: number }[] {
  return rows
    .filter((row) => row.timeline === 'historical_actual')
    .map((row) => ({ date: row.week, value: pick(row) }))
    .filter((point): point is { date: string; value: number } =>
      point.value != null && Number.isFinite(point.value),
    )
}

function bestModel(models: ForecastModelEntry[]): ForecastModelEntry | null {
  const valid = models.filter((model) => Number.isFinite(model.rmse) && !model.failed)
  if (!valid.length) return null
  return [...valid].sort((a, b) => a.rmse - b.rmse)[0] ?? null
}

function selectModelForMetric(metricId: ForecastMetricId, models: ForecastModelEntry[]): ForecastModelEntry | null {
  const preferredId = METRIC_MODEL_PREFERENCE[metricId]
  if (preferredId) {
    const preferred = models.find((model) => model.id === preferredId && Number.isFinite(model.rmse))
    if (preferred) return preferred
  }
  return bestModel(models)
}

function toEntry(model: ForecastModelResult): ForecastModelEntry {
  return { ...model, engine: 'browser' }
}

/**
 * Convert a stored service result into a model entry.
 *
 * The service forecasts at the source grain (usually daily) and returns a
 * `weekly` rollup keyed by plan week. Values are matched to the plan's weeks by
 * date rather than by position: a horizon that starts mid-week, or a plan whose
 * first forward week has moved on since the run, would otherwise silently shift
 * every week's number by one.
 *
 * Failed fits are kept rather than dropped, so the planner can see *why* a model
 * produced nothing rather than just noticing its absence.
 */
function wfmToEntry(
  model: StoredWfmModel,
  planWeeks: string[],
  driver?: { events?: import('./forecastAdjustments').ForecastEvent[]; overrides?: Record<string, number> },
): ForecastModelEntry {
  // Judgment is applied here rather than stored into the model, so the
  // model's own forecast stays intact and comparable underneath.
  const adjusted = applyAdjustments(model.weekly ?? [], driver?.events ?? [], driver?.overrides ?? {})
  const byWeek = new Map(adjusted.map((point) => [point.week, point.value]))
  const horizon = planWeeks.map((week) => byWeek.get(week) ?? NaN)
  const covered = horizon.filter((value) => Number.isFinite(value)).length

  const accuracy = model.accuracy ?? {}
  const failed = !model.success || covered === 0

  return {
    id: model.id,
    label: model.label,
    fitted: [],
    horizon,
    mae: typeof accuracy.mae === 'number' ? accuracy.mae : NaN,
    rmse: typeof accuracy.rmse === 'number' ? accuracy.rmse : NaN,
    mapePct: typeof accuracy.mape === 'number' ? accuracy.mape : NaN,
    wape: typeof accuracy.wape === 'number' ? accuracy.wape : null,
    bias: typeof accuracy.bias === 'number' ? accuracy.bias : null,
    weeksCovered: covered,
    diagnostics: Object.fromEntries(
      Object.entries(model.parameters ?? {}).map(([key, value]) => [key, String(value)]),
    ),
    failed,
    error:
      model.error ??
      (model.success && covered === 0
        ? 'Forecast horizon does not reach any planned week.'
        : null),
    engine: 'python',
  }
}

export function listCustomInOfficeForecastMetricIds(rows: WeeklyLedgerRow[]): ForecastMetricId[] {
  return collectCustomInOfficeMetrics(rows).map((metric) => metric.metricId)
}

export function buildScenarioForecast(
  rows: WeeklyLedgerRow[],
  overrides: ScenarioForecastOverrides | undefined,
  horizonWeeks = 12,
  advanced?: ScenarioDriverForecasts,
  ahtMixByWeek?: Map<string, AhtMixHeadcountLookup>,
): ScenarioForecastPackage {
  const futureRows = rows.filter((row) => row.timeline === 'forward_plan').slice(0, horizonWeeks)
  /** The plan weeks a service forecast has to line up with, by date. */
  const planWeeks = futureRows.map((row) => row.week)
  // Derived from this scenario's own history: the nesting premium it implies is
  // what AHT actuals have to be read against.
  const ahtAnalysis = analyzeHistoricalAhtMix(rows)
  const metrics = [...coreForecastMetrics(ahtAnalysis, ahtMixByWeek), ...collectCustomInOfficeMetrics(rows)]
  return {
    horizonWeeks,
    metrics: metrics.map((metric) => {
      const points = actualPointsOf(rows, metric.pickActual)
      const series = points.map((point) => point.value)
      const browserModels = runForecastModels(series, horizonWeeks).map(toEntry)

      const driver = advanced?.[metric.metricId]
      const serviceModels = (driver?.results ?? []).map((model) => wfmToEntry(model, planWeeks, driver))
      const models = [...serviceModels, ...browserModels]

      // Each driver decides for itself whether its forecast reaches the plan.
      // When it does not, the models stay visible for comparison but cannot be
      // selected, so the plan keeps using the browser-side models.
      const applyService = driver?.applyToCapacityPlan ?? false
      const selectable = applyService ? models : browserModels

      const pinned =
        applyService && driver?.selectedModelId
          ? selectable.find((model) => model.id === driver.selectedModelId && !model.failed)
          : undefined

      /**
       * The applied forecast, when one is applied and nothing was pinned.
       *
       * Without this, switching a driver on left the plan running its built-in
       * default anyway: METRIC_MODEL_PREFERENCE names a browser model per
       * driver, and that preference found its model in the widened list and won.
       * Applying a forecast and having the plan quietly ignore it is the worst
       * of the available behaviours, since the toggle reads as though it worked.
       *
       * The first entry is taken because the engine has already ranked them by
       * WAPE — the same order, and the same model, the workspace shows as
       * Selected.
       */
      const appliedDefault = applyService
        ? serviceModels.find((model) => !model.failed)
        : undefined

      const selected =
        pinned ??
        appliedDefault ??
        (usesBestForecastModel(metric.metricId)
          ? bestModel(selectable)
          : selectModelForMetric(metric.metricId, selectable))

      const perMetricOverrides = overrides?.[metric.metricId] ?? {}
      /**
       * Carry the last known value into weeks the model does not reach.
       *
       * A model's horizon is often shorter than the plan. Falling back to the
       * last *actual* fails when a driver has no history at all — the fallback
       * became 0, so the plan read a collapse to zero in every week past the
       * horizon. Holding the last forecast value is the honest continuation.
       */
      // Seeded from history where there is any, otherwise from the first week
      // the model does reach — a leading gap (the horizon starting after the
      // plan's first week) would otherwise read as zero.
      const firstModelled = selected?.horizon.find((value) => Number.isFinite(value))
      let lastKnown: number | null =
        (series.length ? series[series.length - 1]! : null) ??
        (Number.isFinite(firstModelled) ? (firstModelled as number) : null)
      const forecast = futureRows.map((row, index) => {
        const override = perMetricOverrides[index]
        const raw = selected?.horizon[index]
        if (Number.isFinite(raw)) lastKnown = raw as number
        const modelValue = Number.isFinite(raw) ? (raw as number) : (lastKnown ?? 0)
        return {
          weekIndex: index,
          label: row.week,
          value: override ?? modelValue,
          source: override != null ? ('override' as const) : ('model' as const),
        }
      })
      return {
        metricId: metric.metricId,
        label: metric.label,
        unit: metric.unit,
        actualSeries: series,
        actualPoints: points,
        modelResults: models,
        selectedModel: selected,
        forecast,
        usesAdvancedModel: selected?.engine === 'python',
      }
    }),
  }
}
