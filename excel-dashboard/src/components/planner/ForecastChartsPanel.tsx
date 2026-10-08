import { useEffect, useMemo, useState } from 'react'
import {
  setDriverModelSelection,
  type DriverForecastConfig,
  type StoredWfmModel,
} from '../../planner/advancedForecastPersistence'
import {
  aggregationForUnit,
  buildAccuracySplit,
  buildForecastRows,
  type ChartGrain,
} from '../../planner/forecastChartData'
import type { DatedPoint } from '../../planner/forecastDataSource'
import type { ForecastMetricId } from '../../planner/forecastPersistence'
import { fmtNum } from '../../planner/format'
import { buildForecastExport, forecastRowStatus } from '../../planner/forecastExport'
import { forecastMetricDisplayLabel } from '../../planner/forecasting'
import { FORECAST_CHART_COLOURS, forecastValueLabel } from '../../utils/forecastChartStyle'
import {
  InteractiveD3Chart,
  type InteractiveD3Series,
} from '../charts/InteractiveD3Chart'

/*
  A daily view is offered only where the forecast itself is daily.

  It was removed once for good reason: on a weekly forecast the tab drew a daily
  line by splitting weekly values back into days, inventing a within-week shape
  nobody supplied. That objection does not apply to a forecast fitted at daily
  grain, where the day-level detail is measured rather than manufactured — and
  without the tab there is no way to see or export it, since every other view
  buckets it straight back into weeks.
*/
const GRAIN_TABS: Array<[ChartGrain | 'accuracy', string]> = [
  ['weekly', 'Weekly'],
  ['monthly', 'Monthly'],
  ['accuracy', 'Accuracy'],
]

const DAILY_TAB: [ChartGrain, string] = ['daily', 'Daily']

/**
 * Buckets shown by default before the zoom slider is touched. A daily series
 * with a year-long horizon runs past a thousand points, which renders as a solid
 * block at full width.
 */
const MAX_DEFAULT_BUCKETS = 180

const COLOURS = FORECAST_CHART_COLOURS

type Props = {
  scenarioId: string
  metricId: ForecastMetricId
  config: DriverForecastConfig
  history: DatedPoint[]
  unit: 'number' | 'percent' | 'seconds'
  weekStart: 'sunday' | 'monday'
  onSelectionChange: () => void
}

