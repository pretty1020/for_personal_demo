import { useMemo, useRef, useState } from 'react'
import { StickyHorizontalScrollbar } from '../StickyHorizontalScrollbar'
import type { DriverTimelineRow } from '../../planner/driverTimeline'
import { fmtNum, fmtPct } from '../../planner/format'

type Props = {
  rows: DriverTimelineRow[]
  /** Label for the model or method driving planned AHT. */
  ahtMethod?: string
  /** Drivers whose fitted forecast is not switched on. */
  analysisOnlyDrivers?: string[]
  /** Forward weeks whose attrition is hand-set on the Capacity Plan. */
  attritionOverrideWeeks?: number
  /** Drivers currently fed by a service forecast, for the header note. */
  serviceDrivers?: string[]
  /** Drivers whose forecast came from generated sample data. */
  sampleDrivers?: string[]
}

const VIEWS = [
  ['all', 'Actuals & forecast'],
  ['actual', 'Actuals only'],
  ['forecast', 'Forecast only'],
] as const

type View = (typeof VIEWS)[number][0]

function seconds(value: number | null): string {
  return value == null ? '—' : `${fmtNum(value, 1)}`
}

function count(value: number | null): string {
  return value == null ? '—' : fmtNum(value, 0)
}

function rate(value: number | null): string {
  return value == null ? '—' : fmtPct(value)
}

/**
 * Every driver, actuals and forecast, in one timeline.
 *
 * Actual and planned weeks were previously separate tables, which made the one
 * comparison that matters — how the forecast continues from the history — a job
 * of reading two tables side by side. They share a table here, separated by
 * colour and a status column, with a marker on the row where the forecast
 * begins.
 */
export function DriverTimelineTable({
  rows,
  ahtMethod,
  serviceDrivers,
  sampleDrivers,
  analysisOnlyDrivers,
  attritionOverrideWeeks,
}: Props) {
  const [view, setView] = useState<View>('all')
  /** Mirrored by a floating scrollbar, since this table runs past the fold. */
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const visible = useMemo(
    () => (view === 'all' ? rows : rows.filter((row) => row.timeline === view)),
    [rows, view],
  )

  const actualCount = rows.filter((row) => row.timeline === 'actual').length
  const forecastCount = rows.length - actualCount
  const firstForecastWeek = rows.find((row) => row.timeline === 'forecast')?.week

  return (
    <section className="cap-forecast-table-card saas-card">
      <div className="cap-forecast-table-card__head">
        <div>
          <h3 className="m-0 text-sm font-bold text-slate-900">Driver timeline</h3>
          <p className="saas-muted m-0 mt-1 text-xs">
            Volume, AHT, attrition, absenteeism, and Nesting / Production HC from the staffing
            plan across the same weeks. Mix-adj. AHT factors that headcount into the blend.{' '}
            {ahtMethod ? `Planned AHT: ${ahtMethod}.` : null}{' '}
            {serviceDrivers?.length
              ? `Forecast models drive ${serviceDrivers.join(', ')}.`
              : 'No driver is currently fed by a forecast model.'}
          </p>
          {sampleDrivers?.length ? (
            <p className="cap-forecast-sample__banner m-0 mt-1">
              Sample data (not real) is behind the forecast for {sampleDrivers.join(', ')}.
            </p>
          ) : null}
          {/*
            The forecast ran, the models fitted, and these columns did not move —
            because applying is a separate step. Without this the table looks
            broken rather than switched off.
          */}
          {/*
            A hand-set rate silently outranks an applied forecast, and it is
            stored as a rate — so it rescales itself against whatever headcount
            the week ends up with.
          */}
          {attritionOverrideWeeks ? (
            <p className="cap-forecast-timeline__analysis-only m-0 mt-1">
              {attritionOverrideWeeks} planned{' '}
              {attritionOverrideWeeks === 1 ? 'week has' : 'weeks have'} an attrition rate set by
              hand on the Capacity Plan, which overrides any attrition forecast for{' '}
              {attritionOverrideWeeks === 1 ? 'that week' : 'those weeks'}. Because it is stored as
              a rate, it rescales when headcount changes — clear it on the Capacity Plan to let the
              forecast drive.
            </p>
          ) : null}
          {analysisOnlyDrivers?.length ? (
            <p className="cap-forecast-timeline__analysis-only m-0 mt-1">
              {analysisOnlyDrivers.join(', ')} {analysisOnlyDrivers.length === 1 ? 'has' : 'have'} a
              fitted forecast that is not applied, so {analysisOnlyDrivers.length === 1 ? 'its' : 'their'}{' '}
              future weeks below still come from the plan&rsquo;s own model. Open the driver and
              switch on &ldquo;Apply&rdquo; to use it.
            </p>
          ) : null}
        </div>
        <div className="cap-forecast-timeline__controls">
          <div className="cap-forecast-advanced__tabs" role="tablist" aria-label="Timeline rows">
            {VIEWS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={view === id}
                className={`cap-forecast-advanced__tab${view === id ? ' cap-forecast-advanced__tab--active' : ''}`}
                onClick={() => setView(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="cap-forecast-timeline__legend">
            <span className="cap-forecast-timeline__key cap-forecast-timeline__key--actual">
              {actualCount} actual
            </span>
            <span className="cap-forecast-timeline__key cap-forecast-timeline__key--forecast">
              {forecastCount} forecast
            </span>
          </div>
        </div>
      </div>

      <div className="cap-ledger-table-wrap cap-forecast-table-card__table" ref={scrollRef}>
        <table className="cap-ledger-table cap-forecast-table cap-forecast-timeline-table">
          <thead>
            <tr>
              <th>Week</th>
              <th>Status</th>
              <th>Volume</th>
              <th title="Production-only handle time, with any nesting premium taken out. Comparable across weeks whatever the mix was.">
                AHT (sec)
              </th>
              <th title="The same week with nesting mixed back in — what the floor actually runs at, and what the plan staffs to. Equal to the AHT column whenever nobody is in nesting.">
                Mix-adj. AHT
              </th>
              <th>Attrition HC</th>
              <th>Absenteeism</th>
              <th>Shrinkage</th>
              <th title="Nesting headcount from the Capacity staffing plan for this week.">
                Nesting HC
              </th>
              <th title="Production headcount from the Capacity staffing plan for this week.">
                Production HC
              </th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {visible.length ? (
              visible.map((row) => (
                <tr
                  key={`timeline-${row.week}`}
                  className={`cap-forecast-timeline-row cap-forecast-timeline-row--${row.timeline}${
                    view === 'all' && row.week === firstForecastWeek
                      ? ' cap-forecast-timeline-row--boundary'
                      : ''
                  }`}
                >
                  <td>{row.week}</td>
                  <td>
                    <span className={`cap-forecast-timeline__tag cap-forecast-timeline__tag--${row.timeline}`}>
                      {row.timeline === 'actual' ? 'Actual' : 'Forecast'}
                    </span>
                  </td>
                  <td>{count(row.volume)}</td>
                  <td>{seconds(row.aht)}</td>
                  <td>{seconds(row.ahtAdjusted)}</td>
                  <td>{count(row.attritionHc)}</td>
                  <td>{rate(row.absenteeism)}</td>
                  <td>{rate(row.shrinkage)}</td>
                  <td>{count(row.nestingHc)}</td>
                  <td>{count(row.productionHc)}</td>
                  <td>{row.note ?? '—'}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={11} className="saas-muted">
                  No weeks match this view.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <StickyHorizontalScrollbar targetRef={scrollRef} label="Scroll the driver timeline" />
    </section>
  )
}
