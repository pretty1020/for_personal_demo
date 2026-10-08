import { useEffect, useState } from 'react'
import { HelpTip } from './HelpTip'
import { KpiCard } from './KpiCard'
import { NumField } from './NumField'
import {
  CHANNEL_FORMULA_TOOLTIPS,
  calculateChannelStaffing,
  getChannelRequiredDriverFields,
  isOccupancyChannel,
  type ChannelDriverValidationIssue,
} from '../../planner/channelPlanning'
import { fmtNum, fmtPct } from '../../planner/format'
import type { ChannelAssumptions, ChannelType } from '../../planner/types'
import { CHANNEL_LABELS } from '../../planner/types'

type Props = {
  supportedChannels: ChannelType[]
  channels: Partial<Record<ChannelType, ChannelAssumptions>>
  onChange: (channels: Partial<Record<ChannelType, ChannelAssumptions>>) => void
  validationIssues?: ChannelDriverValidationIssue[]
  compact?: boolean
  defaultPaidHours?: number
  /** When true, forecast volume and AHT are optional (FTE billing). */
  fteBilling?: boolean
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

function hasIssue(
  issues: ChannelDriverValidationIssue[] | undefined,
  channel: ChannelType,
  field: keyof ChannelAssumptions,
): boolean {
  return Boolean(issues?.some((issue) => issue.channel === channel && issue.field === field))
}

export function ChannelCapacityDriversPanel({
  supportedChannels,
  channels,
  onChange,
  validationIssues,
  compact = false,
  defaultPaidHours = 40,
  fteBilling = false,
}: Props) {
  const [activeTab, setActiveTab] = useState<ChannelType>(supportedChannels[0] ?? 'voice')

  useEffect(() => {
    if (!supportedChannels.includes(activeTab) && supportedChannels[0]) {
      setActiveTab(supportedChannels[0])
    }
  }, [activeTab, supportedChannels])

  if (!supportedChannels.length) {
    return <p className="saas-muted">Select at least one channel to enter capacity drivers.</p>
  }

  const activeChannel = supportedChannels.includes(activeTab) ? activeTab : supportedChannels[0]!
  const activeAssumptions = channels[activeChannel]

  if (!activeAssumptions) {
    return <p className="saas-muted">Channel drivers not initialized.</p>
  }

  const effectiveAssumptions: ChannelAssumptions = {
    ...activeAssumptions,
    paidHoursPerFte:
      activeAssumptions.paidHoursPerFte > 0 ? activeAssumptions.paidHoursPerFte : defaultPaidHours,
  }
  const staffing = calculateChannelStaffing(activeChannel, effectiveAssumptions)
  const requiredFields = getChannelRequiredDriverFields(activeChannel)
  const productiveFormula =
    activeChannel === 'chat'
      ? CHANNEL_FORMULA_TOOLTIPS.productiveChat
      : isOccupancyChannel(activeChannel)
        ? CHANNEL_FORMULA_TOOLTIPS.productiveVoice
        : CHANNEL_FORMULA_TOOLTIPS.productiveAsync

  const renderField = (field: keyof ChannelAssumptions, label: string, options: {
    step?: number
    min?: number
    max?: number
    help?: string
    optional?: boolean
    percent?: boolean
  }) => (
    <NumField
      key={field}
      label={`${label}${options.optional ? ' (optional)' : ' *'}`}
      help={options.help}
      value={activeAssumptions[field] as number}
      onChange={(value) => onChange(patchChannel(channels, activeChannel, field, value))}
      step={options.step}
      min={options.min}
      max={options.max}
      percent={options.percent}
    />
  )

  return (
    <section className={compact ? 'cap-capacity-channel-drivers cap-capacity-channel-drivers--compact' : 'cap-panel'}>
      {!compact ? (
        <>
          <h3 className="cap-panel__title">Channel capacity drivers</h3>
          <p className="cap-panel__desc m-0 mt-1">
            {fteBilling
              ? 'Per FTE billing: enter Required Production FTE for Week 1 below. Volume, AHT, and occupancy are not used.'
              : 'Enter the required workload inputs for each channel. Required FTE is calculated per channel, then summed for the LOB.'}
          </p>
        </>
      ) : (
        <p className="cap-panel__desc m-0">
          Required inputs per channel for FTE. Chat uses forecasted chats, AHT, occupancy, and concurrency.
        </p>
      )}

      <div className={`channel-tabs${compact ? ' mt-3' : ' mt-4'}`} role="tablist">
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

      <div className={`grid gap-3 sm:grid-cols-2${compact ? ' mt-3' : ' mt-4'}`} role="tabpanel">
        {requiredFields.map((driver) => {
          const invalid = hasIssue(validationIssues, activeChannel, driver.field)
          const common = { help: invalid ? 'Required for FTE calculation' : undefined }
          if (driver.field === 'forecastVolume') {
            if (fteBilling) return null
            return (
              <div key={driver.field} className={invalid ? 'cap-field--invalid' : undefined}>
                {renderField(driver.field, driver.label, {
                  ...common,
                  step: 100,
                  min: 0,
                })}
              </div>
            )
          }
          if (driver.field === 'ahtSeconds') {
            if (fteBilling) return null
            return (
              <div key={driver.field} className={invalid ? 'cap-field--invalid' : undefined}>
                {renderField(driver.field, driver.label, {
                  ...common,
                  step: 5,
                  min: 1,
                })}
              </div>
            )
          }
          if (driver.field === 'occupancyTarget') {
            if (fteBilling) return null
            return (
              <div key={driver.field} className={invalid ? 'cap-field--invalid' : undefined}>
                {renderField(driver.field, driver.label, {
                  ...common,
                  help: productiveFormula,
                  step: 0.01,
                  min: 0.5,
                  max: 1,
                  percent: true,
                })}
              </div>
            )
          }
          if (driver.field === 'productivityPct') {
            if (fteBilling) return null
            return (
              <div key={driver.field} className={invalid ? 'cap-field--invalid' : undefined}>
                {renderField(driver.field, driver.label, {
                  ...common,
                  help: productiveFormula,
                  step: 0.01,
                  min: 0,
                  max: 1.2,
                  percent: true,
                })}
              </div>
            )
          }
          if (driver.field === 'chatConcurrency') {
            return (
              <div key={driver.field} className={invalid ? 'cap-field--invalid' : undefined}>
                {renderField(driver.field, driver.label, {
                  ...common,
                  help: 'Number of simultaneous chats per agent.',
                  step: 0.1,
                  min: 1,
                  max: 6,
                })}
              </div>
            )
          }
          return null
        })}
      </div>

      {validationIssues?.length ? (
        <p className="cap-field-error m-0 mt-3">
          Complete all required channel drivers before creating the capacity plan.
        </p>
      ) : null}

      {!fteBilling ? (
        <div className={`rounded-lg border border-slate-200 bg-slate-50 p-3${compact ? ' mt-3' : ' mt-4'}`}>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="m-0 text-sm font-semibold text-slate-800">
              {CHANNEL_LABELS[activeChannel]} required FTE preview
            </h4>
            <HelpTip text={`${CHANNEL_FORMULA_TOOLTIPS.workloadHours} · ${productiveFormula} · ${CHANNEL_FORMULA_TOOLTIPS.requiredFte}`} />
          </div>
          <div className={`exec-kpi-grid${compact ? ' mt-2' : ' mt-3'}`}>
            <KpiCard
              label="Workload Hours"
              value={fmtNum(staffing.workloadHours, 1)}
              hint={activeChannel === 'chat' ? 'Chats × AHT only' : undefined}
            />
            <KpiCard
              label="Productive Hrs / FTE"
              value={fmtNum(staffing.productiveHoursPerFte, 2)}
              hint={activeChannel === 'chat' ? 'Paid hrs × occupancy × concurrency' : undefined}
            />
            <KpiCard label="Required FTE" value={staffing.requiredFte > 0 ? fmtNum(staffing.requiredFte, 2) : '—'} />
            <KpiCard label="Channel Mix" value={fmtPct(staffing.channelMixPct)} />
          </div>
        </div>
      ) : null}
    </section>
  )

}
