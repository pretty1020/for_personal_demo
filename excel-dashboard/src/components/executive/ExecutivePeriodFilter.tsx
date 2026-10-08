import type { CalendarQuarter, PeriodView } from '../../utils/executiveQuarter'

export type ExecutivePeriodKind = PeriodView | 'custom'

export type ExecutivePeriodFilterProps = {
  periodKind: ExecutivePeriodKind
  onPeriodKindChange: (kind: ExecutivePeriodKind) => void
  calendarYear: string
  yearOptions: string[]
  onCalendarYearChange: (year: string) => void
  month: string
  monthOptions: string[]
  onMonthChange: (month: string) => void
  quarter: CalendarQuarter | ''
  onQuarterChange: (quarter: CalendarQuarter | '') => void
  weekStart: string
  weekEnd: string
  weekOptions: string[]
  onWeekStartChange: (week: string) => void
  onWeekEndChange: (week: string) => void
  rangeLabel: string
}

const PERIOD_OPTIONS: Array<{ value: ExecutivePeriodKind; label: string }> = [
  { value: 'full_year', label: 'Full year' },
  { value: 'h1', label: 'H1 (Jan–Jun)' },
  { value: 'h2', label: 'H2 (Jul–Dec)' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'month', label: 'Month' },
  { value: 'custom', label: 'Custom weeks' },
]

const QUARTERS: CalendarQuarter[] = ['Q1', 'Q2', 'Q3', 'Q4']

function formatMonthOption(month: string): string {
  if (month.length < 7) return month
  const date = new Date(`${month}-01T12:00:00`)
  if (Number.isNaN(date.getTime())) return month
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

export function ExecutivePeriodFilter({
  periodKind,
  onPeriodKindChange,
  calendarYear,
  yearOptions,
  onCalendarYearChange,
  month,
  monthOptions,
  onMonthChange,
  quarter,
  onQuarterChange,
  weekStart,
  weekEnd,
  weekOptions,
  onWeekStartChange,
  onWeekEndChange,
  rangeLabel,
}: ExecutivePeriodFilterProps) {
  return (
    <div className="cap-module-filter-shell">
      <div className="cap-module-filters cap-module-filters--row saas-card portfolio-exec__period">
        <label className="cap-module-field">
          <span className="cap-module-field__label">Period</span>
          <select
            className="cap-module-field__select"
            value={periodKind}
            onChange={(event) => onPeriodKindChange(event.target.value as ExecutivePeriodKind)}
          >
            {PERIOD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {periodKind !== 'custom' ? (
          <label className="cap-module-field">
            <span className="cap-module-field__label">Year</span>
            <select
              className="cap-module-field__select"
              value={calendarYear}
              onChange={(event) => onCalendarYearChange(event.target.value)}
            >
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {periodKind === 'quarter' ? (
          <label className="cap-module-field">
            <span className="cap-module-field__label">Quarter</span>
            <select
              className="cap-module-field__select"
              value={quarter}
              onChange={(event) => onQuarterChange((event.target.value || '') as CalendarQuarter | '')}
            >
              {QUARTERS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {periodKind === 'month' ? (
          <label className="cap-module-field">
            <span className="cap-module-field__label">Month</span>
            <select
              className="cap-module-field__select"
              value={month}
              onChange={(event) => onMonthChange(event.target.value)}
            >
              <option value="">Select month</option>
              {monthOptions.map((item) => (
                <option key={item} value={item}>
                  {formatMonthOption(item)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {periodKind === 'custom' ? (
          <>
            <label className="cap-module-field cap-module-field--wide">
              <span className="cap-module-field__label">From week</span>
              <select
                className="cap-module-field__select"
                value={weekStart}
                onChange={(event) => onWeekStartChange(event.target.value)}
              >
                <option value="">Start</option>
                {weekOptions.map((week) => (
                  <option key={`from-${week}`} value={week}>
                    {week}
                  </option>
                ))}
              </select>
            </label>
            <label className="cap-module-field cap-module-field--wide">
              <span className="cap-module-field__label">To week</span>
              <select
                className="cap-module-field__select"
                value={weekEnd}
                onChange={(event) => onWeekEndChange(event.target.value)}
              >
                <option value="">End</option>
                {weekOptions.map((week) => (
                  <option key={`to-${week}`} value={week}>
                    {week}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}
        <p className="portfolio-exec__period-range m-0">{rangeLabel}</p>
      </div>
    </div>
  )
}
