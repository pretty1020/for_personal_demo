import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { Link, useNavigate } from 'react-router-dom'
import { ModulePageHeader } from '../components/shell/ModulePageHeader'
import { usePlanner } from '../context/PlannerContext'
import { extractOfferedVolumeHistory } from '../planner/volumeForecastEngine'
import { triggerDownloadCsv } from '../utils/exportCsv'
import {
  DETECTION_METHOD_OPTIONS,
  applyAnomalyActions,
  buildForecastReadiness,
  buildSampleSeriesCsv,
  buildSampleSeriesRows,
  buildSeriesPoints,
  buildUploadTemplateCsv,
  downloadAnomalySampleWorkbook,
  downloadAnomalyUploadTemplateWorkbook,
  exportAnomalyReportCsv,
  exportAnomalyWorkbook,
  exportCleanedSeriesCsv,
  guessDateColumn,
  guessValueColumn,
  loadForecastReadiness,
  parseSeriesCsvText,
  parseSeriesJsonText,
  parseSeriesWorkbook,
  persistForecastReadiness,
  runAnomalyDetection,
  runQualityChecks,
  toIsoTimestamp,
  type AnomalyAction,
  type DetectedAnomaly,
  type DetectionMethod,
  type ForecastReadiness,
  type QualityIssue,
  type SeriesFrequency,
  type SeriesPoint,
} from '../planner/anomalyDetectionEngine'

const num = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })

function aggregatePointsForGrain(points: SeriesPoint[], grain: SeriesFrequency): SeriesPoint[] {
  if (grain === 'daily') return points
  const buckets = new Map<string, { sum: number; original: number; excluded: boolean }>()
  for (const point of points) {
    const date = new Date(`${point.timestamp.length === 7 ? `${point.timestamp}-01` : point.timestamp}T12:00:00`)
    if (Number.isNaN(date.getTime())) continue
    const key = toIsoTimestamp(date, grain)
    const current = buckets.get(key) ?? { sum: 0, original: 0, excluded: true }
    if (!point.excluded && Number.isFinite(point.value)) {
      current.sum += point.value
      current.original += point.originalValue
      current.excluded = false
    }
    buckets.set(key, current)
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([timestamp, bucket]) => ({
      timestamp,
      value: bucket.sum,
      originalValue: bucket.original,
      excluded: bucket.excluded,
    }))
}

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  blocking: 0,
  warning: 1,
  info: 2,
}

function readinessTone(status: ForecastReadiness['status']): string {
  if (status === 'passed') return 'is-passed'
  if (status === 'warnings') return 'is-warn'
  if (status === 'blocking') return 'is-block'
  return 'is-idle'
}

function readinessIcon(status: ForecastReadiness['status']): string {
  if (status === 'passed') return '✓'
  if (status === 'warnings') return '!'
  if (status === 'blocking') return '×'
  return '·'
}

