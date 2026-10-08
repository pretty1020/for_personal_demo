import { loadIndustryOptions } from '../../planner/clientIndustries'
import { listUsedIndustries } from '../../planner/clientRegistry'

type Props = {
  value: string
  onChange: (industry: string) => void
  /** Extra industry labels from the current page’s data. */
  extraOptions?: string[]
  className?: string
  selectClassName?: string
  id?: string
}

/** Shared Industry filter control for Home, Executive, and Financials. */
export function IndustryFilterSelect({
  value,
  onChange,
  extraOptions = [],
  className = 'cap-module-field',
  selectClassName = 'cap-module-field__select',
  id,
}: Props) {
  const options = [...new Set([...loadIndustryOptions(), ...listUsedIndustries(), ...extraOptions])]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))

  return (
    <label className={className}>
      <span className="cap-module-field__label">Industry</span>
      <select
        id={id}
        className={selectClassName}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Filter by industry"
      >
        <option value="">All industries</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  )
}
