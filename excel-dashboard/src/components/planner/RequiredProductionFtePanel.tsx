import { useMemo, useState } from 'react'
import { ChannelSelector } from './ChannelSelector'
import { HelpTip } from './HelpTip'
import { KpiCard } from './KpiCard'
import { NumField } from './NumField'
import { initChannelsForSupported, normalizeChannelMix, resolveChannelAssumptions } from '../../planner/channelPlanning'
import { fmtNum } from '../../planner/format'
import {
  buildRequiredProductionFteBreakdown,
  getRequiredProductionDriverFields,
  getRequiredProductionFormula,
  normalizePercentInput,
  REQUIRED_PRODUCTION_HANDLING_LABELS,
  type RequiredProductionDriverField,
  type RequiredProductionHandlingModel,
} from '../../planner/requiredProductionFte'
import type { ChannelAssumptions, ChannelType, PlannerAssumptions, PlannerPlanMetadata } from '../../planner/types'
import { CHANNEL_LABELS } from '../../planner/types'

type Props = {
  plan: PlannerPlanMetadata
  assumptions: PlannerAssumptions
  onAssumptionsChange: (assumptions: PlannerAssumptions) => void
  onPlanChange: (plan: PlannerPlanMetadata) => void
  disabled?: boolean
  fteBilling?: boolean
  defaultPaidHours?: number
}

function fieldOptions(
  driver: RequiredProductionDriverField,
  fteBilling: boolean,
): {
  step?: number
  min?: number
  max?: number
  help?: string
  optional?: boolean
  percent?: boolean
} {
  const optional = Boolean(driver.optional) || (fteBilling && (driver.field === 'forecastVolume' || driver.field === 'ahtSeconds'))
  const base = { optional, percent: Boolean(driver.percent) }
  switch (driver.field) {
    case 'forecastVolume':
      return { ...base, step: 100, min: 0, help: fteBilling ? 'Optional for FTE billing' : undefined }
    case 'ahtSeconds':
      return { ...base, step: 5, min: 1, help: fteBilling ? 'Optional for FTE billing' : undefined }
    case 'occupancyTarget':
    case 'slaTargetPct':
      return { ...base, step: 0.01, min: 0.01, max: 1, help: 'Enter 85 or 0.85' }
    case 'shrinkagePct':
    case 'reopenRate':
    case 'reworkPct':
    case 'bufferPct':
      return { ...base, step: 0.01, min: 0, max: 0.99, help: 'Enter 25 or 0.25. Used for Paid FTE only.' }
    case 'chatConcurrency':
      return { ...base, step: 0.1, min: 1, max: 20, help: 'Must be ≥ 1. Simultaneous conversations per agent.' }
    case 'paidHoursPerFte':
      return { ...base, step: 0.5, min: 0.1, help: 'Weekly productive hours per FTE (e.g. 40).' }
    case 'intervalSeconds':
      return { ...base, step: 60, min: 1, help: 'Optional. When set, interval formulas are used instead of weekly hours.' }
    case 'backlogVolume':
    case 'targetBacklogReduction':
    case 'carryoverWorkload':
      return { ...base, step: 10, min: 0 }
    case 'responseTimeTargetSeconds':
    case 'turnaroundTimeTargetSeconds':
    case 'targetAnswerSeconds':
    case 'completionWindowSeconds':
      return { ...base, step: 1, min: 1 }
    case 'appointmentMode':
      return { ...base, step: 1, min: 0, max: 1, help: '1 = appointment mode enabled' }
    case 'peakConcurrentAppointments':
    case 'bufferFte':
      return { ...base, step: 0.1, min: 0 }
    default:
      return base
  }
}

