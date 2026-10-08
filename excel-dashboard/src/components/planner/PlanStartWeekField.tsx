import { addWeeks, defaultCapacityPlanStartWeek, isoDate, snapToWeekStart } from '../../planner/capacityWeekUtils'
import { MAX_FUTURE_WEEKS } from '../../planner/capacityMatrixTheme'
import type { WeekStart } from '../../planner/types'

type Props = {
  weekStart: WeekStart
  value: string
  onChange: (isoWeek: string) => void
  compact?: boolean
  /** IANA timezone used when defaulting the start week to “this week”. */
  timeZone?: string | null
}

export function PlanStartWeekField({ weekStart, value, onChange, compact = false, timeZone }: Props) {
  const planStart = value || defaultCapacityPlanStartWeek(weekStart, timeZone)
  const futureEnd = isoDate(addWeeks(new Date(`${planStart}T12:00:00`), MAX_FUTURE_WEEKS - 1))

  return (
    <label className={`saas-field${compact ? '' : ''}`}>
      <span className="saas-field__label">Capacity plan start week</span>
      {!compact ? (
        <p className="cap-panel__desc m-0 mt-1">
          First planned week in the capacity matrix. View includes {MAX_FUTURE_WEEKS} weeks from this date.
        </p>
      ) : null}
      <input
        className="cap-field__input mt-2"
        type="date"
        value={planStart}
        onChange={(event) => {
          const next = event.target.value
          if (!next) return
          onChange(snapToWeekStart(next, weekStart))
        }}
      />
      <p className="cap-panel__desc m-0 mt-2">
        Planned weeks: {planStart} → {futureEnd} ({MAX_FUTURE_WEEKS} weeks)
      </p>
    </label>
  )
}
