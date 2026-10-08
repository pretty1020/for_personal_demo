import { CHANNEL_LABELS, type ChannelType } from '../../planner/types'
import type { FinancialLobOption } from '../../planner/capacityFinancialScope'
import type { CalendarQuarter, PeriodView } from '../../utils/executiveQuarter'
import { IndustryFilterSelect } from '../filters/IndustryFilterSelect'

export type FinancialFilterCardProps = {
  fiscalYear: string
  yearOptions: string[]
  onFiscalYearChange: (year: string) => void
  periodView: PeriodView
  onPeriodViewChange: (view: PeriodView) => void
  month: string
  monthOptions: string[]
  onMonthChange: (month: string) => void
  quarter: CalendarQuarter | ''
  onQuarterChange: (quarter: CalendarQuarter | '') => void
  client: string
  clients: string[]
  onClientChange: (client: string) => void
  industry: string
  onIndustryChange: (industry: string) => void
  location: string
  locations: string[]
  onLocationChange: (location: string) => void
  lobId: string
  lobs: FinancialLobOption[]
  onLobChange: (lobId: string) => void
  channel: ChannelType | ''
  channels: ChannelType[]
  onChannelChange: (channel: ChannelType | '') => void
  showNextYear: boolean
  onToggleNextYear: () => void
}

const PERIOD_OPTIONS: Array<{ value: PeriodView; label: string }> = [
  { value: 'full_year', label: 'Full year (weekly)' },
  { value: 'month', label: 'Monthly' },
  { value: 'quarter', label: 'Quarterly' },
  { value: 'h1', label: 'H1 (Jan–Jun)' },
  { value: 'h2', label: 'H2 (Jul–Dec)' },
]

const QUARTERS: CalendarQuarter[] = ['Q1', 'Q2', 'Q3', 'Q4']

function formatMonthOption(month: string): string {
  if (month.length < 7) return month
  const date = new Date(`${month}-01T12:00:00`)
  if (Number.isNaN(date.getTime())) return month
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

export function FinancialFilterCard({
  fiscalYear,
  yearOptions,
  onFiscalYearChange,
  periodView,
  onPeriodViewChange,
  month,
  monthOptions,
  onMonthChange,
  quarter,
  onQuarterChange,
  client,
  clients,
  onClientChange,
  industry,
  onIndustryChange,
  location,
  locations,
  onLocationChange,
  lobId,
  lobs,
  onLobChange,
  channel,
  channels,
  onChannelChange,
  showNextYear,
  onToggleNextYear,
}: FinancialFilterCardProps) {
  const nextYear = String(Number(fiscalYear) + 1)
  const monthsForYear = monthOptions.filter((item) => item.startsWith(fiscalYear) || item.length < 4)

  return (
    <div className="cap-module-filter-shell">
      <div className="cap-module-filters cap-module-filters--row saas-card cap-revproj__toolbar">
        <label className="cap-module-field">
          <span className="cap-module-field__label">Period</span>
          <select
            className="cap-module-field__select"
            value={periodView}
            onChange={(event) => onPeriodViewChange(event.target.value as PeriodView)}
          >
            {PERIOD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="cap-module-field">
          <span className="cap-module-field__label">Fiscal year (Jan–Dec)</span>
          <select
            className="cap-module-field__select"
            value={fiscalYear}
            onChange={(event) => onFiscalYearChange(event.target.value)}
          >
            {yearOptions.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>
        {periodView === 'month' ? (
          <label className="cap-module-field">
            <span className="cap-module-field__label">Month</span>
            <select
              className="cap-module-field__select"
              value={month}
              onChange={(event) => onMonthChange(event.target.value)}
            >
              <option value="">Select month</option>
              {(monthsForYear.length ? monthsForYear : monthOptions).map((item) => (
                <option key={item} value={item}>
                  {formatMonthOption(item)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {periodView === 'quarter' ? (
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
        <IndustryFilterSelect value={industry} onChange={onIndustryChange} className="cap-module-field" />
        <label className="cap-module-field cap-module-field--wide">
          <span className="cap-module-field__label">Client</span>
          <select
            className="cap-module-field__select"
            value={client}
            onChange={(event) => onClientChange(event.target.value)}
          >
            <option value="">All clients</option>
            {clients.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="cap-module-field cap-module-field--wide">
          <span className="cap-module-field__label">Site</span>
          <select
            className="cap-module-field__select"
            value={location}
            onChange={(event) => onLocationChange(event.target.value)}
          >
            <option value="">All sites</option>
            {locations.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="cap-module-field cap-module-field--wide">
          <span className="cap-module-field__label">LOB</span>
          <select
            className="cap-module-field__select"
            value={lobId}
            onChange={(event) => onLobChange(event.target.value)}
          >
            <option value="">All LOBs</option>
            {lobs.map((item) => (
              <option key={item.id} value={item.id}>
                {client ? item.lob : `${item.client} · ${item.lob}`}
              </option>
            ))}
          </select>
        </label>
        {channels.length > 0 ? (
          <label className="cap-module-field">
            <span className="cap-module-field__label">Channel</span>
            <select
              className="cap-module-field__select"
              value={channel}
              onChange={(event) => onChannelChange((event.target.value || '') as ChannelType | '')}
            >
              <option value="">All channels</option>
              {channels.map((item) => (
                <option key={item} value={item}>
                  {CHANNEL_LABELS[item]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {periodView === 'full_year' ? (
          <button
            type="button"
            className="cap-revproj__year-expand"
            aria-expanded={showNextYear}
            onClick={onToggleNextYear}
          >
            {showNextYear ? `Hide next year (${nextYear})` : `Show next year (${nextYear})`}
          </button>
        ) : null}
      </div>
    </div>
  )
}
