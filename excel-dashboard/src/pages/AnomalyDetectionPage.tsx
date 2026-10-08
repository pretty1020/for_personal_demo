import { useMemo, useRef, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { Link } from 'react-router-dom'
import {
  DETECTION_METHODS,
  POINT_ACTIONS,
  cleanSeries,
  formatPointDate,
  parseSeriesCsv,
  sampleSeries,
  scoreSeries,
  toCleanedCsv,
  toCsv,
  type Grain,
  type Method,
  type PointAction,
  type ScoredPoint,
  type SeriesPoint,
} from '../planner/anomalyDetection'

const GRAINS: Array<{ id: Grain; label: string; hint: string }> = [
  { id: 'daily', label: 'Daily', hint: 'Each day is compared with the same weekday. A quiet Saturday is normal.' },
  { id: 'weekly', label: 'Weekly', hint: 'Each week is compared with the weeks around it.' },
  { id: 'monthly', label: 'Monthly', hint: 'Each month is compared with the same month in other years. A busy December can be normal.' },
]

const ACTION_COLOR: Record<PointAction, string> = {
  valid: '#1f3d34',
  invalid: '#9a6b2f',
  exclude: '#6e675f',
  impute: '#8c7348',
  interpolate: '#2c5648',
}

type ActionFilter = 'all' | 'open' | PointAction

const FILTERS: Array<{ id: ActionFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'valid', label: 'Valid' },
  { id: 'invalid', label: 'Invalid' },
  { id: 'exclude', label: 'Exclude' },
  { id: 'impute', label: 'Impute' },
  { id: 'interpolate', label: 'Interpolate' },
]

