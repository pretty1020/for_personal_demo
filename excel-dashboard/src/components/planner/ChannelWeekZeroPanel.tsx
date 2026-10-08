import { useMemo } from 'react'
import { HelpTip } from './HelpTip'
import { buildChannelStaffingPlans, getTotalStartingProductionHc } from '../../planner/channelPlanning'
import { fmtNum, fmtPct } from '../../planner/format'
import type { PlannerScenario } from '../../planner/types'
import { CHANNEL_LABELS } from '../../planner/types'

type Props = {
  scenario: PlannerScenario
  firstPlanWeekLabel?: string
  firstPlanProductionHc?: number
}

export function ChannelWeekZeroPanel({ scenario, firstPlanWeekLabel, firstPlanProductionHc }: Props) {
  const plans = useMemo(() => buildChannelStaffingPlans(scenario.assumptions, scenario.plan), [scenario])
  const showHiringSuggestions = scenario.assumptions.newHire.hiringPlanPerPeriod > 0
  const totalStarting = getTotalStartingProductionHc(scenario.assumptions, scenario.plan)
  const totalRequired = plans.reduce((s, p) => s + p.requiredHeadcount, 0)
  const totalGap = plans.reduce((s, p) => s + p.staffingGap, 0)

  if (!plans.length) return null

  return (
    <section className="cap-panel cap-panel--accent">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="cap-panel__title m-0">Week 0 · Channel starting position</h3>
        <HelpTip text="Each channel starts with its own production HC (default 0). Planned Production HC in the first planning week equals the sum of channel starting HC plus any graduates." />
      </div>
      <p className="cap-panel__desc m-0 mt-1">
        {firstPlanWeekLabel
          ? `First planning week (${firstPlanWeekLabel}): Planned Production HC = ${fmtNum(firstPlanProductionHc ?? totalStarting, 0)}.`
          : `Total starting production HC across channels: ${fmtNum(totalStarting, 0)}.`}
      </p>

      <div className="exec-kpi-grid mt-4">
        <div className="exec-kpi-card">
          <span className="exec-kpi-card__label">Total Starting HC</span>
          <strong className="exec-kpi-card__value">{fmtNum(totalStarting, 0)}</strong>
        </div>
        <div className="exec-kpi-card">
          <span className="exec-kpi-card__label">Total Required HC</span>
          <strong className="exec-kpi-card__value">{fmtNum(totalRequired, 1)}</strong>
        </div>
        <div className="exec-kpi-card">
          <span className="exec-kpi-card__label">Total Staffing Gap</span>
          <strong className="exec-kpi-card__value">{fmtNum(totalGap, 1)}</strong>
        </div>
        <div className="exec-kpi-card">
          <span className="exec-kpi-card__label">Week 0 Staffing %</span>
          <strong className="exec-kpi-card__value">
            {totalRequired > 0 ? fmtPct(totalStarting / totalRequired) : '—'}
          </strong>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
        <table className="wfp-table w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-bold uppercase text-slate-600">
            <tr>
              <th className="px-4 py-3">Channel</th>
              <th className="px-4 py-3">Starting HC</th>
              <th className="px-4 py-3">Required HC</th>
              <th className="px-4 py-3">Gap</th>
              <th className="px-4 py-3">Training</th>
              <th className="px-4 py-3">Nesting</th>
              <th className="px-4 py-3">Class Size</th>
              {showHiringSuggestions ? <th className="px-4 py-3">Suggested Weekly Starts</th> : null}
              {showHiringSuggestions ? <th className="px-4 py-3">Weeks to 100%</th> : null}
            </tr>
          </thead>
          <tbody>
            {plans.map((plan) => (
              <tr key={plan.channel} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium">{CHANNEL_LABELS[plan.channel]}</td>
                <td className="px-4 py-3">{fmtNum(plan.startingProductionHc, 0)}</td>
                <td className="px-4 py-3">{fmtNum(plan.requiredHeadcount, 1)}</td>
                <td className="px-4 py-3">{fmtNum(plan.staffingGap, 1)}</td>
                <td className="px-4 py-3">{plan.trainingWeeks} wk</td>
                <td className="px-4 py-3">{plan.nestingWeeks} wk</td>
                <td className="px-4 py-3">{plan.classSize}</td>
                {showHiringSuggestions ? (
                  <td className="px-4 py-3 font-semibold text-indigo-700">
                    {plan.suggestedWeeklyStarts > 0 ? plan.suggestedWeeklyStarts : '—'}
                  </td>
                ) : null}
                {showHiringSuggestions ? (
                  <td className="px-4 py-3">{plan.weeksToFullStaffing > 0 ? plan.weeksToFullStaffing : '—'}</td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
