import { OPERATING_DAYS, type OperatingDay } from '../../planner/advancedForecastPersistence'

/**
 * Which days of the week the client actually operates.
 *
 * Many accounts are weekdays only. Without this the models see the closed days
 * as genuine zeros and learn a weekly pattern that is really an opening
 * schedule, then forecast staffing for days nobody works.
 *
 * Seven small toggles rather than a dropdown: the whole week fits on one line,
 * and the shape of the schedule is readable at a glance.
 */

const SHORT: Record<OperatingDay, string> = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
  sunday: 'Sun',
}

const PRESETS: Array<[string, OperatingDay[]]> = [
  ['Mon–Fri', ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']],
  ['Mon–Sat', ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']],
  ['All week', [...OPERATING_DAYS]],
]

type Props = {
  selected: OperatingDay[]
  onChange: (days: OperatingDay[]) => void
  disabled?: boolean
}

export function OperatingDaysPicker({ selected, onChange, disabled }: Props) {
  const toggle = (day: OperatingDay) => {
    const next = selected.includes(day)
      ? selected.filter((item) => item !== day)
      : // Keep calendar order regardless of click order, so the row always reads
        // Monday to Sunday.
        OPERATING_DAYS.filter((item) => item === day || selected.includes(item))
    onChange(next)
  }

  const matchesPreset = (days: OperatingDay[]) =>
    days.length === selected.length && days.every((day) => selected.includes(day))

  return (
    <div className="cap-operating-days">
      <div className="cap-operating-days__row" role="group" aria-label="Operating days">
        {OPERATING_DAYS.map((day) => {
          const on = selected.includes(day)
          return (
            <button
              key={day}
              type="button"
              disabled={disabled}
              aria-pressed={on}
              className={`cap-operating-days__day${on ? ' cap-operating-days__day--on' : ''}`}
              onClick={() => toggle(day)}
            >
              {SHORT[day]}
            </button>
          )
        })}
      </div>
      <div className="cap-operating-days__presets">
        {PRESETS.map(([label, days]) => (
          <button
            key={label}
            type="button"
            disabled={disabled}
            className={`cap-operating-days__preset${matchesPreset(days) ? ' cap-operating-days__preset--on' : ''}`}
            onClick={() => onChange([...days])}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
