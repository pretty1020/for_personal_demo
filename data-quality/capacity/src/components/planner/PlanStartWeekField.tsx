import {
  resolveCapacityFiscalEndWeek,
  resolvePlanHorizonWeeks,
  snapToWeekStart,
} from '../../planner/capacityWeekUtils'
import type { WeekStart } from '../../planner/types'

type Props = {
  weekStart: WeekStart
  value: string
  onChange: (isoWeek: string) => void
  compact?: boolean
}

export function PlanStartWeekField({ weekStart, value, onChange, compact = false }: Props) {
  const planStart = value || snapToWeekStart(new Date(), weekStart)
  const futureEnd = resolveCapacityFiscalEndWeek(weekStart)
  const horizonWeeks = resolvePlanHorizonWeeks(planStart, weekStart)

  return (
    <label className={`saas-field${compact ? '' : ''}`}>
      <span className="saas-field__label">Capacity plan start week</span>
      {!compact ? (
        <p className="cap-panel__desc m-0 mt-1">
          First planned week in the capacity matrix. Forward horizon runs through March 2027 ({horizonWeeks}{' '}
          weeks from this date).
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
        Planned weeks: {planStart} → {futureEnd} ({horizonWeeks} weeks · fiscal year through Mar 2027)
      </p>
    </label>
  )
}