export function AnomalyDetectionPage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [grain, setGrain] = useState<Grain>('daily')
  const [method, setMethod] = useState<Method>('rhythm')
  const [methodsOpen, setMethodsOpen] = useState(false)
  const [threshold, setThreshold] = useState(3.5)
  const [points, setPoints] = useState<SeriesPoint[]>(() => sampleSeries('daily'))
  const [ownFile, setOwnFile] = useState(false)
  const [actions, setActions] = useState<Record<string, PointAction>>({})
  const [actionFilter, setActionFilter] = useState<ActionFilter>('all')
  const [selectedDate, setSelectedDate] = useState<string | null>('2026-09-16')
  const [message, setMessage] = useState<string | null>(null)
  const scored = useMemo(() => scoreSeries(points, grain, threshold, method), [points, grain, threshold, method])
  const cleaned = useMemo(() => cleanSeries(scored, actions), [scored, actions])
  const selected = scored.find((point) => point.date === selectedDate) ?? scored.find((point) => point.anomaly) ?? scored[0] ?? null
  const unusual = scored.filter((point) => point.anomaly)
  const visible = unusual.filter((point) => matchesFilter(point, actions[point.date], actionFilter))
  const openCount = unusual.filter((point) => !actions[point.date]).length
  const taggedCount = unusual.length - openCount
  const rhythm = GRAINS.find((item) => item.id === grain) ?? GRAINS[0]!
  const cleanedByDate = useMemo(() => new Map(cleaned.map((row) => [row.date, row])), [cleaned])

  function chooseGrain(next: Grain) {
    setGrain(next)
    setSelectedDate(null)
    if (!ownFile) {
      setPoints(sampleSeries(next))
      setActions({})
      setMessage(null)
      return
    }
    const label = GRAINS.find((item) => item.id === next)?.label.toLowerCase() ?? next
    setMessage(`Same file, now scored as ${label} data.`)
  }

  function loadSample() {
    setOwnFile(false)
    setPoints(sampleSeries(grain))
    setActions({})
    setSelectedDate(null)
    setMessage(null)
  }

  function tag(date: string, action: PointAction | '') {
    setActions((current) => {
      const next = { ...current }
      if (!action) delete next[date]
      else next[date] = action
      return next
    })
    setSelectedDate(date)
  }

  function onFile(file: File | undefined) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const parsed = parseSeriesCsv(String(reader.result ?? ''))
      if (parsed.error) {
        setMessage(parsed.error)
        return
      }
      setOwnFile(true)
      setPoints(parsed.points)
      setActions({})
      setSelectedDate(null)
      setMessage(`${parsed.points.length} rows loaded. They are scored as ${rhythm.label.toLowerCase()} data. Change the rhythm to score the same file another way.`)
    }
    reader.readAsText(file)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="anom-page">
      <div className="anom-frame">
        <header className="anom-hero">
          <div>
            <p className="anom-kicker">Anomaly detection</p>
            <h1>Find the point that does not belong.</h1>
            <p className="anom-lead">{rhythm.hint}</p>
          </div>
          <Link className="anom-back" to="/">Main page</Link>
        </header>

        <p className="anom-plain" role="status">
          {selected ? `${formatPointDate(selected.date, grain)}: ${selected.reason}${actionSentence(selected, actions[selected.date])}` : 'Load a series to begin.'}
        </p>

        <div className="anom-controls">
          <div>
            <div className="anom-grains" role="tablist" aria-label="Rhythm">
              {GRAINS.map((item) => (
                <button key={item.id} type="button" className={item.id === grain ? 'is-on' : ''} onClick={() => chooseGrain(item.id)}>
                  {item.label}
                </button>
              ))}
            </div>
            <p className="anom-hint">{ownFile ? 'Your file stays loaded when you change the rhythm.' : 'Each rhythm opens its own sample. Upload a file to score your own series.'}</p>
          </div>
          <label className="anom-sensitivity">
            <span>Sensitivity {threshold.toFixed(1)}</span>
            <input
              type="range"
              min={2}
              max={5}
              step={0.1}
              value={threshold}
              onChange={(event) => setThreshold(Number(event.target.value))}
            />
            <em>Lower finds more. Higher waits for a clearer break.</em>
          </label>
          <div className="anom-actions">
            <button type="button" onClick={loadSample}>Load sample</button>
            <button type="button" onClick={() => downloadCsv(`${grain}-template.csv`, toCsv(sampleSeries(grain)))}>Download template</button>
            <button type="button" onClick={() => downloadCsv(`${grain}-cleaned.csv`, toCleanedCsv(cleaned))}>Download cleaned data</button>
            <button type="button" onClick={() => fileRef.current?.click()}>Upload CSV</button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(event) => onFile(event.target.files?.[0])} />
          </div>
        </div>
        {message ? <p className="anom-note">{message}</p> : null}
        <p className="anom-hint">
          {taggedCount
            ? `${taggedCount} tagged, ${openCount} still open. The cleaned file keeps valid points, fills invalid and imputed points with the usual level, bridges interpolated points, and drops excluded rows.`
            : 'Tag an unusual point to decide what the cleaned file should do with it.'}
        </p>

        <section className="anom-method">
          <button type="button" className="anom-method__toggle" aria-expanded={methodsOpen} onClick={() => setMethodsOpen((open) => !open)}>
            Detection method
            <span>{methodsOpen ? 'Hide' : 'Show'}</span>
          </button>
          {methodsOpen ? (
            <div className="anom-method__panel" role="radiogroup" aria-label="Detection method">
              {DETECTION_METHODS.map((item) => (
                <label key={item.id} className={item.id === method ? 'is-on' : ''}>
                  <input type="radio" name="detection-method" checked={item.id === method} onChange={() => setMethod(item.id)} />
                  <strong>{item.label}</strong>
                  <span>{item.summary}</span>
                </label>
              ))}
            </div>
          ) : null}
        </section>

        <section className="anom-chart" aria-label="Series chart">
          <div className="anom-chart__head">
            <h2>{unusual.length ? `${unusual.length} unusual` : 'Nothing unusual'} in {scored.length} {grain === 'daily' ? 'days' : grain === 'weekly' ? 'weeks' : 'months'}</h2>
            <p>Red rings still need a decision. A tagged point changes color. The dark line is the cleaned series.</p>
          </div>
          <ReactECharts
            theme="ledger"
            notMerge
            style={{ height: 400 }}
            option={chartOption(scored, grain, actions, cleanedByDate, actionFilter, selectedDate)}
            onEvents={{
              click: (params: { dataIndex?: number }) => {
                const point = scored[params.dataIndex ?? -1]
                if (point) setSelectedDate(point.date)
              },
            }}
          />
        </section>

        {selected ? (
          <section className="anom-detail">
            <div>
              <p className="anom-kicker">{selected.anomaly ? 'Check this point' : 'Inside the usual range'}</p>
              <h2>{formatPointDate(selected.date, grain)}</h2>
              <p>{selected.reason}</p>
              {selected.anomaly ? (
                <label className="anom-tag">
                  <span>Action</span>
                  <select value={actions[selected.date] ?? ''} onChange={(event) => tag(selected.date, event.target.value as PointAction | '')}>
                    <option value="">Open</option>
                    {POINT_ACTIONS.map((item) => (
                      <option key={item.id} value={item.id}>{item.label}</option>
                    ))}
                  </select>
                  <em>{POINT_ACTIONS.find((item) => item.id === actions[selected.date])?.detail ?? 'No decision yet. It stays in the cleaned file as recorded.'}</em>
                </label>
              ) : null}
            </div>
            <dl>
              <div><dt>Recorded</dt><dd>{selected.value.toLocaleString('en-US')}</dd></div>
              <div><dt>Usual</dt><dd>{selected.expected.toLocaleString('en-US')}</dd></div>
              <div><dt>Cleaned</dt><dd>{cleanedValueLabel(selected, cleanedByDate.get(selected.date))}</dd></div>
            </dl>
          </section>
        ) : null}

        <section className="anom-list" aria-label="Unusual points">
          <div className="anom-list__head">
            <h2>Unusual points</h2>
            <div className="anom-filters" role="tablist" aria-label="Action filter">
              {FILTERS.map((item) => {
                const count = unusual.filter((point) => matchesFilter(point, actions[point.date], item.id)).length
                return (
                  <button key={item.id} type="button" className={item.id === actionFilter ? 'is-on' : ''} onClick={() => setActionFilter(item.id)}>
                    {item.label} <b>{count}</b>
                  </button>
                )
              })}
            </div>
          </div>
          {visible.length ? (
            <ul>
              {visible.map((point) => (
                <li key={point.date} className={point.date === selected?.date ? 'is-on' : ''}>
                  <button type="button" onClick={() => setSelectedDate(point.date)}>
                    <strong>{formatPointDate(point.date, grain)}</strong>
                    <span>{point.value.toLocaleString('en-US')} vs usual {point.expected.toLocaleString('en-US')}</span>
                    <em>{point.score > 0 ? 'High' : 'Low'}</em>
                  </button>
                  <select aria-label={`Action for ${formatPointDate(point.date, grain)}`} value={actions[point.date] ?? ''} onChange={(event) => tag(point.date, event.target.value as PointAction | '')}>
                    <option value="">Open</option>
                    {POINT_ACTIONS.map((item) => (
                      <option key={item.id} value={item.id}>{item.label}</option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          ) : (
            <p>{unusual.length ? 'No unusual points with this action.' : 'No point is far enough from its usual level. Lower the sensitivity if you want a closer look.'}</p>
          )}
        </section>
      </div>
    </div>
  )
}

function matchesFilter(point: ScoredPoint, action: PointAction | undefined, filter: ActionFilter): boolean {
  if (!point.anomaly) return false
  if (filter === 'all') return true
  if (filter === 'open') return !action
  return action === filter
}

function actionSentence(point: ScoredPoint, action: PointAction | undefined): string {
  if (!point.anomaly || !action) return ''
  if (action === 'valid') return ' Tagged valid, so the cleaned series keeps it.'
  if (action === 'exclude') return ' Tagged exclude, so the cleaned series drops it.'
  if (action === 'interpolate') return ' Tagged interpolate, so the cleaned series bridges the neighbors.'
  if (action === 'invalid') return ' Tagged invalid, so the cleaned series uses the usual level.'
  return ' Tagged impute, so the cleaned series uses the usual level.'
}

function cleanedValueLabel(point: ScoredPoint, row: { value: number } | undefined): string {
  if (point.anomaly && !row) return 'Dropped'
  return (row?.value ?? point.value).toLocaleString('en-US')
}

function chartOption(
  scored: ScoredPoint[],
  grain: Grain,
  actions: Record<string, PointAction>,
  cleanedByDate: Map<string, { value: number }>,
  filter: ActionFilter,
  selectedDate: string | null,
) {
  const labels = scored.map((point) => formatPointDate(point.date, grain))
  const open = scored.map((point) => (point.anomaly && !actions[point.date] && (filter === 'all' || filter === 'open') ? point.value : null))
  const reviewed = scored.map((point) => {
    const action = actions[point.date]
    if (!point.anomaly || !action || action === 'exclude') return null
    if (filter !== 'all' && filter !== action) return null
    return cleanedByDate.get(point.date)?.value ?? point.value
  })
  const excluded = scored.map((point) => (point.anomaly && actions[point.date] === 'exclude' && (filter === 'all' || filter === 'exclude') ? point.value : null))
  const reviewedColors = scored.map((point) => ACTION_COLOR[actions[point.date] as PointAction] ?? '#1f3d34')
  return {
    textStyle: { fontFamily: 'IBM Plex Sans, sans-serif', color: '#6e675f' },
    grid: { left: 56, right: 20, top: 36, bottom: grain === 'daily' ? 72 : 44 },
    tooltip: {
      trigger: 'axis' as const,
      backgroundColor: '#1c1915',
      borderWidth: 0,
      textStyle: { color: '#f7f3ec', fontFamily: 'IBM Plex Sans, sans-serif' },
      formatter: (params: Array<{ dataIndex?: number }>) => {
        const point = scored[params[0]?.dataIndex ?? -1]
        if (!point) return ''
        const action = actions[point.date]
        const cleaned = cleanedByDate.get(point.date)
        const decision = !point.anomaly ? 'Inside the usual range' : action ? POINT_ACTIONS.find((item) => item.id === action)?.label : 'Open'
        const cleanedText = point.anomaly && !cleaned ? 'Dropped' : (cleaned?.value ?? point.value).toLocaleString('en-US')
        return `${formatPointDate(point.date, grain)}<br/>Recorded ${point.value.toLocaleString('en-US')}<br/>Usual ${point.expected.toLocaleString('en-US')}<br/>Cleaned ${cleanedText}<br/>${decision}`
      },
    },
    legend: { top: 0, data: ['Usual range', 'Usual level', 'Recorded', 'Cleaned', 'Needs a decision', 'Tagged'], textStyle: { color: '#6e675f' } },
    dataZoom: grain === 'daily'
      ? [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 8, borderColor: '#e3dbd0', fillerColor: 'rgba(156, 59, 50, 0.12)' }]
      : [{ type: 'inside' }],
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: { hideOverlap: true, color: '#6e675f', fontSize: 11 },
      axisLine: { lineStyle: { color: '#1c1915' } },
    },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: '#e3dbd0' } }, axisLabel: { color: '#6e675f' } },
    series: [
      {
        name: 'Usual low',
        type: 'line',
        data: scored.map((point) => point.low),
        stack: 'band',
        symbol: 'none',
        lineStyle: { opacity: 0 },
        areaStyle: { opacity: 0 },
        tooltip: { show: false },
      },
      {
        name: 'Usual range',
        type: 'line',
        data: scored.map((point) => Math.max(0, point.high - point.low)),
        stack: 'band',
        symbol: 'none',
        lineStyle: { opacity: 0 },
        areaStyle: { color: 'rgba(31, 61, 52, 0.12)' },
        tooltip: { show: false },
      },
      {
        name: 'Usual level',
        type: 'line',
        data: scored.map((point) => point.expected),
        symbol: 'none',
        lineStyle: { color: '#8c7348', type: 'dashed', width: 1.5 },
      },
      {
        name: 'Recorded',
        type: 'line',
        data: scored.map((point) => point.value),
        symbol: 'none',
        lineStyle: { color: '#b7aea3', width: 1.25 },
        z: 2,
      },
      {
        name: 'Cleaned',
        type: 'line',
        data: scored.map((point) => {
          if (point.anomaly && actions[point.date] === 'exclude') return null
          return cleanedByDate.get(point.date)?.value ?? point.value
        }),
        symbol: 'circle',
        symbolSize: 5,
        showSymbol: false,
        lineStyle: { color: '#1c1915', width: 2.2 },
        itemStyle: { color: '#1c1915' },
        z: 3,
      },
      {
        name: 'Needs a decision',
        type: 'effectScatter',
        data: open.map((value, index) => (value == null ? null : {
          value,
          symbolSize: scored[index]?.date === selectedDate ? 22 : 16,
        })),
        rippleEffect: { scale: 2.8, brushType: 'stroke' },
        itemStyle: {
          color: '#9c3b32',
          borderColor: '#fffdf8',
          borderWidth: 2,
          shadowBlur: 14,
          shadowColor: 'rgba(156, 59, 50, 0.45)',
        },
        z: 6,
      },
      {
        name: 'Tagged',
        type: 'scatter',
        data: reviewed.map((value, index) => (value == null ? null : {
          value,
          itemStyle: { color: reviewedColors[index], borderColor: '#fffdf8', borderWidth: 2 },
          symbolSize: scored[index]?.date === selectedDate ? 18 : 13,
        })),
        symbol: 'diamond',
        z: 5,
      },
      {
        name: 'Excluded',
        type: 'scatter',
        data: excluded,
        symbol: 'circle',
        symbolSize: 12,
        itemStyle: { color: 'transparent', borderColor: '#6e675f', borderWidth: 2 },
        tooltip: { show: false },
        z: 4,
      },
    ],
  }
}

function downloadCsv(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}
