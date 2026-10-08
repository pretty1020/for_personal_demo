import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  runWfmForecast,
} from '../../data/forecastApiClient'
import {
  HORIZON_OPTIONS,
  TEST_SPLITS,
  WFM_MODEL_BLURBS,
  WFM_MODEL_IDS,
  WFM_MODEL_LABELS,
  clearDriverResults,
  getDriverForecast,
  driverSignature,
  isDriverResultStale,
  patchDriverForecast,
  resolveSourceGrain,
  setDriverModelSelection,
  bestDriverModel,
  type DriverForecastConfig,
  type SeriesInterval,
  type TestSplit,
  type WfmModelId,
} from '../../planner/advancedForecastPersistence'
import {
  parseHistoricalUpload,
  UploadParseError,
  type DatedPoint,
  type ForecastDataSource,
  type ParsedUpload,
} from '../../planner/forecastDataSource'
import { forecastMetricDisplayLabel, type MetricForecastResult } from '../../planner/forecasting'
import { generateSampleSeries, sampleWeeksForPlan } from '../../planner/sampleDriverData'
import type { ForecastMetricId } from '../../planner/forecastPersistence'
import { fmtNum } from '../../planner/format'
import { describeBias, describePattern } from '../../planner/forecastAccuracy'
import {
  buildUploadTemplate,
  describeUploadTemplate,
} from '../../planner/forecastUploadTemplate'
import { applyAdjustments, describeAdjustments } from '../../planner/forecastAdjustments'
import { getSnapshots, recordSnapshot, scoreSnapshots } from '../../planner/forecastLog'
import { CollapsibleMultiSelect, type MultiSelectOption } from './CollapsibleMultiSelect'
import { ForecastAdjustments } from './ForecastAdjustments'
import { SeriesProfilePanel } from './SeriesProfilePanel'
import { useDemoSession } from '../../context/DemoSessionContext'
import { listHolidayCountries, type HolidayCountry } from '../../planner/browserHolidays'
import { ForecastChartsPanel } from './ForecastChartsPanel'

const DAY_MS = 86_400_000

/**
 * Weeks the engine must forecast to reach the end of the target plan weeks.
 *
 * The horizon is counted in weeks whatever the source grain and whatever grain
 * is being fitted, because the plan it has to reach is measured in weeks. A
 * daily fit still covers the same span — it returns seven points per week
 * rather than one. Counting a daily file in days here would ask for seven times
 * the plan's length.
 */
export function horizonStepsFor(series: DatedPoint[], targetWeeks: string[]): number {
  if (!targetWeeks.length) return 1
  const lastTarget = new Date(`${targetWeeks[targetWeeks.length - 1]!}T12:00:00`).getTime()
  if (!series.length) return targetWeeks.length

  // Measure from the week containing the last observation, not from its date:
  // a series ending mid-week is still inside that week, and counting from the
  // date itself would ask for one week more than the plan needs.
  const lastPoint = new Date(`${series[series.length - 1]!.date}T12:00:00`)
  lastPoint.setDate(lastPoint.getDate() - lastPoint.getDay())
  const weeks = Math.round((lastTarget - lastPoint.getTime()) / (7 * DAY_MS))
  return Math.max(1, weeks)
}

/** Whole weeks between the end of the history and the first plan week. */
export function gapWeeks(series: DatedPoint[], targetWeeks: string[]): number {
  if (!series.length || !targetWeeks.length) return 0
  const lastHistory = new Date(`${series[series.length - 1]!.date}T12:00:00`).getTime()
  const firstTarget = new Date(`${targetWeeks[0]!}T12:00:00`).getTime()
  return Math.max(0, Math.floor((firstTarget - lastHistory) / (7 * DAY_MS)))
}

type Props = {
  scenarioId: string
  weekStart: 'sunday' | 'monday'
  metric: MetricForecastResult
  /** Real week-start dates behind the metric's historical actuals. */
  historyWeeks: string[]
  futureWeeks: string[]
  onClose: () => void
  onResultsSaved: () => void
}

/**
 * Why the shape metrics are blank, rather than leaving a bare dash that reads as
 * a missing feature. They are withheld on purpose when too few weeks were scored
 * for a correlation to mean anything.
 */
function patternUnavailableReason(testSamples: number | undefined): string {
  if (testSamples == null) return 'Not scored yet.'
  return `Needs at least 8 scored weeks to be meaningful; this run scored ${testSamples}. Lengthen the history or widen the test split.`
}

