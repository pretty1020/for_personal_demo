import type { ReactNode } from 'react'
import type { ScheduleDiagnostics } from '../../planner/scheduling/scheduleDiagnostics'
import { fmtNum } from '../../planner/format'
import { formatDayLabel } from '../../planner/scheduling/intervalSlots'

export function ScheduleDiagnosticsPanel({
  diagnostics,
  children,
}: {
  diagnostics: ScheduleDiagnostics
  children?: ReactNode
}) {
  const engineLabel =
    diagnostics.engine === 'python-pulp'
      ? 'Python PuLP'
      : diagnostics.engine === 'python'
        ? 'Python greedy'
        : 'TypeScript interval engine'
  const extraViolations = diagnostics.violations.filter(
    (item) => item.code !== 'understaffed_intervals' && item.code !== 'overstaffed_intervals',
  )
  const passed = extraViolations.length === 0
  const gapRows = [...diagnostics.unfulfilled].sort((a, b) => b.gap - a.gap)

  return (
    <section className="sched-diagnostics" aria-label="Coverage and rule check">
      <header className="sched-diagnostics__head">
        <div>
          <h2 className="sched-opt__title">Coverage vs rules</h2>
          {diagnostics.coverageNote ? <p className="sched-opt__lead">{diagnostics.coverageNote}</p> : null}
        </div>
        <span className={`sched-badge${passed ? ' sched-badge--saved' : ' sched-badge--under'}`}>{engineLabel}</span>
      </header>

      <div className="sched-diagnostics__kpis sched-kpi-grid">
        <article className={`sched-kpi-card ${diagnostics.understaffedIntervals ? 'sched-kpi-card--rose' : 'sched-kpi-card--variance sched-variance--match'}`}>
          <span className="sched-kpi-card__label">Understaffed intervals</span>
          <strong className="sched-kpi-card__value">{diagnostics.understaffedIntervals}</strong>
        </article>
        <article className={`sched-kpi-card ${diagnostics.overstaffedIntervals ? 'sched-kpi-card--amber' : 'sched-kpi-card--variance sched-variance--match'}`}>
          <span className="sched-kpi-card__label">Overstaffed intervals</span>
          <strong className="sched-kpi-card__value">{diagnostics.overstaffedIntervals}</strong>
        </article>
        <article className={`sched-kpi-card ${extraViolations.length ? 'sched-kpi-card--rose' : 'sched-kpi-card--variance sched-variance--match'}`}>
          <span className="sched-kpi-card__label">Rule violations</span>
          <strong className="sched-kpi-card__value">{extraViolations.length}</strong>
        </article>
        <article className={`sched-kpi-card ${diagnostics.unfulfilled.length ? 'sched-kpi-card--rose' : 'sched-kpi-card--variance sched-variance--match'}`}>
          <span className="sched-kpi-card__label">Unfulfilled intervals</span>
          <strong className="sched-kpi-card__value">{diagnostics.unfulfilled.length}</strong>
        </article>
      </div>

      {extraViolations.length ? (
        <ul className="sched-diagnostics__violations">
          {extraViolations.map((item) => (
            <li key={`${item.code}-${item.message}`}>{item.message}</li>
          ))}
        </ul>
      ) : (
        <p className="sched-opt-ok m-0">Shift, rest, and relief rules were applied. Coverage gaps are listed separately.</p>
      )}

      {gapRows.length ? (
        <div className="sched-table-wrap">
          <table className="sched-table sched-table--compact">
            <caption>
              Largest remaining gaps after applying shift, rest, and relief rules
              {gapRows.length > 12 ? ` · showing 12 of ${gapRows.length}` : ''}
            </caption>
            <thead>
              <tr>
                <th>Day</th>
                <th>Interval</th>
                <th>Required</th>
                <th>Scheduled</th>
                <th>Gap</th>
              </tr>
            </thead>
            <tbody>
              {gapRows.slice(0, 12).map((row) => (
                <tr key={`${row.day}-${row.interval}`} className="sched-variance--under">
                  <th scope="row">{formatDayLabel(row.day)}</th>
                  <td>{row.interval}</td>
                  <td>{fmtNum(row.required, 1)}</td>
                  <td>{fmtNum(row.scheduled, 1)}</td>
                  <td>{fmtNum(row.gap, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="saas-muted m-0 text-sm">Every required interval was covered within the current headcount and rules.</p>
      )}

      {children ? <div className="sched-diagnostics__note">{children}</div> : null}
    </section>
  )
}
