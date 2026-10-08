import type { SchedulingMetricsMatrix } from '../../planner/scheduling/types'
import { fmtNum } from '../../planner/format'
import { clampOccupancyPct } from '../../planner/scheduling/schedulingMetrics'

type Props = {
  matrix: SchedulingMetricsMatrix
}

function fmtPct(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${value.toFixed(digits)}%`
}

function fmtOccupancyMatrix(value: number | null | undefined): string {
  const capped = clampOccupancyPct(value)
  if (capped == null) return '—'
  return `${capped.toFixed(1)}%`
}

type MatrixRow = {
  label: string
  value: string
  note: string
  highlight?: boolean
}

export function SchedulingMetricsMatrixPanel({ matrix }: Props) {
  const rows: MatrixRow[] = [
    { label: 'SLA Percent', value: fmtPct(matrix.slaPercent, 0), note: 'Input' },
    { label: 'SLA Seconds', value: String(matrix.slaSeconds), note: 'Input' },
    {
      label: 'Occupancy',
      value: fmtOccupancyMatrix(matrix.occupancyPct),
      note: matrix.hasVolumeAht ? 'Calculated per interval (Volume × AHT)' : 'Calculated per interval (Req ÷ Sched proxy)',
    },
    { label: 'Pure FTE Req', value: fmtNum(matrix.pureFteReq, 1), note: 'Required FTE', highlight: true },
    {
      label: 'Scheduled HC',
      value: fmtNum(matrix.scheduledHeadcount, 0),
      note: 'Agents with assigned shifts',
      highlight: true,
    },
    {
      label: 'Pure FTE Staff Totals',
      value: fmtNum(matrix.pureFteStaffTotals, 2),
      note: 'Week net FTE after shrinkage (staffing total)',
      highlight: true,
    },
    {
      label: 'Net FTE after shrinkage (Total)',
      value: fmtNum(matrix.netFteTotal, 2),
      note: 'Week net after lunch/break × (1 − Shrinkage Assumption %)',
      highlight: true,
    },
    {
      label: 'Shrinkage Assumption',
      value: matrix.shrinkagePct != null ? fmtPct(matrix.shrinkagePct, 1) : '—',
      note: 'Applied once: Net FTE after shrinkage = Net FTE × (1 − %)',
    },
    { label: 'SCF %', value: fmtPct(matrix.scfPct), note: 'Calculated' },
    {
      label: 'Projected Service Level',
      value: fmtPct(matrix.projectedServiceLevelPct),
      note: 'Highest of normal SL and Erlang C',
    },
  ]

  return (
    <article className="sched-matrix-card">
      <header className="sched-matrix-card__head">
        <h3 className="sched-matrix-card__title">Staffing quality matrix</h3>
        <p className="saas-muted m-0 text-xs">Inputs and calculated fields aligned to workforce planning summary.</p>
      </header>
      <div className="sched-table-wrap">
        <table className="sched-table sched-matrix-table">
          <caption>Staffing quality inputs and calculated week totals</caption>
          <thead>
            <tr>
              <th>Metric</th>
              <th>Value</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className={row.highlight ? 'sched-matrix-table__highlight' : undefined}>
                <th scope="row">{row.label}</th>
                <td className="sched-matrix-table__value">{row.value}</td>
                <td className="saas-muted text-xs">{row.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  )
}
