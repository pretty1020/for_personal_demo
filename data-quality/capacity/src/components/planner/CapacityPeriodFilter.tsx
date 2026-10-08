import type { CapacityPeriodMode, CapacityPeriodState } from '../../planner/capacityPeriod'
import {
  CAPACITY_PERIOD_OPTIONS,
  capacityMonthOptions,
  capacityPeriodLabel,
  capacityYearOptions,
  formatMonthLabel,
  togglePeriodMonth,
  togglePeriodQuarter,
  togglePeriodYear,
} from '../../planner/capacityPeriod'
import type { CalendarQuarter } from '../../utils/executiveQuarter'

function quartersPresentInWeeks(weeks: string[]): CalendarQuarter[] {
  const present = new Set<CalendarQuarter>()
  for (const week of weeks) {
    if (week.length < 7) continue
    const month = Number.parseInt(week.slice(5, 7), 10)
    if (!Number.isFinite(month)) continue
    if (month <= 3) present.add('Q1')
    else if (month <= 6) present.add('Q2')
    else if (month <= 9) present.add('Q3')
    else present.add('Q4')
  }
  return (['Q1', 'Q2', 'Q3', 'Q4'] as CalendarQuarter[]).filter((quarter) => present.has(quarter))
}

type Props = {
  state: CapacityPeriodState
  onChange: (next: CapacityPeriodState) => void
  weeks: string[]
  className?: string
  compact?: boolean
  modes?: CapacityPeriodMode[]
}

function ChipToggle({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`cap-period-filter__chip${active ? ' is-active' : ''}`}
      aria-pressed={active}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

export function CapacityPeriodFilter({
  state,
  onChange,
  weeks,
  className = '',
  compact = false,
  modes,
}: Props) {
  const modeOptions = modes?.length
    ? CAPACITY_PERIOD_OPTIONS.filter((option) => modes.includes(option.value))
    : CAPACITY_PERIOD_OPTIONS
  // Only months/years derived from configured plan weeks — never invent calendars.
  const years = capacityYearOptions(weeks)
  const months = capacityMonthOptions(weeks)
  const quarterOptions = weeks.length ? quartersPresentInWeeks(weeks) : ([] as CalendarQuarter[])

  const patch = (partial: Partial<CapacityPeriodState>) => {
    onChange({ ...state, ...partial })
  }

  const selectMode = (nextMode: CapacityPeriodMode) => {
    let nextMonths =
      nextMode === 'month'
        ? state.months.filter((month) => months.includes(month.slice(0, 7)))
        : state.months
    // Switching into Monthly with no valid selection → pick the first plan month, not every month.
    if (nextMode === 'month' && !nextMonths.length && months[0]) {
      nextMonths = [months[0]]
    }
    let nextYears = state.years.filter((year) => years.includes(year))
    if (
      (nextMode === 'quarter' || nextMode === 'h1' || nextMode === 'h2' || nextMode === 'full_year') &&
      !nextYears.length &&
      years[0]
    ) {
      nextYears = [years[0]]
    }
    const nextQuarters =
      nextMode === 'quarter'
        ? state.quarters.filter((quarter) => quarterOptions.includes(quarter))
        : state.quarters
    const resolvedQuarters =
      nextMode === 'quarter' && !nextQuarters.length && quarterOptions[0]
        ? [quarterOptions[0]]
        : nextQuarters
    patch({
      mode: nextMode,
      months: nextMonths,
      years: nextYears,
      quarters: resolvedQuarters,
    })
  }

  return (
    <div className={`cap-period-filter${compact ? ' cap-period-filter--compact' : ''} ${className}`.trim()}>
      <div className="cap-period-filter__modes" role="group" aria-label="Period view">
        {modeOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            className={[
              'cap-period-filter__mode',
              option.value === 'weekly' ? 'cap-period-filter__mode--weekly' : '',
              state.mode === option.value ? 'is-active' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => selectMode(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {state.mode !== 'weekly' ? (
        <div className="cap-period-filter__controls">
          {state.mode === 'month' ? (
            <div className="cap-period-filter__multi">
              <span className="saas-field__label">Months</span>
              <p className="cap-period-filter__hint m-0">Select one or more months from this plan.</p>
              {months.length ? (
                <div className="cap-period-filter__chips" role="group" aria-label="Months">
                  {months.map((month) => (
                    <ChipToggle
                      key={month}
                      label={formatMonthLabel(month)}
                      active={state.months.includes(month)}
                      onClick={() => onChange(togglePeriodMonth(state, month))}
                    />
                  ))}
                </div>
              ) : (
                <p className="cap-period-filter__empty m-0" role="status">
                  No months configured on this plan yet. Add weeks or import data first.
                </p>
              )}
            </div>
          ) : null}

          {state.mode === 'quarter' ? (
            <>
              <div className="cap-period-filter__multi">
                <span className="saas-field__label">Years</span>
                {years.length ? (
                  <div className="cap-period-filter__chips" role="group" aria-label="Years">
                    {years.map((year) => (
                      <ChipToggle
                        key={year}
                        label={year}
                        active={state.years.includes(year)}
                        onClick={() => onChange(togglePeriodYear(state, year))}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="cap-period-filter__empty m-0" role="status">
                    No years configured on this plan yet.
                  </p>
                )}
              </div>
              <div className="cap-period-filter__multi">
                <span className="saas-field__label">Quarters</span>
                <p className="cap-period-filter__hint m-0">Combine any quarters across the selected years.</p>
                {quarterOptions.length ? (
                  <div className="cap-period-filter__chips" role="group" aria-label="Quarters">
                    {quarterOptions.map((quarter) => (
                      <ChipToggle
                        key={quarter}
                        label={quarter}
                        active={state.quarters.includes(quarter)}
                        onClick={() => onChange(togglePeriodQuarter(state, quarter))}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="cap-period-filter__empty m-0" role="status">
                    No quarters available from plan weeks.
                  </p>
                )}
              </div>
            </>
          ) : null}

          {state.mode === 'h1' || state.mode === 'h2' || state.mode === 'full_year' ? (
            <div className="cap-period-filter__multi">
              <span className="saas-field__label">Years</span>
              <p className="cap-period-filter__hint m-0">
                {state.mode === 'full_year'
                  ? 'Select one or more years from this plan.'
                  : `Select one or more plan years for ${state.mode.toUpperCase()}.`}
              </p>
              {years.length ? (
                <div className="cap-period-filter__chips" role="group" aria-label="Years">
                  {years.map((year) => (
                    <ChipToggle
                      key={year}
                      label={year}
                      active={state.years.includes(year)}
                      onClick={() => onChange(togglePeriodYear(state, year))}
                    />
                  ))}
                </div>
              ) : (
                <p className="cap-period-filter__empty m-0" role="status">
                  No years configured on this plan yet.
                </p>
              )}
            </div>
          ) : null}

          <span className="cap-period-filter__badge">{capacityPeriodLabel(state)}</span>
        </div>
      ) : null}
    </div>
  )
}
