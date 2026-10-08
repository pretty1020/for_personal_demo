import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import type { WeekCapacityPlanOverride } from '../../planner/capacityPlanOverridePersistence'
import type { WeekStart } from '../../planner/types'
import type { WeeklyLedgerRow } from '../../planner/weeklyLedger'
import {
  extractOfferedVolumeHistory,
  futurePlanWeeks,
  historyPointsToWeekly,
  parseVolumeHistoryCsv,
  runVolumeForecast,
  type DayOfWeekFactor,
  type VolumeForecastRun,
  type VolumeHistoryGrain,
  type WeeklyVolumePoint,
} from '../../planner/volumeForecastEngine'
import {
  downloadForecastVolumeCsv,
  downloadForecastVolumeWorkbook,
  type ForecastDownloadGrain,
} from '../../planner/volumeForecastExport'

const num = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })
const pct = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })

type Props = {
  scenarioId: string
  scenarioName: string
  weekStart: WeekStart
  ledger: WeeklyLedgerRow[]
  planStartWeek: string | null
  canEdit: boolean
  onApplyForecast: (plannedByWeek: Record<string, WeekCapacityPlanOverride>) => void
  onClose: () => void
}

function fmtErr(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return num.format(value)
}

function DowBars({ factors }: { factors: DayOfWeekFactor[] }) {
  if (!factors.length) return null
  const max = Math.max(...factors.map((f) => f.avgVolume), 1)
  return (
    <div className="cap-volume-forecast__dow">
      <h4 className="cap-volume-forecast__subtitle">Day-of-week trend</h4>
      <p className="saas-muted m-0">
        Detected from daily history. Sat/Sun lows (and other weekday patterns) are preserved when
        aggregating to weekly Offered Volume.
      </p>
      <div className="cap-volume-forecast__dow-grid" role="list">
        {factors.map((factor) => (
          <div key={factor.day} className="cap-volume-forecast__dow-item" role="listitem">
            <span className="cap-volume-forecast__dow-label">{factor.label}</span>
            <div className="cap-volume-forecast__dow-bar-track">
              <div
                className={`cap-volume-forecast__dow-bar${factor.day === 0 || factor.day === 6 ? ' is-weekend' : ''}`}
                style={{ height: `${Math.max(8, (factor.avgVolume / max) * 100)}%` }}
                title={`${factor.label}: ${num.format(factor.avgVolume)} (${pct.format(factor.share * 100)}%)`}
              />
            </div>
            <span className="cap-volume-forecast__dow-value">{num.format(factor.avgVolume)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function StaffingForecastingPanel({
  scenarioId,
  scenarioName,
  weekStart,
  ledger,
  planStartWeek,
  canEdit,
  onApplyForecast,
  onClose,
}: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [grain, setGrain] = useState<VolumeHistoryGrain>('weekly')
  const [uploadWeekly, setUploadWeekly] = useState<WeeklyVolumePoint[] | null>(null)
  const [dayFactors, setDayFactors] = useState<DayOfWeekFactor[]>([])
  const [uploadNote, setUploadNote] = useState('')
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const [applyMessage, setApplyMessage] = useState('')
  const [downloadMessage, setDownloadMessage] = useState('')

  const ledgerHistory = useMemo(() => extractOfferedVolumeHistory(ledger), [ledger])
  const history = uploadWeekly?.length ? uploadWeekly : ledgerHistory
  const futureWeeks = useMemo(
    () => futurePlanWeeks(ledger, planStartWeek),
    [ledger, planStartWeek],
  )

  const run: VolumeForecastRun = useMemo(
    () =>
      runVolumeForecast({
        history,
        futureWeeks,
        dayOfWeekFactors: dayFactors,
        grain: uploadWeekly?.length ? grain : 'ledger',
        selectedModelId,
      }),
    [history, futureWeeks, dayFactors, grain, uploadWeekly, selectedModelId],
  )

  const forecastRows = useMemo(
    () =>
      Object.entries(run.forecastByWeek)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([week, volume]) => ({ week, volume })),
    [run.forecastByWeek],
  )

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      const parsed = parseVolumeHistoryCsv(text, grain)
      if (parsed.error) {
        setUploadNote(parsed.error)
        return
      }
      const { weekly, dayOfWeekFactors } = historyPointsToWeekly(parsed.points, grain, weekStart)
      if (!weekly.length) {
        setUploadNote('Could not aggregate uploaded rows into weekly Offered Volume.')
        return
      }
      setUploadWeekly(weekly)
      setDayFactors(dayOfWeekFactors)
      setSelectedModelId(null)
      setUploadNote(
        `Loaded ${parsed.points.length} ${grain} rows → ${weekly.length} weekly points` +
          (dayOfWeekFactors.length ? ` · DOW factors from daily data` : ''),
      )
      setApplyMessage('')
      setDownloadMessage('')
    }
    reader.readAsText(file)
  }

  function clearUpload() {
    setUploadWeekly(null)
    setDayFactors([])
    setUploadNote('')
    setSelectedModelId(null)
    setApplyMessage('')
    setDownloadMessage('')
  }

  function applyToPlan() {
    if (!canEdit) return
    const plannedByWeek: Record<string, WeekCapacityPlanOverride> = {}
    for (const [week, volume] of Object.entries(run.forecastByWeek)) {
      if (!(volume > 0)) continue
      plannedByWeek[week] = { callVolume: volume }
    }
    const weeks = Object.keys(plannedByWeek).length
    if (!weeks) {
      setApplyMessage('No future-week forecast values to apply.')
      return
    }
    onApplyForecast(plannedByWeek)
    setApplyMessage(
      `Applied ${weeks} future week${weeks === 1 ? '' : 's'} of Forecast Volume to the Staffing Plan.`,
    )
  }

  function handleDownloadCsv(grain: ForecastDownloadGrain) {
    const result = downloadForecastVolumeCsv(run, grain, weekStart, scenarioName)
    if (!result.ok) {
      setDownloadMessage(result.error)
      return
    }
    const label = grain === 'daily' ? 'Daily' : grain === 'weekly' ? 'Weekly' : 'Monthly'
    setDownloadMessage(`Downloaded ${label} Forecast Volume (${result.rows} rows).`)
  }

  function handleDownloadWorkbook() {
    const result = downloadForecastVolumeWorkbook(run, weekStart, scenarioName, history)
    if (!result.ok) {
      setDownloadMessage(result.error)
      return
    }
    setDownloadMessage(
      'Downloaded Excel workbook (Daily, Weekly, Monthly + model errors). Based on the selected / best-fit model.',
    )
  }

  return (
    <section className="cap-panel cap-volume-forecast" data-scenario={scenarioId}>
      <div className="cap-volume-forecast__head">
        <div>
          <p className="cap-volume-forecast__eyebrow">Forecasting</p>
          <h3 className="cap-panel__title">Volume forecast — {scenarioName}</h3>
          <p className="cap-panel__desc">
            Input: <strong>Offered Volume</strong> (Actual or uploaded history). Output:{' '}
            <strong>Forecast Volume</strong> for future plan weeks. Best-fit model is highlighted by
            lowest MAPE.
          </p>
        </div>
        <button type="button" className="saas-btn saas-btn--ghost" onClick={onClose}>
          Hide forecasting
        </button>
      </div>

      <div className="cap-volume-forecast__upload">
        <div className="cap-volume-forecast__upload-controls">
          <label className="cap-volume-forecast__field">
            <span>History grain</span>
            <select
              value={grain}
              onChange={(event) => setGrain(event.target.value as VolumeHistoryGrain)}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
          <button
            type="button"
            className="saas-btn saas-btn--secondary"
            onClick={() => fileRef.current?.click()}
          >
            Upload history (CSV)
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={handleFile}
          />
          {uploadWeekly ? (
            <button type="button" className="saas-btn saas-btn--ghost" onClick={clearUpload}>
              Use Staffing Plan Actuals
            </button>
          ) : null}
        </div>
        <p className="saas-muted m-0">
          CSV columns: <code>Date</code> (or Week / Month) and <code>Volume</code> /{' '}
          <code>OfferedVolume</code>. Daily uploads auto-aggregate to weekly and detect day-of-week
          trends. Without an upload, Offered Volume Actuals from this plan are used (
          {ledgerHistory.length} week{ledgerHistory.length === 1 ? '' : 's'}).
        </p>
        {uploadNote ? <p className="cap-volume-forecast__note">{uploadNote}</p> : null}
      </div>

      <DowBars factors={run.dayOfWeekFactors} />

      <div className="cap-volume-forecast__models">
        <h4 className="cap-volume-forecast__subtitle">Models &amp; error measures</h4>
        <p className="saas-muted m-0">{run.message}</p>
        {!run.models.length ? (
          <p className="cap-dbe__empty">Not enough history to score models yet.</p>
        ) : (
          <div className="cap-forecast-metric-card__table-wrap">
            <table className="cap-forecast-models-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th className="cap-forecast-models-table__num">MAPE %</th>
                  <th className="cap-forecast-models-table__num">RMSE</th>
                  <th className="cap-forecast-models-table__num">MAE</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {run.models.map((model) => {
                  const isBest = run.bestModel?.id === model.id
                  const isSelected = run.selectedModelId === model.id
                  return (
                    <tr
                      key={model.id}
                      className={[
                        isBest ? 'cap-forecast-model-row--best' : '',
                        isSelected ? 'cap-forecast-model-row--selected' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <td>
                        {model.label}
                        {isBest ? <span className="cap-forecast-best"> Best fit</span> : null}
                      </td>
                      <td className="cap-forecast-models-table__num">{fmtErr(model.mapePct)}</td>
                      <td className="cap-forecast-models-table__num">{fmtErr(model.rmse)}</td>
                      <td className="cap-forecast-models-table__num">{fmtErr(model.mae)}</td>
                      <td>
                        <button
                          type="button"
                          className="saas-btn saas-btn--ghost"
                          onClick={() => setSelectedModelId(model.id)}
                        >
                          {isSelected ? 'Selected' : 'Use'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="cap-volume-forecast__horizon">
        <div className="cap-volume-forecast__horizon-head">
          <h4 className="cap-volume-forecast__subtitle">Forecast Volume — future weeks</h4>
          <button
            type="button"
            className="saas-btn saas-btn--primary"
            disabled={!canEdit || !forecastRows.length}
            title={
              canEdit
                ? 'Push Forecast Volume into Staffing Plan future weeks (call volume)'
                : 'You do not have edit access'
            }
            onClick={applyToPlan}
          >
            Apply to Staffing Plan
          </button>
        </div>
        {applyMessage ? <p className="cap-volume-forecast__note">{applyMessage}</p> : null}
        {!forecastRows.length ? (
          <p className="cap-dbe__empty">No future weeks available to forecast.</p>
        ) : (
          <div className="cap-forecast-metric-card__horizon-grid cap-forecast-metric-card__horizon-grid--scroll">
            {forecastRows.slice(0, 26).map((row) => (
              <div key={row.week} className="cap-forecast-horizon-pill">
                <span className="cap-forecast-horizon-pill__week">{row.week}</span>
                <strong>{num.format(row.volume)}</strong>
              </div>
            ))}
            {forecastRows.length > 26 ? (
              <div className="cap-forecast-horizon-pill">
                <span className="cap-forecast-horizon-pill__week">+{forecastRows.length - 26} more</span>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="cap-volume-forecast__download">
        <h4 className="cap-volume-forecast__subtitle">Download Forecast Volume</h4>
        <p className="saas-muted m-0">
          Exports the selected (or best-fit) model run. Daily uses day-of-week shares from uploaded
          daily history, or equal 1/7 when DOW is unavailable. Monthly sums weekly forecasts by
          week-start month.
        </p>
        <div className="cap-volume-forecast__download-actions">
          <button
            type="button"
            className="saas-btn saas-btn--secondary"
            disabled={!forecastRows.length}
            onClick={() => handleDownloadCsv('daily')}
          >
            Daily CSV
          </button>
          <button
            type="button"
            className="saas-btn saas-btn--secondary"
            disabled={!forecastRows.length}
            onClick={() => handleDownloadCsv('weekly')}
          >
            Weekly CSV
          </button>
          <button
            type="button"
            className="saas-btn saas-btn--secondary"
            disabled={!forecastRows.length}
            onClick={() => handleDownloadCsv('monthly')}
          >
            Monthly CSV
          </button>
          <button
            type="button"
            className="saas-btn saas-btn--primary"
            disabled={!forecastRows.length}
            onClick={handleDownloadWorkbook}
            title="Excel workbook with Daily, Weekly, Monthly sheets plus model errors"
          >
            All (Excel)
          </button>
        </div>
        {downloadMessage ? <p className="cap-volume-forecast__note">{downloadMessage}</p> : null}
      </div>
    </section>
  )
}
