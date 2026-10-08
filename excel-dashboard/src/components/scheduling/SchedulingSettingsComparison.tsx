import type { SchedulingOutcomeSummary } from '../../planner/scheduling/schedulingOutcomeSummary'
import type { SchedulingSettingsSuggestion } from '../../planner/scheduling/schedulingSettingsRecommendations'

type Props = {
  current: SchedulingOutcomeSummary
  originalView: SchedulingOutcomeSummary | null
  suggestions: SchedulingSettingsSuggestion[]
  appliedSuggestionOutcomes: Record<string, SchedulingOutcomeSummary>
}

function fmtPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${value.toFixed(1)}%`
}

function deltaClass(current: number | null, next: number | null, higherIsBetter: boolean): string {
  if (current == null || next == null) return ''
  const diff = next - current
  if (Math.abs(diff) < 0.05) return 'sched-compare__delta--neutral'
  const improved = higherIsBetter ? diff > 0 : diff < 0
  return improved ? 'sched-compare__delta--better' : 'sched-compare__delta--worse'
}

function fmtDelta(current: number | null, next: number | null): string {
  if (current == null || next == null) return '—'
  const diff = next - current
  if (Math.abs(diff) < 0.05) return '±0.0'
  return `${diff > 0 ? '+' : ''}${diff.toFixed(1)}`
}

export function SchedulingSettingsComparison({
  current,
  originalView,
  suggestions,
  appliedSuggestionOutcomes,
}: Props) {
  const baseline = originalView ?? current
  const showOriginalRow = originalView != null

  return (
    <section className="sched-compare saas-card" aria-label="Settings vs recommendations comparison">
      <header className="sched-compare__head">
        <div>
          <h2 className="sched-section-title m-0">Staffing &amp; service level comparison</h2>
          <p className="saas-muted m-0 text-xs">
            Original View vs current settings after generation; applied recommendations show recorded outcomes.
          </p>
        </div>
      </header>
      <div className="sched-table-wrap">
        <table className="sched-table sched-table--compact sched-compare__table">
          <thead>
            <tr>
              <th>Configuration</th>
              <th>Staffing %</th>
              <th>Projected SL</th>
              <th>Projected SL (Erlang)</th>
              <th>Understaffed intervals</th>
            </tr>
          </thead>
          <tbody>
            {showOriginalRow ? (
              <tr className="sched-compare__row--baseline">
                <th scope="row">Original View</th>
                <td>{fmtPct(baseline.staffingPct)}</td>
                <td>{fmtPct(baseline.projectedServiceLevelPct)}</td>
                <td>{baseline.hasVolumeAht ? fmtPct(baseline.projectedServiceLevelErlangPct) : '—'}</td>
                <td>{baseline.understaffedIntervals}</td>
              </tr>
            ) : null}
            <tr className="sched-compare__row--current">
              <th scope="row">Current scheduling settings</th>
              <td>{fmtPct(current.staffingPct)}</td>
              <td>{fmtPct(current.projectedServiceLevelPct)}</td>
              <td>{current.hasVolumeAht ? fmtPct(current.projectedServiceLevelErlangPct) : '—'}</td>
              <td>{current.understaffedIntervals}</td>
            </tr>
            {suggestions.map((suggestion) => {
              const applied = appliedSuggestionOutcomes[suggestion.id]
              if (!applied) {
                return (
                  <tr key={suggestion.id} className={suggestion.highlighted ? 'sched-compare__row--highlight' : undefined}>
                    <th scope="row">{suggestion.title}</th>
                    <td colSpan={4} className="saas-muted text-xs">
                      Apply &amp; generate to view Staffing %, Projected SL, and understaffed intervals
                    </td>
                  </tr>
                )
              }
              return (
                <tr key={suggestion.id} className={suggestion.highlighted ? 'sched-compare__row--highlight' : undefined}>
                  <th scope="row">{suggestion.title}</th>
                  <td>
                    {fmtPct(applied.staffingPct)}
                    <span className={`sched-compare__delta ${deltaClass(baseline.staffingPct, applied.staffingPct, true)}`}>
                      ({fmtDelta(baseline.staffingPct, applied.staffingPct)} pts)
                    </span>
                  </td>
                  <td>
                    {fmtPct(applied.projectedServiceLevelPct)}
                    <span
                      className={`sched-compare__delta ${deltaClass(
                        baseline.projectedServiceLevelPct,
                        applied.projectedServiceLevelPct,
                        true,
                      )}`}
                    >
                      ({fmtDelta(baseline.projectedServiceLevelPct, applied.projectedServiceLevelPct)} pts)
                    </span>
                  </td>
                  <td>
                    {applied.hasVolumeAht ? (
                      <>
                        {fmtPct(applied.projectedServiceLevelErlangPct)}
                        <span
                          className={`sched-compare__delta ${deltaClass(
                            baseline.projectedServiceLevelErlangPct,
                            applied.projectedServiceLevelErlangPct,
                            true,
                          )}`}
                        >
                          ({fmtDelta(baseline.projectedServiceLevelErlangPct, applied.projectedServiceLevelErlangPct)} pts)
                        </span>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {applied.understaffedIntervals}
                    <span
                      className={`sched-compare__delta ${deltaClass(
                        baseline.understaffedIntervals,
                        applied.understaffedIntervals,
                        false,
                      )}`}
                    >
                      ({fmtDelta(baseline.understaffedIntervals, applied.understaffedIntervals)})
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {!current.hasVolumeAht ? (
        <p className="saas-muted m-0 text-xs sched-compare__note">
          Upload Volume/AHT to enable Erlang C projected service level alongside the default staffing-ratio SL.
        </p>
      ) : null}
    </section>
  )
}
