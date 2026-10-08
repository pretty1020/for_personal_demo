import { CapacityPeriodFilter } from '../planner/CapacityPeriodFilter'
import type { CapacityPeriodState } from '../../planner/capacityPeriod'
import { saveDbePeriod } from '../../planner/dbe/dbePeriodFilter'

type Props = {
  state: CapacityPeriodState
  onChange: (next: CapacityPeriodState) => void
  fiscalMonths: string[]
  className?: string
}

/** DBE period filter — Monthly, Quarterly, H1, H2, Yearly (matches Staffing plan). */
export function DbePeriodFilter({ state, onChange, fiscalMonths, className = '' }: Props) {
  const weekAnchors = fiscalMonths.map((month) => `${month}-07`)

  return (
    <CapacityPeriodFilter
      state={state}
      onChange={(next) => {
        onChange(next)
        saveDbePeriod(next)
      }}
      weeks={weekAnchors}
      className={`cap-dbe-period ${className}`.trim()}
      modes={['month', 'quarter', 'h1', 'h2', 'full_year']}
      compact
    />
  )
}
