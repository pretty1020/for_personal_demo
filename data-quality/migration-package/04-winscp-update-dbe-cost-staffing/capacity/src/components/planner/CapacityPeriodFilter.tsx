import type { CapacityPeriodMode, CapacityPeriodState } from '../../planner/capacityPeriod'
import {
  ALL_QUARTERS,
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
  const years = capacityYearOptions(weeks, state.years)
  const months = capacityMonthOptions(
    weeks.length ? weeks : state.years.map((year) => `${year}-01-01`),
  )

  const patch = (partial: Partial<CapacityPeriodState>) => {
    onChange({ ...state, ...partial })
  }

  const selectMode = (nextMode: CapacityPeriodMode) => {
    const nextMonths =
      state.months.length > 0
        ? state.months
        : [months[months.length - 1] || `${state.years[0] || new Date().getFullYear()}-01`]
    const nextYears = state.years.length ? state.years : years.slice(-1)
    const nextQuarters = state.quarters.length ? state.quarters : (['Q1'] as CalendarQuarter[])
    patch({
      mode: nextMode,
      months: nextMonths,
      years: nextYears,
      quarters: nextQuarters,
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
              <p className="cap-period-filter__hint m-0">Select one or more months to show together.</p>
              <div className="cap-period-filter__chips" role="group" aria-label="Months">
                {(months.length ? months : state.months).map((month) => (
                  <ChipToggle
                    key={month}
                    label={formatMonthLabel(month)}
                    active={state.months.includes(month)}
                    onClick={() => onChange(togglePeriodMonth(state, month))}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {state.mode === 'quarter' ? (
            <>
              <div className="cap-period-filter__multi">
                <span className="saas-field__label">Years</span>
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
              </div>
              <div className="cap-period-filter__multi">
                <span className="saas-field__label">Quarters</span>
                <p className="cap-period-filter__hint m-0">Combine any quarters across the selected years.</p>
                <div className="cap-period-filter__chips" role="group" aria-label="Quarters">
                  {ALL_QUARTERS.map((quarter) => (
                    <ChipToggle
                      key={quarter}
                      label={quarter}
                      active={state.quarters.includes(quarter)}
                      onClick={() => onChange(togglePeriodQuarter(state, quarter))}
                    />
                  ))}
                </div>
              </div>
            </>
          ) : null}

          {state.mode === 'h1' || state.mode === 'h2' || state.mode === 'full_year' ? (
            <div className="cap-period-filter__multi">
              <span className="saas-field__label">Years</span>
              <p className="cap-period-filter__hint m-0">
                {state.mode === 'full_year'
                  ? 'Select one or more years to show together.'
                  : `Select one or more years for ${state.mode.toUpperCase()}.`}
              </p>
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
            </div>
          ) : null}

          <span className="cap-period-filter__badge">{capacityPeriodLabel(state)}</span>
        </div>
      ) : null}
    </div>
  )
}