export function RequiredProductionFtePanel({
  plan,
  assumptions,
  onAssumptionsChange,
  onPlanChange,
  disabled = false,
  fteBilling = false,
  defaultPaidHours = 40,
}: Props) {
  const supportedChannels = plan.supportedChannels ?? ['voice']
  const channels = assumptions.channels ?? {}
  const resolvedChannels = useMemo(() => resolveChannelAssumptions(assumptions, plan), [assumptions, plan])
  const [activeTab, setActiveTab] = useState<ChannelType>(supportedChannels[0] ?? 'voice')
  const activeChannel = supportedChannels.includes(activeTab) ? activeTab : supportedChannels[0] ?? 'voice'
  const activeAssumptions = resolvedChannels[activeChannel]

  const breakdown = useMemo(
    () => buildRequiredProductionFteBreakdown(assumptions, plan),
    [assumptions, plan],
  )

  const patchChannels = (nextChannels: Partial<Record<ChannelType, ChannelAssumptions>>) => {
    onAssumptionsChange({ ...assumptions, channels: nextChannels })
  }

  const patchChannelField = (channel: ChannelType, field: keyof ChannelAssumptions, value: number) => {
    const base = channels[channel] ?? resolvedChannels[channel]
    const driver = getRequiredProductionDriverFields(channel).find((item) => item.field === field)
    const nextValue = driver?.percent ? normalizePercentInput(value) : value
    patchChannels({
      ...channels,
      [channel]: { ...base, [field]: nextValue },
    })
  }

  const patchSupportedChannels = (nextSupported: ChannelType[]) => {
    const nextChannelMap = initChannelsForSupported(channels, nextSupported, {
      trainingWeeks: assumptions.newHire.trainingWeeks,
      nestingWeeks: assumptions.newHire.nestingWeeks,
      defaultPaidHours,
      defaultShrinkagePct: assumptions.tenured.shrinkageRate,
    })
    onPlanChange({ ...plan, supportedChannels: nextSupported })
    onAssumptionsChange({ ...assumptions, channels: normalizeChannelMix(nextChannelMap, nextSupported) })
  }

  const patchHandlingModel = (model: RequiredProductionHandlingModel) => {
    onPlanChange({ ...plan, requiredProductionHandlingModel: model })
  }

  const handlingModel = plan.requiredProductionHandlingModel ?? 'dedicated_agents'
  const isMultiChannel = supportedChannels.length > 1
  const activeFormula = getRequiredProductionFormula(activeChannel, activeAssumptions)

  if (!supportedChannels.length) {
    return <p className="saas-muted">Select at least one channel for Required Production FTE.</p>
  }

  const renderField = (driver: RequiredProductionDriverField) => {
    if (!activeAssumptions) return null
    if (fteBilling && (driver.field === 'forecastVolume' || driver.field === 'ahtSeconds' || driver.field === 'occupancyTarget' || driver.field === 'productivityPct')) {
      return null
    }
    if (driver.field === 'chatConcurrency' && activeChannel === 'social' && activeAssumptions.socialWorkloadMode === 'posts_comments_reviews') {
      return null
    }
    if (driver.field === 'peakConcurrentAppointments' && activeAssumptions.appointmentMode !== 1) return null
    if ((driver.field === 'bufferFte' || driver.field === 'bufferPct') && activeAssumptions.appointmentMode !== 1) return null

    const options = fieldOptions(driver, fteBilling)
    const invalid = breakdown.validationIssues.some(
      (issue) => issue.channel === activeChannel && issue.field === driver.field,
    )
    const rawValue = (activeAssumptions[driver.field] as number | undefined) ?? 0
    return (
      <div key={driver.field} className={invalid ? 'cap-field--invalid' : undefined}>
        <NumField
          label={`${driver.label}${options.optional ? ' (optional)' : ' *'}`}
          help={invalid ? 'Required for Required Production FTE calculation' : options.help}
          value={rawValue}
          onChange={(value) => patchChannelField(activeChannel, driver.field, value)}
          step={options.step}
          min={options.min}
          max={options.max}
        />
      </div>
    )
  }

  return (
    <section className={`cap-capacity-sidebar__form${disabled ? ' opacity-60 pointer-events-none' : ''}`}>
      <p className="cap-panel__desc m-0">
        Configure channel drivers for <strong>Required Production FTE</strong> (productive staffing before shrinkage).
        Paid FTE is shown separately after shrinkage. Only drivers required by the selected channel are shown.
      </p>

      <div className="mt-3">
        <ChannelSelector selected={supportedChannels} onChange={patchSupportedChannels} compact />
      </div>

      {isMultiChannel ? (
        <div className="mt-3 grid gap-3">
          <label className="saas-field">
            <span className="saas-field__label">Handling model *</span>
            <select
              className="cap-field__input"
              value={handlingModel}
              disabled={disabled}
              onChange={(event) => patchHandlingModel(event.target.value as RequiredProductionHandlingModel)}
            >
              {(Object.keys(REQUIRED_PRODUCTION_HANDLING_LABELS) as RequiredProductionHandlingModel[]).map((model) => (
                <option key={model} value={model}>
                  {REQUIRED_PRODUCTION_HANDLING_LABELS[model]}
                </option>
              ))}
            </select>
          </label>

          {handlingModel === 'blended_agents' ? (
            <NumField
              label="Blending efficiency * (enter 15 or 0.15 — no default)"
              help="Combined = Σ Channel FTE × (1 − blending efficiency). Must be entered."
              value={plan.blendingEfficiency ?? 0}
              onChange={(value) =>
                onPlanChange({ ...plan, blendingEfficiency: normalizePercentInput(value) })
              }
              step={0.01}
              min={0}
              max={0.99}
            />
          ) : null}

          {handlingModel === 'simultaneous_handling' ? (
            <>
              <label className="saas-field">
                <span className="saas-field__label">Primary channel *</span>
                <select
                  className="cap-field__input"
                  value={plan.requiredProductionPrimaryChannel ?? supportedChannels[0]}
                  disabled={disabled}
                  onChange={(event) =>
                    onPlanChange({
                      ...plan,
                      requiredProductionPrimaryChannel: event.target.value as ChannelType,
                    })
                  }
                >
                  {supportedChannels.map((channel) => (
                    <option key={channel} value={channel}>
                      {CHANNEL_LABELS[channel]}
                    </option>
                  ))}
                </select>
              </label>
              <NumField
                label="Idle capacity % * (enter 20 or 0.20 — no default)"
                help="Share of primary FTE idle time that may be usable by secondary channels."
                value={plan.idleCapacityPct ?? 0}
                onChange={(value) => onPlanChange({ ...plan, idleCapacityPct: normalizePercentInput(value) })}
                step={0.01}
                min={0}
                max={1}
              />
              <NumField
                label="Shared capacity factor * (enter 50 or 0.50 — no default)"
                help="Fraction of idle capacity that can actually be used by another channel."
                value={plan.sharedCapacityFactor ?? 0}
                onChange={(value) =>
                  onPlanChange({ ...plan, sharedCapacityFactor: normalizePercentInput(value) })
                }
                step={0.01}
                min={0}
                max={1}
              />
            </>
          ) : null}
        </div>
      ) : null}

      <div className="channel-tabs mt-4" role="tablist">
        {supportedChannels.map((channel) => (
          <button
            key={channel}
            type="button"
            role="tab"
            aria-selected={activeChannel === channel}
            className={`channel-tabs__tab${activeChannel === channel ? ' channel-tabs__tab--active' : ''}`}
            onClick={() => setActiveTab(channel)}
            disabled={disabled}
          >
            {CHANNEL_LABELS[channel]}
          </button>
        ))}
      </div>

      {activeAssumptions ? (
        <div className="mt-3 space-y-3" role="tabpanel">
          {activeChannel === 'social' ? (
            <label className="saas-field">
              <span className="saas-field__label">Social workload type *</span>
              <select
                className="cap-field__input"
                value={activeAssumptions.socialWorkloadMode ?? 'direct_messages'}
                disabled={disabled}
                onChange={(event) => {
                  const mode = event.target.value as 'direct_messages' | 'posts_comments_reviews'
                  const base = channels[activeChannel] ?? resolvedChannels[activeChannel]
                  patchChannels({
                    ...channels,
                    [activeChannel]: { ...base, socialWorkloadMode: mode },
                  })
                }}
              >
                <option value="direct_messages">Direct Messages (concurrency)</option>
                <option value="posts_comments_reviews">Posts / Comments / Reviews</option>
              </select>
            </label>
          ) : null}

          <p className="saas-muted m-0 text-xs">
            <strong>Formula:</strong> {activeFormula}
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            {getRequiredProductionDriverFields(activeChannel).map(renderField)}
          </div>
        </div>
      ) : (
        <p className="saas-muted mt-3">Channel drivers not initialized.</p>
      )}

      {breakdown.incomplete || breakdown.validationIssues.length ? (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3">
          <p className="m-0 text-sm font-semibold text-rose-800">Cannot calculate Required Production FTE</p>
          <p className="m-0 mt-1 text-sm text-rose-700">
            {breakdown.incompleteMessage ?? 'Complete all required inputs.'}
          </p>
          {breakdown.validationIssues.length ? (
            <ul className="m-0 mt-2 list-disc pl-5 text-sm text-rose-700">
              {breakdown.validationIssues.map((issue) => (
                <li key={`${issue.channel}-${issue.field}`}>
                  {CHANNEL_LABELS[issue.channel]}: {issue.label}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 mt-4">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="m-0 text-sm font-semibold text-slate-800">Required Production FTE breakdown</h4>
          <HelpTip text={breakdown.combinationFormula} />
        </div>

        {breakdown.incomplete ? (
          <p className="cap-field-error m-0 mt-2">
            Results are hidden until required inputs are valid (no silent zero).
          </p>
        ) : (
          <>
            <div className="exec-kpi-grid mt-3">
              <KpiCard
                label="Required Production FTE"
                value={fmtNum(breakdown.totalRequiredFte, 2)}
                hint={isMultiChannel ? breakdown.handlingModelLabel : 'Before shrinkage'}
              />
              <KpiCard
                label="Paid FTE"
                value={breakdown.totalPaidFte != null ? fmtNum(breakdown.totalPaidFte, 2) : '—'}
                hint="Required ÷ (1 − Shrinkage)"
              />
              <KpiCard
                label="Agents (CEILING)"
                value={
                  breakdown.totalRequiredAgentsCeiling != null
                    ? fmtNum(breakdown.totalRequiredAgentsCeiling, 0)
                    : '—'
                }
                hint="Whole agents needed"
              />
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="cap-table w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left">Channel</th>
                    <th className="text-right">Required FTE</th>
                    <th className="text-right">Paid FTE</th>
                    <th className="text-right">CEILING</th>
                    <th className="text-left">Method / formula</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.byChannel.map((row) => (
                    <tr key={row.channel}>
                      <td>{CHANNEL_LABELS[row.channel]}</td>
                      <td className="text-right">
                        {row.requiredProductionFte != null ? fmtNum(row.requiredProductionFte, 2) : '—'}
                      </td>
                      <td className="text-right">{row.paidFte != null ? fmtNum(row.paidFte, 2) : '—'}</td>
                      <td className="text-right">
                        {row.requiredAgentsCeiling != null ? fmtNum(row.requiredAgentsCeiling, 0) : '—'}
                      </td>
                      <td className="text-xs text-slate-600">
                        <span className="font-medium text-slate-700">{row.methodSummary}</span>
                        <br />
                        {row.formulaLabel}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
