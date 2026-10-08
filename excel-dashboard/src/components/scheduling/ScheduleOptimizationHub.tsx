import { Link } from 'react-router-dom'
import { fmtNum } from '../../planner/format'
import type { ScheduleDemandAnalytics } from '../../planner/scheduling/scheduleDemandAnalytics'
import type { ServiceLevelInsight } from '../../planner/scheduling/serviceLevelOptimization'
import type {
  ScheduleRecommendation,
  ScheduleScenarioSnapshot,
} from '../../planner/scheduling/scheduleAdvisor'
import { formatDayLabel } from '../../planner/scheduling/intervalSlots'

export type { ScheduleScenarioSnapshot }

function fmtPct(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${value.toFixed(digits)}%`
}

function signedPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`
}

function slClass(value: number | null, target: number): string {
  if (value == null) return ''
  if (value + 0.05 >= target) return 'sched-opt-delta--better'
  if (value >= target * 0.95) return 'sched-opt-delta--warn'
  return 'sched-opt-delta--worse'
}

function deltaClass(current: number | null, next: number | null, higherIsBetter: boolean): string {
  if (current == null || next == null || !Number.isFinite(current) || !Number.isFinite(next)) return ''
  const diff = next - current
  if (Math.abs(diff) < 0.05) return 'sched-opt-delta--neutral'
  const better = higherIsBetter ? diff > 0 : diff < 0
  return better ? 'sched-opt-delta--better' : 'sched-opt-delta--worse'
}

function fmtDelta(current: number | null, next: number | null, suffix = ''): string {
  if (current == null || next == null || !Number.isFinite(current) || !Number.isFinite(next)) return ''
  const diff = next - current
  if (Math.abs(diff) < 0.05) return ''
  return `${diff > 0 ? '+' : ''}${diff.toFixed(1)}${suffix}`
}

const SCENARIO_ORDER: ScheduleScenarioSnapshot['id'][] = ['current', 'optimized', 'staffing']