export function ForecastChartsPanel({
  scenarioId,
  metricId,
  config,
  history,
  unit,
  weekStart,
  onSelectionChange,
}: Props) {
  const [tab, setTab] = useState<ChartGrain | 'accuracy'>('weekly')
  const [modelId, setModelId] = useState<string | null>(null)
  const [tableOpen, setTableOpen] = useState(false)

  const usableModels = useMemo(
    () => (config.results ?? []).filter((model) => model.success),
    [config.results],
  )

  const activeModel: StoredWfmModel | null = useMemo(() => {
    if (!usableModels.length) return null
    const wanted = modelId ?? config.selectedModelId
    return usableModels.find((model) => model.id === wanted) ?? usableModels[0]!
  }, [config.selectedModelId, modelId, usableModels])

  const aggregation = aggregationForUnit(metricId, unit)

  /**
   * Whether the displayed model was fitted at daily grain.
   *
   * Read from the model rather than from the driver's settings, because the
   * tabs describe the series on screen: switching to a model from an earlier
   * weekly run must take the daily view away with it.
   */
  const isDailyForecast = activeModel?.aggregation === 'daily'

  const grainTabs = useMemo<Array<[ChartGrain | 'accuracy', string]>>(
    () => (isDailyForecast ? [DAILY_TAB, ...GRAIN_TABS] : GRAIN_TABS),
    [isDailyForecast],
  )

  /*
    A daily forecast opens on its daily view: the day-level shape is the only
    reason to have run one, and every other tab folds it away.
  */
  useEffect(() => {
    setTab((current) => {
      if (isDailyForecast) return current === 'weekly' ? 'daily' : current
      // The tab can vanish under a model switch, so never stay on it.
      return current === 'daily' ? 'weekly' : current
    })
  }, [isDailyForecast])

  const grain: ChartGrain = tab === 'accuracy' || (tab === 'daily' && !isDailyForecast) ? 'weekly' : tab

  /** Interval per plan week, keyed the same way the chart buckets are. */
  const bands = useMemo(() => {
    const map = new Map<string, { lower: number; upper: number }>()
    for (const point of activeModel?.weekly ?? []) {
      if (point.lower != null && point.upper != null) {
        map.set(point.week, { lower: point.lower, upper: point.upper })
      }
    }
    return map
  }, [activeModel])

  const rows = useMemo(
    () =>
      buildForecastRows({
        history,
        model: activeModel,
        grain,
        weekStart,
        aggregation,
        holidays: config.holidays,
        anomalies: config.anomalies,
        bands,
      }),
    [activeModel, aggregation, bands, config.anomalies, config.holidays, grain, history, weekStart],
  )

  /**
   * The file is built from `rows` — the same array the table below renders and
   * the chart above draws — so it cannot disagree with what was on screen when
   * it was downloaded. It follows the grain tab and the selected model.
   */
  const downloadCsv = () => {
    const { csv, filename } = buildForecastExport({
      label: forecastMetricDisplayLabel(metricId),
      unit,
      grain,
      rows,
      modelLabel: activeModel?.label ?? null,
    })
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const labels = useMemo(() => rows.map((row) => row.label), [rows])
  const firstFuture = useMemo(() => rows.findIndex((row) => row.isFuture), [rows])
  const showAccuracy = tab === 'accuracy'
  const accuracySplit = useMemo(() => buildAccuracySplit(rows, config.testSplit), [config.testSplit, rows])

  const mainSeries = useMemo<InteractiveD3Series[]>(() => {
    const anomalyValues = rows.map((row) =>
      row.anomaly && row.historical != null ? row.historical : null,
    )
    const series: InteractiveD3Series[] = [
      {
        id: 'historical',
        label: 'Historical',
        color: COLOURS.historical,
        type: 'area',
        values: rows.map((row) => row.historical),
      },
      {
        id: 'fitted',
        label: 'Model fit',
        color: COLOURS.fitted,
        type: 'dash',
        values: rows.map((row) => row.fitted),
      },
      {
        id: 'band',
        label: 'Forecast range',
        color: COLOURS.forecast,
        type: 'band',
        values: rows.map((row) => row.lower),
        upperValues: rows.map((row) => row.upper),
      },
      {
        id: 'forecast',
        label: 'Forecast',
        color: COLOURS.forecast,
        type: 'dash',
        values: rows.map((row) => row.forecast),
      },
    ]
    if (anomalyValues.some((value) => value != null)) {
      series.push({
        id: 'anomaly',
        label: 'Anomaly',
        color: COLOURS.anomaly,
        type: 'scatter',
        values: anomalyValues,
      })
    }
    return series
  }, [rows])

  const accuracySeries = useMemo<InteractiveD3Series[]>(() => {
    const trainSeries = rows.map((row, index) =>
      !row.isFuture && index < accuracySplit.testStartIndex ? row.historical : null,
    )
    const testActual = rows.map((row, index) =>
      !row.isFuture && index >= accuracySplit.testStartIndex ? row.historical : null,
    )
    const testPredicted = rows.map((row, index) =>
      !row.isFuture && index >= accuracySplit.testStartIndex ? row.fitted : null,
    )
    return [
      {
        id: 'train',
        label: 'Training history',
        color: COLOURS.train,
        type: 'area',
        values: trainSeries,
      },
      {
        id: 'test-actual',
        label: 'Test actual',
        color: COLOURS.historical,
        type: 'line',
        values: testActual,
      },
      {
        id: 'test-pred',
        label: 'Test prediction',
        color: COLOURS.fitted,
        type: 'dash',
        values: testPredicted,
      },
      {
        id: 'future',
        label: 'Future forecast',
        color: COLOURS.forecast,
        type: 'dash',
        values: rows.map((row) => row.forecast),
      },
    ]
  }, [accuracySplit.testStartIndex, rows])

  const zoomWindow = useMemo(() => {
    if (showAccuracy) {
      if (rows.length <= MAX_DEFAULT_BUCKETS) return { start: 0, end: 1 }
      const start =
        Math.max(0, accuracySplit.testStartIndex - Math.round(MAX_DEFAULT_BUCKETS / 4)) / rows.length
      return { start, end: 1 }
    }
    if (firstFuture < 0 || rows.length <= MAX_DEFAULT_BUCKETS) return { start: 0, end: 1 }
    const runUp = Math.min(firstFuture, Math.round(MAX_DEFAULT_BUCKETS / 3))
    return { start: (firstFuture - runUp) / rows.length, end: 1 }
  }, [accuracySplit.testStartIndex, firstFuture, rows.length, showAccuracy])

  const formatValue = useMemo(
    () => (value: number) => forecastValueLabel(value, unit),
    [unit],
  )

  if (!usableModels.length) {
    return (
      <section className="cap-forecast-charts saas-card">
        <p className="saas-muted m-0 text-sm">
          No forecast for this driver yet. Run one above to populate these charts.
        </p>
      </section>
    )
  }

  const accuracy = activeModel?.accuracy ?? {}

  return (
    <section className="cap-forecast-charts saas-card">
      <header className="cap-forecast-advanced__head">
        <div>
          <h3 className="m-0 text-sm font-bold text-slate-900">Forecast charts</h3>
          <p className="saas-muted m-0 text-xs">
            Historical actuals, the model's own fit, and the forecast. Toggle series, scroll to zoom,
            or drag the range sliders.
          </p>
        </div>
        <div className="cap-forecast-advanced__tabs" role="tablist" aria-label="Chart grain">
          {grainTabs.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`cap-forecast-advanced__tab${tab === id ? ' cap-forecast-advanced__tab--active' : ''}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="cap-forecast-charts__controls">
        <label className="saas-field">
          <span className="saas-field__label">Model</span>
          <select
            className="cap-field__input"
            value={activeModel?.id ?? ''}
            onChange={(event) => {
              // Charting a model and choosing it were separate controls that
              // looked identical. Selecting here now *is* the choice.
              setModelId(event.target.value)
              setDriverModelSelection(scenarioId, metricId, event.target.value)
              onSelectionChange()
            }}
          >
            {usableModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
                {model.accuracy?.mape != null ? ` — ${fmtNum(model.accuracy.mape, 1)}% MAPE` : ''}
              </option>
            ))}
          </select>
          <span className="saas-field__hint">
            {config.applyToCapacityPlan
              ? 'This model drives the Capacity Plan for this driver.'
              : 'Charted only — applying to the plan is switched off above.'}
          </span>
        </label>
      </div>

      {showAccuracy ? (
        <div className="cap-forecast-charts__metrics">
          {(
            [
              ['WAPE', accuracy.wape, '%'],
              ['Bias', accuracy.bias, '%'],
              ['RMSE', accuracy.rmse, ''],
              ['MAE', accuracy.mae, ''],
              ['Pattern R', accuracy.pattern_r, ''],
              ['Amplitude', accuracy.amplitude_ratio, '×'],
            ] as Array<[string, number | undefined, string]>
          ).map(([label, value, suffix]) => (
            <div key={label} className="cap-forecast-charts__metric">
              <span className="cap-forecast-charts__metric-label">{label}</span>
              <strong className="cap-forecast-charts__metric-value">
                {value != null && Number.isFinite(value)
                  ? `${fmtNum(value, 2)}${suffix}`
                  : '—'}
              </strong>
            </div>
          ))}
          <div className="cap-forecast-charts__metric">
            <span className="cap-forecast-charts__metric-label">Split</span>
            <strong className="cap-forecast-charts__metric-value">{config.testSplit}</strong>
          </div>
        </div>
      ) : null}

      <div className="cap-forecast-charts__plot">
        <InteractiveD3Chart
          key={`${showAccuracy ? 'accuracy' : 'main'}-${grain}-${activeModel?.id ?? 'none'}`}
          labels={labels}
          series={showAccuracy ? accuracySeries : mainSeries}
          height={380}
          formatValue={formatValue}
          emptyMessage="No forecast points to chart for this grain."
          initialZoomStart={zoomWindow.start}
          initialZoomEnd={zoomWindow.end}
          futureStartIndex={firstFuture >= 0 ? firstFuture : undefined}
          ariaLabel={showAccuracy ? 'Forecast accuracy chart' : 'Forecast chart'}
        />
      </div>

      <div className="cap-forecast-advanced__actions">
        <button
          type="button"
          className="saas-btn saas-btn--secondary saas-btn--sm"
          onClick={() => setTableOpen((open) => !open)}
        >
          {tableOpen ? 'Hide data table' : `Show data table (${rows.length} rows)`}
        </button>
        <button
          type="button"
          className="saas-btn saas-btn--secondary saas-btn--sm"
          disabled={!rows.length}
          onClick={downloadCsv}
        >
          Download CSV
        </button>
        {config.anomalies?.length ? (
          <span className="saas-muted text-xs">
            {config.anomalies.length} anomalies marked in red on the historical line
          </span>
        ) : null}
      </div>

      {tableOpen ? (
        <div className="cap-forecast-advanced__scroll">
          <table className="cap-forecast-models-table">
            <thead>
              <tr>
                <th>{grain === 'monthly' ? 'Month' : grain === 'weekly' ? 'Week' : 'Date'}</th>
                {/* Only days have a weekday worth naming, and it is the column
                    a daily view is being read for. */}
                {grain === 'daily' ? <th>Day</th> : null}
                <th className="cap-forecast-models-table__num">Historical</th>
                <th className="cap-forecast-models-table__num">Model fit</th>
                <th className="cap-forecast-models-table__num">Forecast</th>
                <th>Holiday</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className={row.anomaly ? 'cap-forecast-model-row--failed' : undefined}>
                  <td>{row.label}</td>
                  {grain === 'daily' ? <td>{row.weekday ?? '—'}</td> : null}
                  <td className="cap-forecast-models-table__num">{formatCell(row.historical, unit)}</td>
                  <td className="cap-forecast-models-table__num">{formatCell(row.fitted, unit)}</td>
                  <td className="cap-forecast-models-table__num">{formatCell(row.forecast, unit)}</td>
                  <td>{row.holiday ?? '—'}</td>
                  <td>{statusOf(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}

function formatCell(value: number | null, unit: 'number' | 'percent' | 'seconds'): string {
  if (value == null || !Number.isFinite(value)) return '—'
  if (unit === 'percent') return `${fmtNum(value * 100, 1)}%`
  if (unit === 'seconds') return `${fmtNum(value, 1)} sec`
  return fmtNum(value, 0)
}

// Shared with the CSV, so the Status column and the exported one cannot drift.
const statusOf = forecastRowStatus
