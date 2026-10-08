import { KpiCard } from './KpiCard'
import { CHANNEL_FORMULA_TOOLTIPS } from '../../planner/channelPlanning'
import { fmtCurrency, fmtNum, fmtPct } from '../../planner/format'
import type { ChannelFinancialResult, ConsolidatedChannelStaffing } from '../../planner/types'
import { CHANNEL_LABELS } from '../../planner/types'
import { HelpTip } from './HelpTip'

type Props = {
  staffing?: ConsolidatedChannelStaffing
  financials?: ChannelFinancialResult[]
  showFinancials?: boolean
}

export function ChannelStaffingSummary({ staffing, financials, showFinancials = true }: Props) {
  if (!staffing?.byChannel.length) {
    return null
  }

  return (
    <section className="cap-panel cap-panel--accent">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="cap-panel__title m-0">Staffing by Channel</h3>
        <HelpTip text={CHANNEL_FORMULA_TOOLTIPS.consolidated} />
      </div>

      <div className="exec-kpi-grid mt-4">
        <KpiCard label="Total Workload Hours" value={fmtNum(staffing.totalWorkloadHours, 1)} />
        <KpiCard label="Total Required FTE" value={fmtNum(staffing.totalRequiredFte, 2)} />
        <KpiCard label="Total Required Headcount" value={fmtNum(staffing.totalRequiredHeadcount, 2)} />
        <KpiCard label="Total Forecast Volume" value={fmtNum(staffing.totalForecastVolume, 0)} />
        <KpiCard label="Weighted AHT" value={`${fmtNum(staffing.weightedAhtSeconds, 0)}s`} />
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
        <table className="wfp-table w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-bold uppercase text-slate-600">
            <tr>
              <th className="px-4 py-3">Channel</th>
              <th className="px-4 py-3">Mix %</th>
              <th className="px-4 py-3">Volume</th>
              <th className="px-4 py-3">Workload Hrs</th>
              <th className="px-4 py-3">Required FTE</th>
              <th className="px-4 py-3">Required HC</th>
              {showFinancials ? (
                <>
                  <th className="px-4 py-3">Production FTE</th>
                  <th className="px-4 py-3">Staffing Gap</th>
                  <th className="px-4 py-3">Revenue</th>
                  <th className="px-4 py-3">Labor Cost</th>
                  <th className="px-4 py-3">Gross Margin</th>
                  <th className="px-4 py-3">Utilization</th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {staffing.byChannel.map((row) => {
              const fin = financials?.find((f) => f.channel === row.channel)
              return (
                <tr key={row.channel} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium">{CHANNEL_LABELS[row.channel]}</td>
                  <td className="px-4 py-3">{fmtPct(row.channelMixPct)}</td>
                  <td className="px-4 py-3">{fmtNum(row.forecastVolume, 0)}</td>
                  <td className="px-4 py-3">{fmtNum(row.workloadHours, 1)}</td>
                  <td className="px-4 py-3">{fmtNum(row.requiredFte, 2)}</td>
                  <td className="px-4 py-3">{fmtNum(row.requiredHeadcount, 2)}</td>
                  {showFinancials && fin ? (
                    <>
                      <td className="px-4 py-3">{fmtNum(fin.productionFte, 2)}</td>
                      <td className="px-4 py-3">{fmtNum(fin.staffingGap, 2)}</td>
                      <td className="px-4 py-3">{fmtCurrency(fin.revenue)}</td>
                      <td className="px-4 py-3">{fmtCurrency(fin.laborCost)}</td>
                      <td className="px-4 py-3">{fmtCurrency(fin.grossMargin)}</td>
                      <td className="px-4 py-3">{fmtPct(fin.capacityUtilization)}</td>
                    </>
                  ) : showFinancials ? (
                    <>
                      <td className="px-4 py-3">—</td>
                      <td className="px-4 py-3">—</td>
                      <td className="px-4 py-3">—</td>
                      <td className="px-4 py-3">—</td>
                      <td className="px-4 py-3">—</td>
                      <td className="px-4 py-3">—</td>
                    </>
                  ) : null}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