export function ScheduleOptimizationHub({
  demand,
  serviceLevel,
  recommendations,
  scenarios,
  slaTarget,
  comparing,
  busy,
  settingsHref,
  hasOriginalView,
  onResetOriginalView,
  onApplyRecommendation,
  onRunScenarios,
  onApplyScenario,
}: {
  demand: ScheduleDemandAnalytics
  serviceLevel: ServiceLevelInsight
  recommendations: ScheduleRecommendation[]
  scenarios: ScheduleScenarioSnapshot[]
  slaTarget: number
  comparing: boolean
  busy: boolean
  settingsHref: string
  hasOriginalView: boolean
  onResetOriginalView: () => void
  onApplyRecommendation: (item: ScheduleRecommendation) => void
  onRunScenarios: () => void
  onApplyScenario: (id: ScheduleScenarioSnapshot['id']) => void
}) {
  const byId = Object.fromEntries(scenarios.map((row) => [row.id, row])) as Partial<
    Record<ScheduleScenarioSnapshot['id'], ScheduleScenarioSnapshot>
  >
  const current = byId.current ?? null
  const columns = SCENARIO_ORDER.map((id) => byId[id]).filter(Boolean) as ScheduleScenarioSnapshot[]
  const slMeets = serviceLevel.weekProjectedSl != null && serviceLevel.weekProjectedSl + 0.05 >= slaTarget

  return (
    <section className="sched-opt saas-card" aria-label="Optimization">
      <header className="sched-opt__hero">
        <div>
          <h2 className="sched-opt__title">Coverage & service level</h2>
        </div>
        <div className="sched-opt__hero-actions">
          {hasOriginalView ? (
            <button type="button" className="saas-btn saas-btn--secondary" disabled={busy} onClick={onResetOriginalView}>
              Original view
            </button>
          ) : null}
          <Link to={settingsHref} className="saas-btn saas-btn--secondary">
            Open settings
          </Link>
          <button type="button" className="saas-btn" disabled={busy || comparing} onClick={onRunScenarios}>
            {comparing ? 'Comparing…' : scenarios.length ? 'Refresh comparison' : 'Compare scenarios'}
          </button>
        </div>
      </header>

      {comparing ? (
        <p className="sched-opt-progress" role="status">
          Waiting Status — running current vs optimized settings vs extra staffing in parallel. The live draft is not
          changed until you apply a scenario.
        </p>
      ) : null}
      {busy && !comparing ? (
        <p className="sched-opt-progress" role="status">
          Waiting Status — working on your Action request. Please wait while schedules regenerate.
        </p>
      ) : null}

      <div className="sched-kpi-grid sched-opt-kpis">
        <article className="sched-kpi-card sched-kpi-card--indigo">
          <span className="sched-kpi-card__label">Required FTE</span>
          <strong className="sched-kpi-card__value">{fmtNum(demand.requiredWeekFte, 1)}</strong>
          <span className="sched-kpi-card__sub">Week total from requirements</span>
        </article>
        <article className="sched-kpi-card sched-kpi-card--teal">
          <span className="sched-kpi-card__label">Scheduled FTE</span>
          <strong className="sched-kpi-card__value">{fmtNum(demand.scheduledWeekFte, 1)}</strong>
          <span className="sched-kpi-card__sub">Net of lunch and breaks</span>
        </article>
        <article className={`sched-kpi-card sched-kpi-card--variance ${demand.staffingGapFte >= -0.05 ? 'sched-variance--over' : 'sched-variance--under'}`}>
          <span className="sched-kpi-card__label">Staffing gap</span>
          <strong className="sched-kpi-card__value">
            {demand.staffingGapFte > 0 ? '+' : ''}
            {fmtNum(demand.staffingGapFte, 1)}
          </strong>
          <span className="sched-kpi-card__sub">Scheduled − required</span>
        </article>
        <article className={`sched-kpi-card sched-kpi-card--variance ${Math.abs(demand.overUnderPct ?? 0) <= 2 ? 'sched-variance--match' : (demand.overUnderPct ?? 0) > 0 ? 'sched-variance--over' : 'sched-variance--under'}`}>
          <span className="sched-kpi-card__label">Over / under %</span>
          <strong className="sched-kpi-card__value">{signedPct(demand.overUnderPct)}</strong>
          <span className="sched-kpi-card__sub">
            {demand.understaffedIntervals} under · {demand.overstaffedIntervals} over
          </span>
        </article>
        <article className={`sched-kpi-card ${slMeets ? 'sched-kpi-card--variance sched-variance--match' : 'sched-kpi-card--rose'}`}>
          <span className="sched-kpi-card__label">Projected SL</span>
          <strong className="sched-kpi-card__value">{fmtPct(serviceLevel.weekProjectedSl)}</strong>
          <span className="sched-kpi-card__sub">Goal {fmtPct(slaTarget, 0)}</span>
        </article>
        <article className="sched-kpi-card sched-kpi-card--slate">
          <span className="sched-kpi-card__label">Schedules / HC</span>
          <strong className="sched-kpi-card__value">{fmtNum(demand.rosterHc, 0)}</strong>
          <span className="sched-kpi-card__sub">Recommended {fmtNum(serviceLevel.recommendedHc, 0)}</span>
        </article>
      </div>

      <div className="sched-opt-split">
        <article className="sched-opt-panel">
          <h3>Demand pattern</h3>
          <div className="sched-table-wrap">
            <table className="sched-table sched-table--compact">
              <caption>Peaks, valleys, and roster against this week’s interval requirements</caption>
              <thead>
                <tr>
                  <th>Measure</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Peak interval</th>
                  <td>
                    {demand.peak
                      ? `${formatDayLabel(demand.peak.day)} ${demand.peak.interval} · ${fmtNum(demand.peak.required, 1)} required`
                      : '—'}
                  </td>
                </tr>
                <tr className={demand.peak && demand.peak.gap > 0.01 ? 'sched-variance--under' : 'sched-variance--match'}>
                  <th scope="row">Peak gap</th>
                  <td>{demand.peak && demand.peak.gap > 0.01 ? `${fmtNum(demand.peak.gap, 1)} short` : 'Covered'}</td>
                </tr>
                <tr>
                  <th scope="row">Quiet interval</th>
                  <td>
                    {demand.valley
                      ? `${formatDayLabel(demand.valley.day)} ${demand.valley.interval} · ${fmtNum(demand.valley.required, 1)} required`
                      : '—'}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Top 20% of intervals</th>
                  <td>{fmtPct(demand.topPeakSharePct, 0)} of weekly demand</td>
                </tr>
                <tr>
                  <th scope="row">Roster vs peak</th>
                  <td>
                    {fmtNum(demand.rosterHc, 0)} HC · peak {fmtNum(demand.peakRequiredHc, 1)}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Coverage efficiency</th>
                  <td>{fmtPct(demand.coverageEfficiencyPct, 0)} on-target intervals</td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>

        <article className="sched-opt-panel">
          <h3>Service level</h3>
          {serviceLevel.meetsTarget ? (
            <p className="sched-opt-ok">Projected SL meets the {fmtPct(slaTarget, 0)} goal.</p>
          ) : (
            <p className="sched-opt-alert">
              {serviceLevel.constraintNote ??
                `Projected SL is below the ${fmtPct(slaTarget, 0)} goal. Restrictive rules or missing HC are blocking the target.`}
            </p>
          )}
          <p className="sched-opt-sl-meta">
            Smallest extra staffing to hit the goal: <strong>{fmtPct(serviceLevel.minExtraStaffingPct, 0)}</strong>
            {' · '}
            Recommended schedules: <strong>{fmtNum(serviceLevel.recommendedHc, 0)}</strong>
            {!serviceLevel.hasVolumeAht ? ' · Upload Volume/AHT for Erlang C SL.' : ''}
          </p>
          {serviceLevel.blockers.length ? (
            <div className="sched-table-wrap">
              <table className="sched-table sched-table--compact">
                <caption>Intervals below the {fmtPct(slaTarget, 0)} service level goal</caption>
                <thead>
                  <tr>
                    <th>Interval</th>
                    <th>Required</th>
                    <th>Scheduled</th>
                    <th>SL</th>
                    <th>+Agents</th>
                  </tr>
                </thead>
                <tbody>
                  {serviceLevel.blockers.slice(0, 8).map((row) => (
                    <tr key={`${row.day}-${row.interval}`} className="sched-variance--under">
                      <th scope="row">
                        {formatDayLabel(row.day)} {row.interval}
                      </th>
                      <td>{fmtNum(row.required, 1)}</td>
                      <td>{fmtNum(row.scheduled, 1)}</td>
                      <td className={slClass(row.projectedSl, slaTarget)}>{fmtPct(row.projectedSl)}</td>
                      <td>{fmtNum(row.extraAgents, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="sched-opt-ok">No interval is below the service level goal.</p>
          )}
        </article>
      </div>

      <article className="sched-opt-panel">
        <div className="sched-opt-card__head">
          <h3>Smart recommendations</h3>
          <p className="sched-opt-sl-meta">Each change is based on this week’s interval gaps and keeps shift length and rest rules.</p>
        </div>
        {recommendations.length ? (
          <div className="sched-table-wrap">
            <table className="sched-table sched-opt-rec-table">
              <caption>Recommended changes ranked by coverage and service level impact</caption>
              <thead>
                <tr>
                  <th>Recommendation</th>
                  <th>Why</th>
                  <th>Impact</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {recommendations.map((item) => (
                  <tr key={item.id} className={item.highlighted ? 'sched-opt-rec-table__hot' : undefined}>
                    <th scope="row">{item.title}</th>
                    <td className="sched-opt-rec-table__wrap">{item.why}</td>
                    <td className="sched-opt-rec-table__wrap sched-opt-rec-table__impact">{item.impact}</td>
                    <td>
                      {item.applySettings || item.extraAgents ? (
                        <button
                          type="button"
                          className="saas-btn saas-btn--secondary"
                          disabled={busy || comparing}
                          onClick={() => onApplyRecommendation(item)}
                        >
                          {busy ? 'Waiting…' : item.applySettings ? 'Apply & generate' : 'Use extra HC'}
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="sched-opt-ok">No further setting changes are indicated under current rules.</p>
        )}
      </article>

      <article className="sched-opt-panel">
        <div className="sched-opt-card__head">
          <h3>Scheduling scenarios</h3>
          <p className="sched-opt-sl-meta">
            Current settings vs optimized settings (same HC) vs additional staffing (minimum extra schedules). Applying a
            scenario updates the live draft only.
          </p>
        </div>
        {columns.length ? (
          <div className="sched-table-wrap">
            <table className="sched-table sched-opt-compare">
              <caption>Side-by-side outcome of the three scheduling scenarios</caption>
              <thead>
                <tr>
                  <th>Metric</th>
                  {columns.map((scenario) => (
                    <th key={scenario.id} className={`sched-opt-compare__col sched-opt-compare__col--${scenario.id}`}>
                      {scenario.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Notes</th>
                  {columns.map((scenario) => (
                    <td key={`${scenario.id}-note`} className="sched-opt-rec-table__wrap">
                      {scenario.note}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Projected SL</th>
                  {columns.map((scenario) => (
                    <td key={`${scenario.id}-sl`} className={slClass(scenario.projectedSl, slaTarget)}>
                      {fmtPct(scenario.projectedSl)}
                      {scenario.id !== 'current' && current ? (
                        <small className={deltaClass(current.projectedSl, scenario.projectedSl, true)}>
                          {fmtDelta(current.projectedSl, scenario.projectedSl, ' pts')}
                        </small>
                      ) : null}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Staffing %</th>
                  {columns.map((scenario) => (
                    <td key={`${scenario.id}-staff`}>
                      {fmtPct(scenario.staffingPct)}
                      {scenario.id !== 'current' && current ? (
                        <small className={deltaClass(current.staffingPct, scenario.staffingPct, false)}>
                          {fmtDelta(current.staffingPct, scenario.staffingPct, ' pts')}
                        </small>
                      ) : null}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Over / under %</th>
                  {columns.map((scenario) => (
                    <td key={`${scenario.id}-ou`}>{signedPct(scenario.overUnderPct)}</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Under intervals</th>
                  {columns.map((scenario) => (
                    <td key={`${scenario.id}-under`} className={scenario.understaffedIntervals > 0 ? 'sched-opt-delta--worse' : 'sched-opt-delta--better'}>
                      {scenario.understaffedIntervals}
                      {scenario.id !== 'current' && current ? (
                        <small className={deltaClass(current.understaffedIntervals, scenario.understaffedIntervals, false)}>
                          {fmtDelta(current.understaffedIntervals, scenario.understaffedIntervals)}
                        </small>
                      ) : null}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Over intervals</th>
                  {columns.map((scenario) => (
                    <td key={`${scenario.id}-over`}>
                      {scenario.overstaffedIntervals}
                      {scenario.id !== 'current' && current ? (
                        <small className={deltaClass(current.overstaffedIntervals, scenario.overstaffedIntervals, false)}>
                          {fmtDelta(current.overstaffedIntervals, scenario.overstaffedIntervals)}
                        </small>
                      ) : null}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Required FTE</th>
                  {columns.map((scenario) => (
                    <td key={`${scenario.id}-req`}>{fmtNum(scenario.requiredFte, 1)}</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Scheduled FTE</th>
                  {columns.map((scenario) => (
                    <td key={`${scenario.id}-sched`}>{fmtNum(scenario.scheduledFte, 1)}</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Schedules / HC</th>
                  {columns.map((scenario) => (
                    <td key={`${scenario.id}-hc`}>
                      {fmtNum(scenario.hc, 0)}
                      {scenario.extraAgents ? ` (+${scenario.extraAgents})` : ''}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Apply</th>
                  {columns.map((scenario) => (
                    <td key={`${scenario.id}-apply`}>
                      {scenario.id === 'current' ? (
                        <span className="sched-opt-sl-meta">Live draft</span>
                      ) : (
                        <button
                          type="button"
                          className="saas-btn"
                          disabled={busy || comparing}
                          onClick={() => onApplyScenario(scenario.id)}
                        >
                          {busy ? 'Waiting…' : 'Use this scenario'}
                        </button>
                      )}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="sched-opt-sl-meta">
            Click <strong>Compare scenarios</strong> to run optimized settings and extra staffing against this week’s
            requirements without changing the live draft.
          </p>
        )}
      </article>
    </section>
  )
}
