import { useState } from 'react'
import { HelpTip } from './HelpTip'
import { KpiCard } from './KpiCard'
import { NumField } from './NumField'
import {
  CHANNEL_FORMULA_TOOLTIPS,
  calculateChannelStaffing,
  isOccupancyChannel,
  isProductivityChannel,
  suggestChannelWeeklyClasses,
} from '../../planner/channelPlanning'
import { fmtNum, fmtPct } from '../../planner/format'
import type { ChannelAssumptions, ChannelType } from '../../planner/types'
import { CHANNEL_LABELS, CHANNEL_VOLUME_LABELS } from '../../planner/types'

type Props = {
  supportedChannels: ChannelType[]
  channels: Partial<Record<ChannelType, ChannelAssumptions>>
  onChange: (channels: Partial<Record<ChannelType, ChannelAssumptions>>) => void
  showResults?: boolean
}

function patchChannel(
  channels: Partial<Record<ChannelType, ChannelAssumptions>>,
  channel: ChannelType,
  field: keyof ChannelAssumptions,
  value: number,
): Partial<Record<ChannelType, ChannelAssumptions>> {
  return {
    ...channels,
    [channel]: {
      ...(channels[channel] ?? {}),
      [field]: value,
    } as ChannelAssumptions,
  }
}

export function ChannelAssumptionsPanel({ supportedChannels, channels, onChange, showResults = true }: Props) {
  const [activeTab, setActiveTab] = useState<ChannelType>(supportedChannels[0] ?? 'voice')

  if (!supportedChannels.length) {
    return <p className="saas-muted">Select at least one channel to configure assumptions.</p>
  }

  const activeChannel = supportedChannels.includes(activeTab) ? activeTab : supportedChannels[0]!
  const activeAssumptions = channels[activeChannel]

  if (!activeAssumptions) {
    return <p className="saas-muted">Channel assumptions not initialized.</p>
  }

  const staffing = calculateChannelStaffing(activeChannel, activeAssumptions)
  const staffingPlan = suggestChannelWeeklyClasses(activeChannel, activeAssumptions, staffing)
  const productiveFormula = isOccupancyChannel(activeChannel)
    ? activeChannel === 'chat'
      ? CHANNEL_FORMULA_TOOLTIPS.productiveChat
      : CHANNEL_FORMULA_TOOLTIPS.productiveVoice
    : CHANNEL_FORMULA_TOOLTIPS.productiveAsync

  return (
    <section className="cap-panel">
      <h3 className="cap-panel__title">Channel assumptions</h3>
      <p className="cap-panel__desc m-0 mt-1">
        Each channel uses a direct workload methodology. Configure assumptions per channel, then view consolidated staffing below.
      </p>

      <div className="channel-tabs mt-4" role="tablist">
        {supportedChannels.map((channel) => (
          <button
            key={channel}
            type="button"
            role="tab"
            aria-selected={activeChannel === channel}
            className={`channel-tabs__tab${activeChannel === channel ? ' channel-tabs__tab--active' : ''}`}
            onClick={() => setActiveTab(channel)}
          >
            {CHANNEL_LABELS[channel]}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="tabpanel">
        <NumField
          label={CHANNEL_VOLUME_LABELS[activeChannel]}
          help={CHANNEL_FORMULA_TOOLTIPS.workloadHours}
          value={activeAssumptions.forecastVolume}
          onChange={(v) => onChange(patchChannel(channels, activeChannel, 'forecastVolume', v))}
          step={100}
          min={0}
        />
        <NumField
          label={
            activeChannel === 'video'
              ? 'Average Session Time (sec)'
              : isProductivityChannel(activeChannel)
                ? 'Average Processing Time (sec)'
                : 'Average Handle Time (sec)'
          }
          help={CHANNEL_FORMULA_TOOLTIPS.workloadHours}
          value={activeAssumptions.ahtSeconds}
          onChange={(v) => onChange(patchChannel(channels, activeChannel, 'ahtSeconds', v))}
          step={5}
          min={10}
        />
        <NumField
          label="Paid Hours per FTE (weekly)"
          value={activeAssumptions.paidHoursPerFte}
          onChange={(v) => onChange(patchChannel(channels, activeChannel, 'paidHoursPerFte', v))}
          step={0.5}
          min={20}
          max={60}
        />
        {isOccupancyChannel(activeChannel) ? (
          <NumField
            label="Occupancy / Utilization Target"
            help={productiveFormula}
            value={activeAssumptions.occupancyTarget}
            onChange={(v) => onChange(patchChannel(channels, activeChannel, 'occupancyTarget', v))}
            step={0.01}
            min={0.5}
            max={1}
          />
        ) : null}
        {isProductivityChannel(activeChannel) ? (
          <NumField
            label="Productivity %"
            help={productiveFormula}
            value={activeAssumptions.productivityPct}
            onChange={(v) => onChange(patchChannel(channels, activeChannel, 'productivityPct', v))}
            step={0.01}
            min={0}
            max={1.2}
          />
        ) : null}
        {activeChannel === 'chat' ? (
          <NumField
            label="Chat Concurrency"
            help="Number of simultaneous chats per agent."
            value={activeAssumptions.chatConcurrency}
            onChange={(v) => onChange(patchChannel(channels, activeChannel, 'chatConcurrency', v))}
            step={0.1}
            min={1}
            max={6}
          />
        ) : null}
        <NumField
          label="Shrinkage %"
          help={CHANNEL_FORMULA_TOOLTIPS.requiredHeadcount}
          value={activeAssumptions.shrinkagePct}
          onChange={(v) => onChange(patchChannel(channels, activeChannel, 'shrinkagePct', v))}
          step={0.01}
          min={0}
          max={0.6}
        />
        <NumField
          label="Channel Mix %"
          help="Share of total LOB volume for this channel."
          value={activeAssumptions.channelMixPct}
          onChange={(v) => onChange(patchChannel(channels, activeChannel, 'channelMixPct', v))}
          step={0.01}
          min={0}
          max={1}
        />
        <NumField
          label="Revenue per Contact ($)"
          value={activeAssumptions.revenuePerContact}
          onChange={(v) => onChange(patchChannel(channels, activeChannel, 'revenuePerContact', v))}
          step={0.1}
          min={0}
        />
      </div>

      <div className="mt-6">
        <h4 className="m-0 text-sm font-semibold text-slate-800">Starting headcount & training pipeline</h4>
        <p className="cap-panel__desc m-0 mt-1">Each channel has its own starting production HC and training settings.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NumField
            label="Starting Production HC"
            help="Week 0 production headcount for this channel. Defaults to 0 for new plans."
            value={activeAssumptions.startingProductionHc}
            onChange={(v) => onChange(patchChannel(channels, activeChannel, 'startingProductionHc', v))}
            step={1}
            min={0}
          />
          <NumField
            label="Training duration (weeks)"
            value={activeAssumptions.trainingWeeks}
            onChange={(v) => onChange(patchChannel(channels, activeChannel, 'trainingWeeks', v))}
            step={1}
            min={1}
          />
          <NumField
            label="Nesting duration (weeks)"
            value={activeAssumptions.nestingWeeks}
            onChange={(v) => onChange(patchChannel(channels, activeChannel, 'nestingWeeks', v))}
            step={1}
            min={1}
          />
          <NumField
            label="Class size"
            value={activeAssumptions.classSize}
            onChange={(v) => onChange(patchChannel(channels, activeChannel, 'classSize', v))}
            step={1}
            min={1}
          />
          <NumField
            label="Training attrition %"
            value={activeAssumptions.trainingAttritionRate}
            onChange={(v) => onChange(patchChannel(channels, activeChannel, 'trainingAttritionRate', v))}
            step={0.1}
            min={0}
            max={0.5}
            percent
          />
          <NumField
            label="Nesting attrition %"
            value={activeAssumptions.nestingAttritionRate}
            onChange={(v) => onChange(patchChannel(channels, activeChannel, 'nestingAttritionRate', v))}
            step={0.1}
            min={0}
            max={0.5}
            percent
          />
          <NumField
            label="Graduation rate %"
            help="Enter 90 for 90%. Surviving share of nesting that graduates to production."
            value={activeAssumptions.graduationRate}
            onChange={(v) => onChange(patchChannel(channels, activeChannel, 'graduationRate', v))}
            step={1}
            min={0}
            max={1}
            percent
          />
          <NumField
            label="Nesting phone time %"
            value={activeAssumptions.nestingPhoneTimePct}
            onChange={(v) => onChange(patchChannel(channels, activeChannel, 'nestingPhoneTimePct', v))}
            step={1}
            min={0}
            max={1}
            percent
          />
        </div>
      </div>

      {showResults ? (
        <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="m-0 text-sm font-semibold text-slate-800">
              {CHANNEL_LABELS[activeChannel]} staffing calculation
            </h4>
            <HelpTip text={`${CHANNEL_FORMULA_TOOLTIPS.workloadHours} · ${productiveFormula} · ${CHANNEL_FORMULA_TOOLTIPS.requiredFte} · ${CHANNEL_FORMULA_TOOLTIPS.requiredHeadcount}`} />
          </div>
          <div className="exec-kpi-grid mt-3">
            <KpiCard label="Workload Hours" value={fmtNum(staffing.workloadHours, 1)} />
            <KpiCard label="Productive Hrs / FTE" value={fmtNum(staffing.productiveHoursPerFte, 2)} />
            <KpiCard label="Required FTE" value={fmtNum(staffing.requiredFte, 2)} />
            <KpiCard label="Required Headcount" value={fmtNum(staffing.requiredHeadcount, 2)} />
            <KpiCard label="Channel Mix" value={fmtPct(staffing.channelMixPct)} />
            <KpiCard
              label="Suggested Weekly Starts"
              value={staffingPlan.suggestedWeeklyStarts > 0 ? fmtNum(staffingPlan.suggestedWeeklyStarts, 0) : '—'}
            />
            <KpiCard
              label="Weeks to 100% Staffing"
              value={staffingPlan.weeksToFullStaffing > 0 ? fmtNum(staffingPlan.weeksToFullStaffing, 0) : '—'}
            />
          </div>
        </div>
      ) : null}
    </section>
  )
}