export function AnomalyDetectionPage() {
  const navigate = useNavigate()
  const { scenarios, getScenarioLedger, activeScenario } = usePlanner()
  const fileRef = useRef<HTMLInputElement | null>(null)

  const [frequency, setFrequency] = useState<SeriesFrequency>('weekly')
  const [method, setMethod] = useState<DetectionMethod>('mad')
  const [sensitivity, setSensitivity] = useState(0.55)
  const [chartGrain, setChartGrain] = useState<SeriesFrequency>('weekly')
  const [columns, setColumns] = useState<string[]>([])
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [preview, setPreview] = useState<Record<string, string>[]>([])
  const [dateColumn, setDateColumn] = useState('')
  const [valueColumn, setValueColumn] = useState('')
  const [seriesLabel, setSeriesLabel] = useState('Uploaded series')
  const [loadNote, setLoadNote] = useState('')
  const [points, setPoints] = useState<SeriesPoint[]>([])
  const [anomalies, setAnomalies] = useState<DetectedAnomaly[]>([])
  const [issues, setIssues] = useState<QualityIssue[]>([])
  const [readiness, setReadiness] = useState<ForecastReadiness | null>(() => loadForecastReadiness())
  const [sourceMode, setSourceMode] = useState<'file' | 'staffing'>('file')
  const [busy, setBusy] = useState(false)

  const visibleScenarios = useMemo(
    () => scenarios.filter((scenario) => !scenario.isBaseline),
    [scenarios],
  )

  function refreshAnalysis(nextPoints: SeriesPoint[], label: string, freq: SeriesFrequency, nextMethod = method, nextSensitivity = sensitivity) {
    const cleaned = nextPoints
    const detected = runAnomalyDetection(cleaned, {
      method: nextMethod,
      sensitivity: nextSensitivity,
      frequency: freq,
    })
    const quality = runQualityChecks(cleaned, freq)
    const nextReadiness = buildForecastReadiness(cleaned, detected, quality, {
      seriesLabel: label,
      frequency: freq,
    })
    setPoints(cleaned)
    setAnomalies(detected)
    setIssues(quality)
    setReadiness(nextReadiness)
    persistForecastReadiness(nextReadiness)
    setChartGrain(freq)
  }

  function commitColumns(
    nextColumns: string[],
    nextRows: Record<string, string>[],
    nextPreview: Record<string, string>[],
    label: string,
    freq: SeriesFrequency = frequency,
  ) {
    const date = guessDateColumn(nextColumns)
    const value = guessValueColumn(nextColumns, date)
    setColumns(nextColumns)
    setRows(nextRows)
    setPreview(nextPreview)
    setDateColumn(date)
    setValueColumn(value)
    setSeriesLabel(label)
    if (date && value) {
      const built = buildSeriesPoints(nextRows, date, value, freq)
      if (built.error && !built.points.length) {
        setLoadNote(built.error)
        setPoints([])
        setAnomalies([])
        setIssues([])
        return
      }
      setLoadNote(built.error || `Loaded ${built.points.length} ${freq} points from ${label}.`)
      refreshAnalysis(built.points, label, freq)
    } else {
      setLoadNote('Select date and value columns, then run detection.')
    }
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBusy(true)
    setSourceMode('file')
    try {
      const name = file.name.replace(/\.[^.]+$/, '') || 'Uploaded series'
      const lower = file.name.toLowerCase()
      if (lower.endsWith('.json')) {
        const text = await file.text()
        const parsed = parseSeriesJsonText(text)
        if (parsed.error) {
          setLoadNote(parsed.error)
          return
        }
        commitColumns(parsed.columns, parsed.rows, parsed.preview, name)
        return
      }
      if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
        const buffer = await file.arrayBuffer()
        const parsed = parseSeriesWorkbook(buffer)
        if (parsed.error) {
          setLoadNote(parsed.error)
          return
        }
        commitColumns(parsed.columns, parsed.rows, parsed.preview, name)
        return
      }
      const text = await file.text()
      const parsed = parseSeriesCsvText(text)
      if (parsed.error) {
        setLoadNote(parsed.error)
        return
      }
      commitColumns(parsed.columns, parsed.rows, parsed.preview, name)
    } catch (error) {
      setLoadNote(error instanceof Error ? error.message : 'Could not read file.')
    } finally {
      setBusy(false)
    }
  }

  function loadFromStaffing(scenarioId?: string) {
    const scenario =
      visibleScenarios.find((item) => item.id === scenarioId) ??
      visibleScenarios.find((item) => item.id === activeScenario?.id) ??
      visibleScenarios[0]
    if (!scenario) {
      setLoadNote('No Staffing Plan scenario available. Upload a file instead.')
      return
    }
    setSourceMode('staffing')
    const history = extractOfferedVolumeHistory(getScenarioLedger(scenario.id))
    if (history.length < 3) {
      setLoadNote(`Not enough Offered Volume Actuals on “${scenario.name || scenario.plan.client}”.`)
      return
    }
    const nextPoints: SeriesPoint[] = history.map((point) => ({
      timestamp: point.week,
      value: point.volume,
      originalValue: point.volume,
    }))
    const label = `${scenario.name || scenario.plan.client} · Offered Volume`
    setColumns(['Week', 'OfferedVolume'])
    setRows(history.map((point) => ({ Week: point.week, OfferedVolume: String(point.volume) })))
    setPreview(
      history.slice(0, 12).map((point) => ({ Week: point.week, OfferedVolume: String(point.volume) })),
    )
    setDateColumn('Week')
    setValueColumn('OfferedVolume')
    setFrequency('weekly')
    setSeriesLabel(label)
    setLoadNote(`Connected to Staffing Plan: ${label} (${history.length} weeks).`)
    refreshAnalysis(nextPoints, label, 'weekly')
  }

  function loadSampleData(freq: SeriesFrequency = frequency) {
    setSourceMode('file')
    setFrequency(freq)
    const sample = buildSampleSeriesRows(freq)
    commitColumns(sample.columns, sample.rows, sample.rows.slice(0, 12), sample.label, freq)
    setLoadNote(
      `Loaded ${sample.label} (${sample.rows.length} rows) with intentional spike/dip for demo.`,
    )
  }

  function rebuildFromColumns(nextDate = dateColumn, nextValue = valueColumn, nextFreq = frequency) {
    if (!rows.length || !nextDate || !nextValue) return
    const built = buildSeriesPoints(rows, nextDate, nextValue, nextFreq)
    if (!built.points.length) {
      setLoadNote(built.error || 'Could not build series.')
      return
    }
    setLoadNote(built.error || `Series ready · ${built.points.length} points.`)
    refreshAnalysis(built.points, seriesLabel, nextFreq)
  }

  function updateAnomalyAction(id: string, action: AnomalyAction) {
    const nextAnomalies = anomalies.map((anomaly) =>
      anomaly.id === id ? { ...anomaly, action } : anomaly,
    )
    const cleaned = applyAnomalyActions(points.map((point) => ({ ...point, value: point.originalValue, excluded: false })), nextAnomalies)
    const rediscovered = runAnomalyDetection(cleaned, { method, sensitivity, frequency })
    // Preserve user actions by timestamp+type where possible
    const actionByKey = new Map(nextAnomalies.map((anomaly) => [`${anomaly.timestamp}:${anomaly.type}`, anomaly.action]))
    const merged = rediscovered.map((anomaly) => ({
      ...anomaly,
      action: actionByKey.get(`${anomaly.timestamp}:${anomaly.type}`) ?? anomaly.action,
    }))
    // Keep manually actioned anomalies that cleaning removed from rediscovery
    for (const anomaly of nextAnomalies) {
      if (anomaly.action === 'keep' || anomaly.action === 'mark_valid') continue
      if (!merged.some((item) => item.timestamp === anomaly.timestamp && item.type === anomaly.type)) {
        merged.push({ ...anomaly })
      }
    }
    const quality = runQualityChecks(cleaned, frequency)
    const nextReadiness = buildForecastReadiness(cleaned, merged, quality, {
      seriesLabel,
      frequency,
    })
    setPoints(cleaned)
    setAnomalies(merged.sort((a, b) => a.timestamp.localeCompare(b.timestamp)))
    setIssues(quality)
    setReadiness(nextReadiness)
    persistForecastReadiness(nextReadiness)
  }

  function rerunDetection() {
    if (!points.length) return
    refreshAnalysis(
      points.map((point) => ({
        ...point,
        value: point.excluded ? point.value : point.value,
      })),
      seriesLabel,
      frequency,
      method,
      sensitivity,
    )
  }

  const anomalyByTs = useMemo(() => {
    const map = new Map<string, DetectedAnomaly>()
    for (const anomaly of anomalies) {
      const existing = map.get(anomaly.timestamp)
      if (!existing || SEVERITY_ORDER[anomaly.severity]! < SEVERITY_ORDER[existing.severity]!) {
        map.set(anomaly.timestamp, anomaly)
      }
    }
    return map
  }, [anomalies])

  const chartPoints = useMemo(
    () => aggregatePointsForGrain(points, chartGrain),
    [points, chartGrain],
  )

  const chartOption: EChartsOption = useMemo(() => {
    const seriesPoints = chartPoints.filter((point) => !point.excluded || Number.isFinite(point.value))
    const markData = seriesPoints
      .map((point) => {
        const anomaly = anomalyByTs.get(point.timestamp)
        if (!anomaly || anomaly.action === 'exclude' || anomaly.action === 'mark_invalid') {
          // When chart is aggregated, also match anomalies whose timestamp falls in bucket
          const hit = [...anomalyByTs.values()].find((item) => {
            if (chartGrain === 'daily') return item.timestamp === point.timestamp
            const date = new Date(
              `${item.timestamp.length === 7 ? `${item.timestamp}-01` : item.timestamp}T12:00:00`,
            )
            if (Number.isNaN(date.getTime())) return false
            return toIsoTimestamp(date, chartGrain) === point.timestamp
          })
          if (!hit || hit.action === 'exclude' || hit.action === 'mark_invalid') return null
          const color =
            hit.severity === 'critical'
              ? '#dc2626'
              : hit.severity === 'high'
                ? '#ea580c'
                : hit.severity === 'medium'
                  ? '#db2777'
                  : '#9333ea'
          return {
            xAxis: point.timestamp,
            value: point.value,
            itemStyle: { color },
            symbolSize: hit.severity === 'critical' || hit.severity === 'high' ? 14 : 10,
            hit,
          }
        }
        const color =
          anomaly.severity === 'critical'
            ? '#dc2626'
            : anomaly.severity === 'high'
              ? '#ea580c'
              : anomaly.severity === 'medium'
                ? '#db2777'
                : '#9333ea'
        return {
          xAxis: point.timestamp,
          value: point.value,
          itemStyle: { color },
          symbolSize: anomaly.severity === 'critical' || anomaly.severity === 'high' ? 14 : 10,
          hit: anomaly,
        }
      })
      .filter(Boolean)

    return {
      color: ['#be185d', '#9333ea'],
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        formatter: (params: unknown) => {
          const list = Array.isArray(params) ? params : [params]
          const head = list[0] as { axisValue?: string; data?: number }
          const ts = String(head?.axisValue ?? '')
          const anomaly = markData.find((item) => (item as { xAxis: string }).xAxis === ts) as
            | { hit?: DetectedAnomaly }
            | undefined
          const value = head?.data
          let html = `<strong>${ts}</strong><br/>Value: ${num.format(Number(value ?? 0))}`
          if (anomaly?.hit) {
            html += `<br/>Anomaly: ${anomaly.hit.type} · ${anomaly.hit.severity} (score ${anomaly.hit.score})`
          }
          return html
        },
      },
      legend: { data: ['Series', 'Anomalies'] },
      grid: { left: 48, right: 24, top: 40, bottom: 56 },
      dataZoom: [
        { type: 'inside', throttle: 50 },
        { type: 'slider', height: 18, bottom: 8 },
      ],
      xAxis: {
        type: 'category',
        data: seriesPoints.map((point) => point.timestamp),
        axisLabel: { color: '#64748b', hideOverlap: true },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: '#64748b' },
        splitLine: { lineStyle: { color: 'rgba(190, 24, 93, 0.08)' } },
      },
      series: [
        {
          name: 'Series',
          type: 'line',
          smooth: true,
          showSymbol: false,
          data: seriesPoints.map((point) => (point.excluded ? null : point.value)),
          lineStyle: { width: 2.5, color: '#be185d' },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(190, 24, 93, 0.22)' },
                { offset: 1, color: 'rgba(190, 24, 93, 0.02)' },
              ],
            },
          },
        },
        {
          name: 'Anomalies',
          type: 'scatter',
          data: markData.map((item) => {
            const row = item as {
              xAxis: string
              value: number
              itemStyle: { color: string }
              symbolSize: number
            }
            return {
              value: [row.xAxis, row.value],
              itemStyle: row.itemStyle,
              symbolSize: row.symbolSize,
            }
          }),
          z: 5,
        },
      ],
    }
  }, [anomalyByTs, chartGrain, chartPoints])

  const sortedAnomalies = useMemo(
    () =>
      [...anomalies].sort(
        (a, b) =>
          (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) ||
          a.timestamp.localeCompare(b.timestamp),
      ),
    [anomalies],
  )

  const sortedIssues = useMemo(
    () =>
      [...issues].sort(
        (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
      ),
    [issues],
  )

  return (
    <div className="cap-anomaly">
      <ModulePageHeader
        title="Anomaly Detection"
        description="Load daily, weekly, or monthly time series — detect outliers and quality issues before forecasting."
        actions={
          <div className="cap-anomaly__header-actions">
            <Link className="saas-btn saas-btn--secondary" to="/capacity-plan">
              Open Staffing Plan
            </Link>
            <button
              type="button"
              className="saas-btn saas-btn--primary"
              disabled={!points.length || readiness?.status === 'blocking'}
              title={
                readiness?.status === 'blocking'
                  ? 'Resolve blocking issues before forecasting'
                  : 'Continue to Staffing Plan Forecasting'
              }
              onClick={() => {
                if (readiness) persistForecastReadiness(readiness)
                navigate('/capacity-plan')
              }}
            >
              Continue to Forecasting
            </button>
          </div>
        }
      />

      <section className={`cap-anomaly__readiness ${readinessTone(readiness?.status ?? 'unchecked')}`}>
        <div className="cap-anomaly__readiness-icon" aria-hidden>
          {readinessIcon(readiness?.status ?? 'unchecked')}
        </div>
        <div>
          <p className="cap-anomaly__eyebrow">Forecast readiness</p>
          <h3 className="cap-anomaly__readiness-title">
            {readiness
              ? readiness.status === 'passed'
                ? 'Ready for forecasting'
                : readiness.status === 'warnings'
                  ? 'Ready with warnings'
                  : 'Blocked — fix critical issues'
              : 'Load a series to assess readiness'}
          </h3>
          <p className="cap-anomaly__readiness-copy">
            {readiness?.message ??
              'Upload CSV / Excel / JSON or connect Staffing Plan Offered Volume. Quality checks run automatically.'}
          </p>
        </div>
        <div className="cap-anomaly__readiness-stats">
          <div>
            <strong>{readiness?.blocking.length ?? 0}</strong>
            <span>Blocking</span>
          </div>
          <div>
            <strong>{readiness?.warnings.length ?? 0}</strong>
            <span>Warnings</span>
          </div>
          <div>
            <strong>{readiness?.anomalyCount ?? 0}</strong>
            <span>Anomalies</span>
          </div>
        </div>
      </section>

      <div className="cap-anomaly__layout">
        <section className="cap-panel cap-anomaly__panel">
          <h3 className="cap-panel__title">1. Load data</h3>
          <p className="cap-panel__desc">
            Upload a file or connect Offered Volume Actuals from a Staffing Plan scenario.
          </p>

          <div className="cap-anomaly__source-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              className={`cap-anomaly__source-tab${sourceMode === 'file' ? ' is-active' : ''}`}
              onClick={() => setSourceMode('file')}
            >
              Upload file
            </button>
            <button
              type="button"
              role="tab"
              className={`cap-anomaly__source-tab${sourceMode === 'staffing' ? ' is-active' : ''}`}
              onClick={() => setSourceMode('staffing')}
            >
              Staffing Plan
            </button>
          </div>

          {sourceMode === 'file' ? (
            <div className="cap-anomaly__upload-row">
              <button
                type="button"
                className="saas-btn saas-btn--primary"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                {busy ? 'Reading…' : 'Upload CSV / Excel / JSON'}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,.xls,.json,text/csv,application/json"
                hidden
                onChange={(event) => void handleFile(event)}
              />
              <span className="saas-muted">Date + value columns required</span>
            </div>
          ) : (
            <div className="cap-anomaly__upload-row">
              <label className="cap-anomaly__field">
                <span>Scenario</span>
                <select
                  defaultValue={activeScenario?.id ?? visibleScenarios[0]?.id ?? ''}
                  onChange={(event) => loadFromStaffing(event.target.value)}
                >
                  {visibleScenarios.map((scenario) => (
                    <option key={scenario.id} value={scenario.id}>
                      {scenario.name || scenario.plan.client}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="saas-btn saas-btn--secondary" onClick={() => loadFromStaffing()}>
                Connect Offered Volume
              </button>
            </div>
          )}

          <div className="cap-anomaly__sample-bar">
            <p className="cap-anomaly__sample-label">Templates &amp; sample data</p>
            <div className="cap-anomaly__upload-row">
              <button
                type="button"
                className="saas-btn saas-btn--ghost"
                onClick={() =>
                  triggerDownloadCsv(
                    buildUploadTemplateCsv(frequency),
                    `AnomalyDetection_Template_${frequency}`,
                  )
                }
                title={`Download empty ${frequency} CSV template`}
              >
                Template CSV ({frequency})
              </button>
              <button
                type="button"
                className="saas-btn saas-btn--ghost"
                onClick={() => downloadAnomalyUploadTemplateWorkbook()}
                title="Excel workbook with Daily, Weekly, Monthly template sheets"
              >
                Template Excel
              </button>
              <button
                type="button"
                className="saas-btn saas-btn--ghost"
                onClick={() =>
                  triggerDownloadCsv(buildSampleSeriesCsv(frequency), `AnomalyDetection_Sample_${frequency}`)
                }
                title={`Download ${frequency} sample with spike/dip`}
              >
                Sample CSV ({frequency})
              </button>
              <button
                type="button"
                className="saas-btn saas-btn--ghost"
                onClick={() => downloadAnomalySampleWorkbook()}
                title="Excel sample pack (daily + weekly + monthly)"
              >
                Sample Excel
              </button>
              <button
                type="button"
                className="saas-btn saas-btn--secondary"
                onClick={() => loadSampleData(frequency)}
                title="Load sample series into this page and run detection"
              >
                Load sample now
              </button>
            </div>
          </div>

          <div className="cap-anomaly__controls">
            <label className="cap-anomaly__field">
              <span>Frequency</span>
              <select
                value={frequency}
                onChange={(event) => {
                  const next = event.target.value as SeriesFrequency
                  setFrequency(next)
                  rebuildFromColumns(dateColumn, valueColumn, next)
                }}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
            <label className="cap-anomaly__field">
              <span>Date column</span>
              <select
                value={dateColumn}
                onChange={(event) => {
                  const next = event.target.value
                  setDateColumn(next)
                  rebuildFromColumns(next, valueColumn, frequency)
                }}
                disabled={!columns.length}
              >
                {columns.map((column) => (
                  <option key={column} value={column}>
                    {column}
                  </option>
                ))}
              </select>
            </label>
            <label className="cap-anomaly__field">
              <span>Value column</span>
              <select
                value={valueColumn}
                onChange={(event) => {
                  const next = event.target.value
                  setValueColumn(next)
                  rebuildFromColumns(dateColumn, next, frequency)
                }}
                disabled={!columns.length}
              >
                {columns.map((column) => (
                  <option key={column} value={column}>
                    {column}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {loadNote ? <p className="cap-anomaly__note">{loadNote}</p> : null}

          {preview.length ? (
            <div className="cap-anomaly__preview-wrap">
              <h4 className="cap-anomaly__subtitle">Preview</h4>
              <div className="cap-anomaly__table-scroll">
                <table className="cap-anomaly__table">
                  <thead>
                    <tr>
                      {columns.map((column) => (
                        <th key={column}>{column}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, index) => (
                      <tr key={index}>
                        {columns.map((column) => (
                          <td key={column}>{row[column]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </section>

        <section className="cap-panel cap-anomaly__panel">
          <h3 className="cap-panel__title">2. Detection settings</h3>
          <p className="cap-panel__desc">
            Choose a method and sensitivity. Level shifts, change points, and seasonality breaks are always scanned.
          </p>
          <div className="cap-anomaly__methods">
            {DETECTION_METHOD_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`cap-anomaly__method${method === option.id ? ' is-active' : ''}`}
                onClick={() => {
                  setMethod(option.id)
                  if (points.length) {
                    refreshAnalysis(points, seriesLabel, frequency, option.id, sensitivity)
                  }
                }}
              >
                <strong>{option.label}</strong>
                <span>{option.blurb}</span>
              </button>
            ))}
          </div>
          <label className="cap-anomaly__field cap-anomaly__field--range">
            <span>
              Sensitivity <em>{Math.round(sensitivity * 100)}%</em>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={sensitivity}
              onChange={(event) => {
                const next = Number(event.target.value)
                setSensitivity(next)
              }}
              onMouseUp={rerunDetection}
              onTouchEnd={rerunDetection}
              onKeyUp={rerunDetection}
            />
          </label>
          <button
            type="button"
            className="saas-btn saas-btn--secondary"
            disabled={!points.length}
            onClick={rerunDetection}
          >
            Re-run detection
          </button>
        </section>
      </div>

      <section className="cap-panel cap-anomaly__panel">
        <div className="cap-anomaly__chart-head">
          <div>
            <h3 className="cap-panel__title">3. Time series &amp; anomalies</h3>
            <p className="cap-panel__desc m-0">
              Zoom the slider · hover for details · anomalies marked by severity color.
            </p>
          </div>
          <div className="cap-anomaly__grain-toggle" role="group" aria-label="Chart grain">
            {(['daily', 'weekly', 'monthly'] as SeriesFrequency[]).map((grain) => (
              <button
                key={grain}
                type="button"
                className={`cap-anomaly__grain${chartGrain === grain ? ' is-active' : ''}`}
                onClick={() => setChartGrain(grain)}
                title="Display label — detection uses the Load frequency above"
              >
                {grain}
              </button>
            ))}
          </div>
        </div>
        {points.length ? (
          <ReactECharts option={chartOption} style={{ height: 360 }} notMerge lazyUpdate />
        ) : (
          <p className="cap-dbe__empty">Load a series to visualize anomalies.</p>
        )}
      </section>

      <div className="cap-anomaly__layout cap-anomaly__layout--tables">
        <section className="cap-panel cap-anomaly__panel">
          <h3 className="cap-panel__title">Quality checks</h3>
          {!sortedIssues.length ? (
            <p className="cap-anomaly__ok">No quality issues detected.</p>
          ) : (
            <ul className="cap-anomaly__issue-list">
              {sortedIssues.map((issue) => (
                <li key={issue.id} className={`cap-anomaly__issue cap-anomaly__issue--${issue.severity}`}>
                  <strong>{issue.title}</strong>
                  <span>{issue.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="cap-panel cap-anomaly__panel">
          <div className="cap-anomaly__chart-head">
            <h3 className="cap-panel__title">Anomaly table</h3>
            <div className="cap-anomaly__export-row">
              <button
                type="button"
                className="saas-btn saas-btn--ghost"
                disabled={!anomalies.length}
                onClick={() =>
                  triggerDownloadCsv(exportAnomalyReportCsv(anomalies), `${seriesLabel}_AnomalyReport`)
                }
              >
                Anomaly CSV
              </button>
              <button
                type="button"
                className="saas-btn saas-btn--ghost"
                disabled={!points.length}
                onClick={() =>
                  triggerDownloadCsv(exportCleanedSeriesCsv(points), `${seriesLabel}_CleanedSeries`)
                }
              >
                Cleaned CSV
              </button>
              <button
                type="button"
                className="saas-btn saas-btn--secondary"
                disabled={!points.length || !readiness}
                onClick={() => {
                  if (!readiness) return
                  exportAnomalyWorkbook(
                    points,
                    anomalies,
                    issues,
                    readiness,
                    `${seriesLabel.replace(/[^\w.-]+/g, '_')}_AnomalyPack`,
                  )
                }}
              >
                Export workbook
              </button>
            </div>
          </div>
          {!sortedAnomalies.length ? (
            <p className="cap-anomaly__ok">No anomalies flagged at this sensitivity.</p>
          ) : (
            <div className="cap-anomaly__table-scroll">
              <table className="cap-anomaly__table cap-anomaly__table--anomalies">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Value</th>
                    <th>Type</th>
                    <th>Severity</th>
                    <th>Score</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedAnomalies.map((anomaly) => (
                    <tr key={anomaly.id} className={`cap-anomaly__row--${anomaly.severity}`}>
                      <td>{anomaly.timestamp}</td>
                      <td>{num.format(anomaly.value)}</td>
                      <td>{anomaly.type.replaceAll('_', ' ')}</td>
                      <td>
                        <span className={`cap-anomaly__pill cap-anomaly__pill--${anomaly.severity}`}>
                          {anomaly.severity}
                        </span>
                      </td>
                      <td>{anomaly.score}</td>
                      <td>
                        <select
                          value={anomaly.action}
                          onChange={(event) =>
                            updateAnomalyAction(anomaly.id, event.target.value as AnomalyAction)
                          }
                        >
                          <option value="keep">Review</option>
                          <option value="mark_valid">Mark valid</option>
                          <option value="mark_invalid">Mark invalid</option>
                          <option value="exclude">Exclude</option>
                          <option value="impute">Impute (mean)</option>
                          <option value="interpolate">Interpolate</option>
                          <option value="cap">Cap (P5–P95)</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