export function DriverForecastWorkspace({
  scenarioId,
  weekStart,
  metric,
  historyWeeks,
  futureWeeks,
  onClose,
  onResultsSaved,
}: Props) {
  const metricId = metric.metricId as ForecastMetricId
  const label = forecastMetricDisplayLabel(metricId)

  const [config, setConfig] = useState<DriverForecastConfig>(() =>
    getDriverForecast(scenarioId, metricId),
  )
  const [upload, setUpload] = useState<ParsedUpload | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const { user, canUseAssistant } = useDemoSession()
  const [running, setRunning] = useState(false)
  /** Bumped when a snapshot is recorded, so the track record re-reads storage. */
  const [logVersion, setLogVersion] = useState(0)
  const [runError, setRunError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setConfig(getDriverForecast(scenarioId, metricId))
    setUpload(null)
    setUploadError(null)
    setRunError(null)
  }, [metricId, scenarioId])

  const persist = useCallback(
    (patch: Partial<DriverForecastConfig>) => {
      patchDriverForecast(scenarioId, metricId, patch)
      setConfig((current) => ({ ...current, ...patch }))
      onResultsSaved()
    },
    [metricId, onResultsSaved, scenarioId],
  )

  const usingUpload = config.dataSource === 'upload'
  const usingSample = config.dataSource === 'sample'

  /**
   * History from the plan's own actuals, each on the week it was recorded.
   *
   * Taken already dated rather than rebuilt by counting back from the end of
   * history. Weeks with no actual are dropped upstream, so a driver missing even
   * one week would otherwise have every remaining value shifted onto a
   * neighbouring week — dating a Christmas peak to the week before it, and
   * quietly moving the whole series against the holiday calendar.
   */
  const ledgerSeries = useMemo<DatedPoint[]>(
    () => metric.actualPoints.filter((point) => Number.isFinite(point.value)),
    [metric.actualPoints],
  )

  /**
   * The template offered for this driver, built from the plan it will be
   * uploaded back into: its week dates, its actuals, its units.
   */
  const templateInfo = useMemo(
    () =>
      buildUploadTemplate({
        label,
        unit: metric.unit,
        weeks: historyWeeks,
        valuesByWeek: new Map(metric.actualPoints.map((point) => [point.date, point.value])),
        weekStart,
      }),
    [historyWeeks, label, metric.actualPoints, metric.unit, weekStart],
  )

  /**
   * The daily variant, offered beside the weekly one.
   *
   * Daily forecasting is only unlocked by daily history, and the only template
   * on offer produced weekly rows — so the guidance asked for a file per day
   * while the file we handed over had one per week. Same plan span, one row per
   * day, values left empty.
   */
  const dailyTemplateInfo = useMemo(
    () =>
      buildUploadTemplate({
        label,
        unit: metric.unit,
        weeks: historyWeeks,
        weekStart,
        grain: 'daily',
      }),
    [historyWeeks, label, metric.unit, weekStart],
  )

  /**
   * Handed over as a download rather than written anywhere: the file is built
   * for one plan at one moment, and belongs to whoever asked for it.
   */
  const downloadTemplate = (template: { csv: string; filename: string } = templateInfo) => {
    const blob = new Blob([template.csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = template.filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    // Released on the next tick so the click has taken the data.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  /**
   * Whether the source data can support a daily fit at all.
   *
   * Plan actuals are weekly by construction, and a weekly upload has no days in
   * it to model — offering daily there would promise a shape the data cannot
   * carry.
   */
  const sourceGrain: SeriesInterval = resolveSourceGrain(
    usingSample ? 'sample' : usingUpload ? 'upload' : 'capacity_plan',
    {
      uploadInterval: upload?.interval ?? config.uploadMeta?.interval,
      sampleGrain: config.sampleMeta?.grain,
    },
  )
  /**
   * Only claim daily where the data says so.
   *
   * A real upload always carries its detected interval, so the fallback here
   * only fires for a source that has lost its metadata — a stale or failed
   * upload. Reading that as daily was the wrong direction: it offered a daily
   * fit on a driver holding no daily data, or in the case seen, no data at all.
   * Unknown resolves to weekly, which is the plan's own grain and promises
   * nothing the numbers cannot carry.
   */
  const canForecastDaily = sourceGrain === 'daily'
  const forecastGrain: 'weekly' | 'daily' =
    canForecastDaily && config.forecastGrain === 'daily' ? 'daily' : 'weekly'

  const uploadedSeries = upload?.points ?? config.uploadedSeries ?? []
  const series = usingUpload || usingSample ? uploadedSeries : ledgerSeries
  // The same value the grain control reads. Resolving it twice is how the
  // control and the engine came to disagree before.
  const grain = sourceGrain

  const targetWeeks = useMemo(
    () => futureWeeks.slice(0, config.horizonWeeks),
    [config.horizonWeeks, futureWeeks],
  )

  /**
   * Sample span, taken from this plan rather than fixed: it mirrors the plan's
   * own historical range, stretched where that is too short for the models and
   * the chosen horizon to have anything to work with.
   */
  const sampleWeeks = useMemo(
    () =>
      sampleWeeksForPlan({
        planHistoryWeeks: historyWeeks.length,
        horizonWeeks: config.horizonWeeks,
      }),
    [config.horizonWeeks, historyWeeks.length],
  )

  const historyGapWeeks = useMemo(() => gapWeeks(series, targetWeeks), [series, targetWeeks])
  const stale = isDriverResultStale(config)

  /** Catch a file mapped onto a driver it cannot be. */
  const scaleWarning = useMemo(() => {
    if (!usingUpload || !uploadedSeries.length) return null
    const mean = uploadedSeries.reduce((sum, point) => sum + point.value, 0) / uploadedSeries.length
    if (metric.unit === 'percent' && (mean < 0 || mean > 1)) {
      return `${label} is a percentage (0–1), but the uploaded values average ${mean.toFixed(1)}. Check the file, or divide it by 100.`
    }
    if (ledgerSeries.length >= 3) {
      const planMean =
        ledgerSeries.reduce((sum, point) => sum + point.value, 0) / ledgerSeries.length
      if (planMean > 0 && (mean > planMean * 20 || mean * 20 < planMean)) {
        return `The file averages ${mean.toLocaleString(undefined, { maximumFractionDigits: 1 })}, against ${planMean.toLocaleString(undefined, { maximumFractionDigits: 1 })} in this plan's own ${label} history. If it is a different grain or unit, the forecast will not fit the plan.`
      }
    }
    return null
  }, [label, ledgerSeries, metric.unit, uploadedSeries, usingUpload])

  /** The only model that consumes holidays; no point loading them otherwise. */
  const usesHolidays = config.models.includes('fourier-holidays')
  const [countries, setCountries] = useState<HolidayCountry[]>([])

  useEffect(() => {
    if (!usesHolidays || countries.length) return
    let cancelled = false
    // The calendar package is ~10MB, so it is fetched on demand rather than
    // bundled; a failure here just means no holiday options, not a broken page.
    void listHolidayCountries()
      .then((list) => {
        if (!cancelled) setCountries(list)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [countries.length, usesHolidays])

  const countryOptions = useMemo<MultiSelectOption[]>(
    () =>
      countries.map((country) => ({
        value: country.code,
        label: country.name,
        hint: country.code,
        group: country.featured ? 'Common delivery & client sites' : 'All countries',
      })),
    [countries],
  )

  const modelOptions = useMemo<MultiSelectOption[]>(
    () =>
      WFM_MODEL_IDS.map((modelId) => ({
        value: modelId,
        label: WFM_MODEL_LABELS[modelId],
        description: WFM_MODEL_BLURBS[modelId],
      })),
    [],
  )

  const enoughData = series.length >= 10
  const canRun = !running && config.models.length > 0 && enoughData

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    setUploadError(null)
    try {
      const parsed = await parseHistoricalUpload(file)
      setUpload(parsed)
      persist({
        // The previous run described the previous file.
        results: undefined,
        anomalies: undefined,
        uploadedSeries: parsed.points,
        uploadMeta: {
          fileName: file.name,
          rows: parsed.points.length,
          dateColumn: parsed.dateColumn,
          valueColumn: parsed.valueColumn,
          interval: parsed.interval,
          skipped: parsed.skipped,
          uploadedAt: new Date().toISOString(),
        },
      })
    } catch (error) {
      setUpload(null)
      setUploadError(error instanceof UploadParseError ? error.message : (error as Error).message)
    }
  }

  /**
   * Generate placeholder history so the models can be exercised before real
   * actuals exist. The series ends flush against the plan's first forward week,
   * so the forecast lands on plan weeks instead of extrapolating across a gap.
   */
  const generateSample = () => {
    const planStart = futureWeeks[0]
    if (!planStart) return
    const { points, grain: sampleGrain, profile } = generateSampleSeries({
      metricId,
      planStart,
      weeks: sampleWeeks,
    })
    patchDriverForecast(scenarioId, metricId, {
      dataSource: 'sample',
      uploadedSeries: points,
      uploadMeta: undefined,
      // Regenerating counts as new data, so the previous run no longer applies.
      results: undefined,
      anomalies: undefined,
      sampleMeta: {
        generatedAt: new Date().toISOString(),
        points: points.length,
        grain: sampleGrain,
        profile,
        weeks: sampleWeeks,
      },
    })
    setUpload(null)
    setConfig(getDriverForecast(scenarioId, metricId))
    onResultsSaved()
  }

  const handleRun = async () => {
    if (!series.length) return
    setRunning(true)
    setRunError(null)
    try {
      const response = await runWfmForecast({
        data: series,
        // Days when fitting daily, plan weeks otherwise: the horizon is counted
        // in whatever the model is stepping through.
        horizon:
          forecastGrain === 'daily'
            ? Math.max(1, config.horizonWeeks * 7)
            : horizonStepsFor(series, targetWeeks),
        grain: forecastGrain,
        models: config.models,
        testSplit: config.testSplit,
        countries: config.countries,
        weekStart,
        targetWeeks,
        metricId,
        metricUnit: metric.unit,
      })

      patchDriverForecast(scenarioId, metricId, {
        results: response.models,
        interval: response.interval,
        planWeeks: targetWeeks,
        warnings: response.warnings,
        lastRunAt: new Date().toISOString(),
        resultsSignature: driverSignature(getDriverForecast(scenarioId, metricId)),
      })
      setConfig(getDriverForecast(scenarioId, metricId))
      onResultsSaved()
    } catch (error) {
      setRunError((error as Error).message)
    } finally {
      setRunning(false)
    }
  }

  const lastRun = config.lastRunAt ? new Date(config.lastRunAt) : null
  /**
   * How past forecasts actually turned out.
   *
   * Backtest scores say how a model would have done on refitted history. This
   * says how the forecast the plan was built on actually did — the question a
   * client asks, and the only one that includes the model chosen and the
   * judgment applied.
   */
  const trackRecord = useMemo(() => {
    const actuals = new Map(ledgerSeries.map((point) => [point.date, point.value]))
    return scoreSnapshots(getSnapshots(scenarioId, metricId), actuals).filter(
      (entry) => entry.matured > 0,
    )
  }, [ledgerSeries, logVersion, metricId, scenarioId])

  const results = config.results ?? []
  const usable = results.filter((model) => model.success)
  /** Best WAPE among models that fitted, for the "nothing works here" guard. */
  const bestUsableWape = usable
    .map((model) => model.accuracy?.wape)
    .filter((wape): wape is number => wape != null && Number.isFinite(wape))
    .sort((a, b) => a - b)[0]
  const meta = upload
    ? {
        fileName: fileInput.current?.files?.[0]?.name ?? config.uploadMeta?.fileName ?? 'file',
        rows: upload.points.length,
        interval: upload.interval,
        skipped: upload.skipped,
        dateColumn: upload.dateColumn,
        valueColumn: upload.valueColumn,
      }
    : config.uploadMeta

  return (
    <section className="cap-driver-forecast saas-card">
      <header className="cap-driver-forecast__head">
        <div>
          <div className="cap-driver-forecast__nav">
            <button type="button" className="cap-driver-forecast__back" onClick={onClose}>
              ← All drivers
            </button>
            <button type="button" className="cap-driver-forecast__back-btn" onClick={onClose}>
              Back
            </button>
          </div>
          <h3 className="m-0 text-base font-bold text-slate-900">Forecast · {label}</h3>
          {/*
            One sentence describing the data actually loaded right now.

            It used to end with `config.interval`, which is the grain of the last
            forecast run rather than of the current source, so a driver switched
            to an empty upload read "0 weekly points from an uploaded file ·
            daily" — contradicting itself in six words. And an upload with no file
            behind it announced its zero rows as though they were data.
          */}
          <p className="saas-muted m-0 text-xs">
            {usingSample
              ? `${series.length} ${grain} points of generated sample data`
              : usingUpload
                ? series.length
                  ? `${series.length} ${grain} points from an uploaded file${
                      grain === 'daily' && forecastGrain === 'weekly' ? ', aggregated to weeks' : ''
                    }`
                  : 'No file loaded yet — choose one below, or switch to Capacity Plan actuals'
                : `${series.length} weeks of Capacity Plan actuals`}
          </p>
        </div>
      </header>

      {/* ── 1. data ─────────────────────────────────────────────────────── */}
      <div className="cap-forecast-advanced__step">
        <h4 className="cap-forecast-advanced__step-title">1 · Historical data for {label}</h4>
        <div className="cap-forecast-advanced__tabs" role="tablist" aria-label="Historical data source">
          {(
            [
              ['capacity_plan', 'Use Capacity Plan actuals'],
              ['upload', 'Upload data'],
              ['sample', 'Sample data'],
            ] as const
          ).map(([id, tabLabel]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={config.dataSource === id}
              disabled={running}
              className={`cap-forecast-advanced__tab${config.dataSource === id ? ' cap-forecast-advanced__tab--active' : ''}`}
              onClick={() => {
                if (id === config.dataSource) return
                // Results from the other source describe a different series.
                persist({ dataSource: id as ForecastDataSource, results: undefined, anomalies: undefined })
              }}
            >
              {tabLabel}
            </button>
          ))}
        </div>

        {usingSample ? (
          <div className="cap-forecast-advanced__upload">
            <p className="cap-forecast-sample__banner">
              Sample data is generated, not real. Do not plan staffing from a forecast fitted on it.
            </p>
            <button
              type="button"
              className="saas-btn saas-btn--ghost"
              disabled={running || !futureWeeks.length}
              onClick={generateSample}
            >
              {config.sampleMeta ? 'Regenerate sample data' : `Generate sample ${label} data`}
            </button>
            {config.sampleMeta ? (
              <div className="cap-forecast-advanced__upload-meta">
                <strong>
                  {config.sampleMeta.points} {config.sampleMeta.grain} points ·{' '}
                  {config.sampleMeta.weeks} weeks
                </strong>
                <span>
                  {series[0]?.date} → {series[series.length - 1]?.date} ·{' '}
                  {config.sampleMeta.profile}
                </span>
              </div>
            ) : (
              <p className="saas-field__hint">
                {sampleWeeks} weeks of sample {label.toLowerCase()} through {futureWeeks[0] ?? '—'}.
              </p>
            )}
          </div>
        ) : usingUpload ? (
          <div className="cap-forecast-advanced__upload">
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.xlsx,.xls,.tsv"
              disabled={running}
              onChange={(event) => void handleFile(event.target.files?.[0])}
            />
            <p className="saas-field__hint">
              CSV or Excel with a date column and a {label.toLowerCase()} column. Daily files are
              welcome: by default they are aggregated into plan weeks before fitting, and they also
              unlock the daily forecast option below, which stays on this page because the Capacity
              Plan is weekly.
            </p>

            {/*
              A file that already parses beats a description of one. It carries
              this plan's own week dates and whatever actuals exist, so the
              expected format and magnitude are visible rather than explained —
              which is what stops a rate arriving as 5 instead of 0.05.
            */}
            {/*
              Two templates, each with its own description under its own button.
              Laid out side by side because the choice between them is the point:
              a single row of buttons above a single block of text left the
              weekly line ("one row per week") sitting beside the daily button,
              describing the wrong file.
            */}
            <div className="cap-forecast-advanced__template">
              <div className="cap-forecast-advanced__template-option">
                <button
                  type="button"
                  className="saas-btn saas-btn--ghost"
                  disabled={running}
                  onClick={() => downloadTemplate(templateInfo)}
                >
                  Download weekly template
                </button>
                <span className="cap-forecast-advanced__template-tag">
                  {templateInfo.rows} weekly rows · can drive the Capacity Plan
                </span>
                <span className="cap-forecast-advanced__template-note">
                  {describeUploadTemplate(metric.unit, 'weekly')}{' '}
                  {templateInfo.prefilled
                    ? `${templateInfo.prefilled} of ${templateInfo.rows} weeks are already filled in from this plan.`
                    : 'Ready to fill in.'}
                </span>
              </div>

              <div className="cap-forecast-advanced__template-option">
                <button
                  type="button"
                  className="saas-btn saas-btn--ghost"
                  disabled={running}
                  onClick={() => downloadTemplate(dailyTemplateInfo)}
                >
                  Download daily template
                </button>
                <span className="cap-forecast-advanced__template-tag">
                  {dailyTemplateInfo.rows} daily rows · same {templateInfo.rows} weeks · unlocks a
                  daily forecast
                </span>
                <span className="cap-forecast-advanced__template-note">
                  {describeUploadTemplate(metric.unit, 'daily')} Values are left empty on purpose:
                  this plan holds one figure per week, and splitting it across days would invent a
                  flat week with no day-of-week shape in it.
                </span>
              </div>
            </div>
            {uploadError ? (
              <p className="cap-forecast-advanced__alert cap-forecast-advanced__alert--error">
                {uploadError}
              </p>
            ) : null}
            {meta ? (
              <div className="cap-forecast-advanced__upload-meta">
                <strong>{meta.fileName}</strong>
                <span>
                  {meta.rows} rows · {series[0]?.date} → {series[series.length - 1]?.date} ·{' '}
                  {meta.interval} grain · columns <code>{meta.dateColumn}</code> /{' '}
                  <code>{meta.valueColumn}</code>
                  {meta.skipped ? ` · ${meta.skipped} unreadable rows skipped` : ''}
                </span>
              </div>
            ) : null}
          </div>
        ) : (
          <>
            <p className="saas-muted m-0 text-sm">
              {ledgerSeries.length >= 10
                ? `Using ${ledgerSeries.length} weeks of ${label} actuals from this scenario's Capacity Plan.`
                : `This plan has only ${ledgerSeries.length} weeks of ${label} actuals — at least 10 are needed. Import more history on the Capacity Plan, or upload a file.`}
            </p>
            {/*
              AHT is the one driver whose history is not the recorded figure.
              Nesting inflation is divided out here and added back when the plan
              is built, so these weeks read lower than the AHT on the driver
              timeline. Said plainly, or the two look like a discrepancy.
            */}
            {metric.metricId === 'ahtSeconds' && ledgerSeries.length ? (
              <p className="saas-field__hint m-0">
                Production-equivalent AHT: time in nesting is divided out here and added back as
                nesting mix when the plan is built. Weeks with nesting therefore read lower than
                the recorded AHT on the driver timeline.
              </p>
            ) : null}
          </>
        )}
      </div>

      {/* ── 2. models ───────────────────────────────────────────────────── */}
      <div className="cap-forecast-advanced__step">
        <h4 className="cap-forecast-advanced__step-title">2 · Models for {label}</h4>
        <div className="cap-forecast-advanced__grid">
          <div className="cap-forecast-advanced__column">
            <label className="saas-field">
              <span className="saas-field__label">Models to fit</span>
              <CollapsibleMultiSelect
                options={modelOptions}
                selected={config.models}
                disabled={running}
                searchable={false}
                placeholder="No models selected"
                summaryNoun="models selected"
                onChange={(values) => persist({ models: values as WfmModelId[] })}
              />
              <span className="saas-field__hint">
                Each model is scored on the same held-back weeks.
              </span>
            </label>

          </div>

          <div className="cap-forecast-advanced__column">
            <label className="saas-field">
              <span className="saas-field__label">Forecast horizon</span>
              <select
                className="cap-field__input"
                value={config.horizonWeeks}
                disabled={running}
                onChange={(event) => persist({ horizonWeeks: Number(event.target.value) })}
              >
                {HORIZON_OPTIONS.filter((weeks) => weeks <= Math.max(4, futureWeeks.length)).map(
                  (weeks) => (
                    <option key={weeks} value={weeks}>
                      {weeks} weeks
                    </option>
                  ),
                )}
              </select>
              <span className="saas-field__hint">
                Plan weeks to forecast. This plan runs {futureWeeks.length} weeks forward.
              </span>
            </label>

            {usesHolidays ? (
              <label className="saas-field">
                <span className="saas-field__label">Holiday calendars</span>
                <CollapsibleMultiSelect
                  options={countryOptions}
                  selected={config.countries}
                  disabled={running || !countryOptions.length}
                  placeholder={countryOptions.length ? "No holiday calendars" : "Loading calendars…"}
                  summaryNoun="calendars selected"
                  searchPlaceholder={`Search ${countryOptions.length} countries…`}
                  onChange={(codes) =>
                    // Different holidays mean a different fit.
                    persist({ countries: codes, results: undefined })
                  }
                />
                <span className="saas-field__hint">
                  Used by Trend + Seasonality + Holidays, which learns an effect for each named
                  holiday it has seen at least twice.
                </span>
                {/*
                  Selecting the model but no calendar leaves it fitting trend and
                  seasonality with no holiday term at all, under a name that says
                  it has one. Said plainly rather than left to be discovered.
                */}
                {!config.countries.length ? (
                  <span className="saas-field__hint cap-forecast-hint--warn">
                    No calendar selected, so this model is fitting trend and seasonality only.
                    Pick the country your volume follows to let it learn holiday effects.
                  </span>
                ) : null}
              </label>
            ) : null}

            {/*
              Always shown, with daily disabled where the data cannot support
              it. Hiding the choice entirely meant nobody could discover that
              uploading daily data buys them anything — the capability existed
              and was invisible to everyone who had not already found it.
            */}
            <label className="saas-field">
                <span className="saas-field__label">Forecast grain</span>
                <select
                  className="cap-field__input"
                  value={forecastGrain}
                  disabled={running || !canForecastDaily}
                  onChange={(event) =>
                    persist({
                      forecastGrain: event.target.value as 'weekly' | 'daily',
                      results: undefined,
                      // A daily forecast has nothing the plan can take, so it
                      // cannot stay switched on across the change.
                      ...(event.target.value === 'daily' ? { applyToCapacityPlan: false } : {}),
                    })
                  }
                >
                  <option value="weekly">Weekly — can drive the Capacity Plan</option>
                  <option value="daily" disabled={!canForecastDaily}>
                    Daily — analysis only
                  </option>
                </select>
                <span className="saas-field__hint">
                  {!canForecastDaily
                    ? `Daily needs daily data. This driver is reading ${
                        usingUpload ? 'a weekly file' : usingSample ? 'weekly sample data' : 'plan actuals, which are weekly'
                      } — upload a file with one row per day to forecast the shape inside the week.`
                    : forecastGrain === 'daily'
                      ? 'Fitting each day, with a weekly rather than an annual cycle. The Capacity Plan is weekly, so a daily forecast stays on this page.'
                      : 'Rolled into plan weeks before fitting, which is the grain the Capacity Plan reads.'}
                </span>
              </label>

            <label className="saas-field">
              <span className="saas-field__label">Train / test split</span>
              <select
                className="cap-field__input"
                value={config.testSplit}
                disabled={running}
                onChange={(event) => persist({ testSplit: event.target.value as TestSplit })}
              >
                {TEST_SPLITS.map((split) => (
                  <option key={split} value={split}>
                    {split} — train {split.split('/')[0]}%, test {split.split('/')[1]}%
                  </option>
                ))}
              </select>
              <span className="saas-field__hint">Held-back weeks are used to score accuracy.</span>
            </label>
          </div>
        </div>
      </div>

      {/* ── 3. apply ────────────────────────────────────────────────────── */}
      <div className="cap-forecast-advanced__step">
        <h4 className="cap-forecast-advanced__step-title">3 · Apply {label} to the Capacity Plan</h4>
        <label className="cap-forecast-advanced__check cap-forecast-advanced__check--prominent">
          <input
            type="checkbox"
            checked={config.applyToCapacityPlan && forecastGrain !== 'daily'}
            disabled={running || forecastGrain === 'daily'}
            onChange={() => {
              const next = !config.applyToCapacityPlan
              const patch: Partial<DriverForecastConfig> = { applyToCapacityPlan: next }
              const chosen = usable.find((m) => m.id === config.selectedModelId) ?? usable[0]
              if (next && !config.selectedModelId && chosen) patch.selectedModelId = chosen.id
              persist(patch)

              // Applying is the moment a forecast becomes a commitment, so that
              // is what gets recorded — the numbers the plan will actually use,
              // judgment included.
              if (next && chosen) {
                const applied = applyAdjustments(
                  chosen.weekly ?? [],
                  config.events ?? [],
                  config.overrides ?? {},
                  metric.unit,
                )
                recordSnapshot({
                  takenAt: new Date().toISOString(),
                  scenarioId,
                  metricId,
                  modelId: chosen.id,
                  modelLabel: chosen.label,
                  adjusted: Boolean(config.events?.length || Object.keys(config.overrides ?? {}).length),
                  values: Object.fromEntries(applied.map((point) => [point.week, point.value])),
                })
                setLogVersion((v) => v + 1)
              }
            }}
          />
          <span>
            <strong>
              {forecastGrain === 'daily'
                ? `Daily forecast — ${label} in the plan is untouched`
                : config.applyToCapacityPlan
                  ? `${label} forecast drives the Capacity Plan`
                  : `Analysis only — ${label} in the plan is untouched`}
            </strong>
            <em>
              {forecastGrain === 'daily'
                ? 'The Capacity Plan is a weekly ledger and has no row for a Tuesday, so a daily forecast cannot be written into it. Switch the grain back to weekly to apply one.'
                : config.applyToCapacityPlan
                  ? 'The selected model fills future weeks in the driver table and this Capacity Plan. Save or undo before leaving.'
                  : 'Results stay on this page until you apply them. The plan is unchanged.'}
            </em>
          </span>
        </label>
      </div>

      {/* ── run ─────────────────────────────────────────────────────────── */}
      <div className="cap-forecast-advanced__actions">
        <button
          type="button"
          className="saas-btn saas-btn--primary"
          disabled={!canRun}
          onClick={() => void handleRun()}
        >
          {running ? `Fitting ${label}…` : `Run forecast · ${targetWeeks.length} weeks`}
        </button>
        {running ? (
          <span className="saas-muted text-xs">
            Fitting {config.models.length} model{config.models.length === 1 ? '' : 's'}…
          </span>
        ) : lastRun ? (
          <span className="saas-muted text-xs">Last run {lastRun.toLocaleString()}</span>
        ) : null}
        <SeriesProfilePanel
        driverLabel={label}
        values={series.map((point) => point.value)}
        models={results}
        horizonWeeks={config.horizonWeeks}
        accessLevel={user?.accessLevel ?? null}
        aiAssistantApproved={canUseAssistant}
        selectedModels={config.models}
        disabled={running}
        onUseSuggested={(models) => persist({ models })}
      />

      {results.length ? (
          <button
            type="button"
            className="saas-btn saas-btn--ghost"
            disabled={running}
            onClick={() => {
              clearDriverResults(scenarioId, metricId)
              setConfig(getDriverForecast(scenarioId, metricId))
              onResultsSaved()
            }}
          >
            Clear results
          </button>
        ) : null}
      </div>

      {usingSample && config.sampleMeta ? (
        <p className="cap-forecast-sample__banner">
          These results were fitted on generated sample data, not on this plan's history.
          {config.sampleMeta.weeks !== sampleWeeks
            ? ` The plan now suggests ${sampleWeeks} weeks rather than ${config.sampleMeta.weeks} — regenerate to match.`
            : ''}
        </p>
      ) : null}
      {!enoughData ? (
        <p className="cap-forecast-advanced__alert">
          {series.length} points available — at least 10 are needed to fit a model.
        </p>
      ) : null}
      {stale ? (
        <p className="cap-forecast-advanced__alert">
          The inputs changed since this run. The results below describe the previous data — re-run to
          bring them up to date.
        </p>
      ) : null}
      {scaleWarning ? <p className="cap-forecast-advanced__alert">{scaleWarning}</p> : null}
      {historyGapWeeks > 8 ? (
        <p className="cap-forecast-advanced__alert">
          This history ends {historyGapWeeks} weeks before the plan's first forecast week. The models
          must extrapolate across that gap before they reach the plan, so treat the result as
          indicative.
        </p>
      ) : null}
      {describeAdjustments(config.events ?? [], config.overrides ?? {}) ? (
        <p className="cap-forecast-advanced__alert">
          These numbers carry your adjustments —{' '}
          {describeAdjustments(config.events ?? [], config.overrides ?? {})}. The plan uses the
          adjusted figures, not the model's own.
        </p>
      ) : null}

      {(config.warnings ?? []).map((warning) => (
        <p key={warning} className="cap-forecast-advanced__alert">
          {warning}
        </p>
      ))}
      {runError ? (
        <p className="cap-forecast-advanced__alert cap-forecast-advanced__alert--error">{runError}</p>
      ) : null}

      {/* ── model comparison ────────────────────────────────────────────── */}
      {results.length ? (
        <div className="cap-forecast-advanced__results">
          <h4 className="cap-forecast-advanced__results-title">Models fitted for {label}</h4>
          {/*
            WAPE above 100% means total error exceeded total actual — forecasting
            zero every week would have scored better. It happens on drivers that
            are mostly quiet with occasional spikes, where there is no level to
            track. Worth saying outright: the table alone shows a best model and
            invites a planner to use it.
          */}
          {bestUsableWape != null && bestUsableWape > 100 ? (
            <p className="cap-forecast-advanced__alert cap-forecast-advanced__alert--error">
              Even the best model here is off by more than the total {label.toLowerCase()} it was
              predicting ({fmtNum(bestUsableWape, 0)}% WAPE) — forecasting zero every week would
              have scored better. This series has no level to track. Plan this driver by judgment,
              not from these models.
            </p>
          ) : null}
          <div className="cap-forecast-advanced__scroll">
            <table className="cap-forecast-models-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th className="cap-forecast-models-table__num" title="Total error over total volume — the WFM convention">WAPE</th>
                  <th className="cap-forecast-models-table__num" title="Mean signed error. Positive means the forecast runs high">Bias</th>
                  <th className="cap-forecast-models-table__num" title="Correlation between forecast and actual. Near zero means the model does not follow the shape of the series, however small its error looks">
                    Pattern R
                  </th>
                  <th className="cap-forecast-models-table__num" title="Forecast swing over actual swing. 1.00 is the right size; well below it means the model is flattening real variation and will miss peaks">
                    Amplitude
                  </th>
                  <th className="cap-forecast-models-table__num">MAPE</th>
                  <th className="cap-forecast-models-table__num">RMSE</th>
                  <th className="cap-forecast-models-table__num" title="Weeks scored, across rolling backtest folds">Tested on</th>
                  <th className="cap-forecast-models-table__num">Plan weeks</th>
                  <th>Drives plan</th>
                </tr>
              </thead>
              <tbody>
                {results.map((model) => {
                  const chosen =
                    config.selectedModelId === model.id ||
                    (!config.selectedModelId && usable[0]?.id === model.id)
                  return (
                    <tr
                      key={model.id}
                      className={`cap-forecast-model-row${chosen && model.success ? ' cap-forecast-model-row--selected' : ''}${model.success ? '' : ' cap-forecast-model-row--failed'}`}
                      title={model.error ?? undefined}
                    >
                      <td>
                        {model.label}
                        {model.success ? null : (
                          <span className="cap-forecast-model-row__error"> — {model.error}</span>
                        )}
                      </td>
                      <td className="cap-forecast-models-table__num">
                        {model.accuracy?.wape != null ? `${fmtNum(model.accuracy.wape, 1)}%` : '—'}
                      </td>
                      <td className="cap-forecast-models-table__num">
                        {model.accuracy?.bias != null ? (
                          <span className={`cap-forecast-bias cap-forecast-bias--${describeBias(model.accuracy.bias).tone}`}>
                            {model.accuracy.bias > 0 ? '+' : ''}
                            {fmtNum(model.accuracy.bias, 1)}%
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="cap-forecast-models-table__num">
                        {model.accuracy?.pattern_r != null ? (
                          <span
                            className={`cap-forecast-bias cap-forecast-bias--${describePattern(model.accuracy.pattern_r, model.accuracy.amplitude_ratio).tone}`}
                            title={describePattern(model.accuracy.pattern_r, model.accuracy.amplitude_ratio).text}
                          >
                            {fmtNum(model.accuracy.pattern_r, 2)}
                          </span>
                        ) : (
                          <span title={patternUnavailableReason(model.accuracy?.test_samples)}>—</span>
                        )}
                      </td>
                      <td className="cap-forecast-models-table__num">
                        {model.accuracy?.amplitude_ratio != null ? (
                          <span
                            className={`cap-forecast-bias cap-forecast-bias--${describePattern(model.accuracy.pattern_r, model.accuracy.amplitude_ratio).tone}`}
                            title={describePattern(model.accuracy.pattern_r, model.accuracy.amplitude_ratio).text}
                          >
                            {fmtNum(model.accuracy.amplitude_ratio, 2)}×
                          </span>
                        ) : (
                          <span title={patternUnavailableReason(model.accuracy?.test_samples)}>—</span>
                        )}
                      </td>
                      <td className="cap-forecast-models-table__num">
                        {model.accuracy?.mape != null ? `${fmtNum(model.accuracy.mape, 1)}%` : '—'}
                      </td>
                      <td className="cap-forecast-models-table__num">
                        {model.accuracy?.rmse != null ? fmtNum(model.accuracy.rmse, 2) : '—'}
                      </td>
                      <td className="cap-forecast-models-table__num">
                        {model.accuracy?.test_samples != null
                          ? `${model.accuracy.test_samples} wk${model.accuracy.folds && model.accuracy.folds > 1 ? ` · ${model.accuracy.folds} folds` : ''}`
                          : '—'}
                      </td>
                      <td className="cap-forecast-models-table__num">{model.weekly?.length ?? 0}</td>
                      <td>
                        {!model.success ? (
                          'Failed'
                        ) : (
                          <button
                            type="button"
                            className="cap-forecast-model-pin"
                            onClick={() => {
                              setDriverModelSelection(scenarioId, metricId, model.id)
                              setConfig(getDriverForecast(scenarioId, metricId))
                              onResultsSaved()
                            }}
                          >
                            {chosen ? 'Selected' : 'Use'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {!config.applyToCapacityPlan ? (
            <p className="saas-muted m-0 text-xs">
              Switch on “Apply {label} to the Capacity Plan” above to write this model into future weeks.
            </p>
          ) : (
            <p className="saas-muted m-0 text-xs">
              Future weeks in the driver table and Capacity Plan now use{' '}
              {bestDriverModel(config)?.label ?? 'the selected model'}.
            </p>
          )}
        </div>
      ) : null}



      {trackRecord.length ? (
        <section className="cap-forecast-adjust">
          <h4 className="cap-forecast-advanced__step-title">How past forecasts did</h4>
          <p className="saas-muted m-0 text-xs">
            Forecasts you applied, scored against the actuals that have arrived since. This is the
            forecast the plan was built on — the model you chose and the judgment you added —
            not a model refitted on history it already knows.
          </p>
          <div className="cap-forecast-advanced__scroll">
            <table className="cap-forecast-models-table">
              <thead>
                <tr>
                  <th>Applied</th>
                  <th>Model</th>
                  <th>WAPE</th>
                  <th>Bias</th>
                  <th>Weeks scored</th>
                </tr>
              </thead>
              <tbody>
                {trackRecord.map((entry) => (
                  <tr key={entry.snapshot.id}>
                    <td>
                      {entry.snapshot.takenAt.slice(0, 10)}
                      {entry.snapshot.adjusted ? ' · adjusted' : ''}
                    </td>
                    <td>{entry.snapshot.modelLabel}</td>
                    <td className="cap-forecast-models-table__num">
                      {entry.score.wape != null ? `${fmtNum(entry.score.wape, 1)}%` : '—'}
                    </td>
                    <td className="cap-forecast-models-table__num">
                      {entry.score.bias != null ? (
                        <span className={`cap-forecast-bias cap-forecast-bias--${describeBias(entry.score.bias).tone}`}>
                          {entry.score.bias > 0 ? '+' : ''}
                          {fmtNum(entry.score.bias, 1)}%
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="cap-forecast-models-table__num">
                      {entry.matured}
                      {entry.pending ? ` of ${entry.matured + entry.pending}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {usable.length ? (
        <ForecastAdjustments
          model={usable.find((m) => m.id === (config.selectedModelId ?? usable[0]?.id)) ?? usable[0]!}
          events={config.events ?? []}
          overrides={config.overrides ?? {}}
          unit={metric.unit}
          disabled={running}
          onEventsChange={(events) => persist({ events })}
          onOverridesChange={(overrides) => persist({ overrides })}
        />
      ) : null}

      {usable.length ? (
        <ForecastChartsPanel
          scenarioId={scenarioId}
          metricId={metricId}
          config={config}
          history={series}
          unit={metric.unit}
          weekStart={weekStart}
          onSelectionChange={() => {
            setConfig(getDriverForecast(scenarioId, metricId))
            onResultsSaved()
          }}
        />
      ) : null}
    </section>
  )
}
