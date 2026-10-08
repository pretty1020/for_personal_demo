import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { persistNewClientToDatabase } from '../data/workspaceSync'
import { ChannelCapacityDriversPanel } from '../components/planner/ChannelCapacityDriversPanel'
import { ChannelSelector } from '../components/planner/ChannelSelector'
import { NumField } from '../components/planner/NumField'
import { PlanStartWeekField } from '../components/planner/PlanStartWeekField'
import { UnsavedChangesDialog } from '../components/UnsavedChangesDialog'
import { StableNumberInput } from '../components/fields/StableNumberInput'
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard'
import { usePlanner } from '../context/PlannerContext'
import {
  defaultCapacitySetupDraft,
  finalizeCapacitySetup,
  type CapacitySetupDraft,
} from '../planner/capacitySetupService'
import { findClientById } from '../planner/clientRegistry'
import { resolvePlanLocation } from '../planner/planIdentity'
import {
  loadIndustryOptions,
  MAX_INDUSTRY_LENGTH,
  rememberIndustryOption,
} from '../planner/clientIndustries'
import { initChannelsForSupported, validateChannelCapacityDrivers } from '../planner/channelPlanning'
import type { ChannelAssumptions } from '../planner/types'
import { defaultCapacityPlanStartWeek } from '../planner/capacityWeekUtils'
import { timezoneSelectOptions } from '../planner/clientTimezones'
import { BILLABLE_TYPE_OPTIONS, isFteBillingPlan } from '../utils/staffingCapacity/billingModel'

const STEPS = ['Create Client', 'Add LOB', 'Requirement Drivers', 'Training & Hiring'] as const

function patchSupportedChannels(
  prev: CapacitySetupDraft,
  field: keyof ChannelAssumptions,
  value: number,
): CapacitySetupDraft['channels'] {
  return Object.fromEntries(
    prev.supportedChannels.map((channel) => [
      channel,
      { ...(prev.channels[channel] ?? {}), [field]: value } as ChannelAssumptions,
    ]),
  )
}

export function CapacitySetupWizardPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { createNewScenario, saveAsCapacityPlanView, selectScenario, hydrateCapacityStores, scenarios } = usePlanner()
  const clientId = searchParams.get('clientId')
  const initialClient = clientId ? findClientById(clientId) : null
  const [step, setStep] = useState(initialClient ? 1 : 0)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [industryOptions, setIndustryOptions] = useState(() => loadIndustryOptions())
  const [industryCustom, setIndustryCustom] = useState(false)
  const [draft, setDraft] = useState<CapacitySetupDraft>(() => {
    const base = defaultCapacitySetupDraft(initialClient)
    if (!base.capacityPlanStartWeek) {
      base.capacityPlanStartWeek = defaultCapacityPlanStartWeek(base.weekStart, base.timezone)
    }
    if (initialClient && !base.locationName.trim()) {
      const sites = [
        ...new Set(
          scenarios
            .filter(
              (scenario) =>
                scenario.plan.clientId === initialClient.id ||
                scenario.plan.client.trim().toLowerCase() === initialClient.name.trim().toLowerCase(),
            )
            .map((scenario) => resolvePlanLocation(scenario.plan))
            .filter(Boolean),
        ),
      ]
      if (sites.length === 1) base.locationName = sites[0] ?? ''
    }
    return base
  })
  const [initialDraftJson] = useState(() => JSON.stringify(draft))
  const wizardDirty = JSON.stringify(draft) !== initialDraftJson
  const { isBlocked: navigationBlocked, proceed: proceedNavigation, cancel: cancelNavigation, requestLeave } =
    useUnsavedChangesGuard({ when: wizardDirty })

  const fteBilling = isFteBillingPlan(draft.billingType)

  const driverIssues = useMemo(
    () => validateChannelCapacityDrivers(draft.channels, draft.supportedChannels, { billingType: draft.billingType }),
    [draft.billingType, draft.channels, draft.supportedChannels],
  )

  const canNext = useMemo(() => {
    if (step === 0) {
      return Boolean(
        draft.clientName.trim() && draft.locationName.trim() && draft.capacityPlanStartWeek && draft.timezone,
      )
    }
    if (step === 1) {
      return Boolean(
        draft.lobName.trim() &&
          draft.locationName.trim() &&
          draft.supportedChannels.length === 1,
      )
    }
    if (step === 2) {
      if (fteBilling) {
        return draft.week1RequiredProductionFte != null && draft.week1RequiredProductionFte >= 0
      }
      return driverIssues.length === 0
    }
    return true
  }, [draft, driverIssues.length, fteBilling, step])

  const createPlan = async () => {
    if (saving) return
    setSaving(true)
    setSaveError('')
    try {
      const { scenario, client } = finalizeCapacitySetup(draft, createNewScenario)
      hydrateCapacityStores()
      selectScenario(scenario.id)
      saveAsCapacityPlanView(scenario.id, scenario)
      // Open Capacity immediately — database sync continues in the background.
      navigate('/capacity-plan')
      void persistNewClientToDatabase({
        clientId: client.id,
        scenarioId: scenario.id,
        ownerEmail: scenario.ownerEmail,
      }).catch((error) => {
        console.warn('Background create sync failed:', error)
      })
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save the new client.')
      setSaving(false)
    }
  }

  return (
    <div className="setup-wizard">
      <section className="setup-wizard__hero">
        <h1 className="setup-wizard__title">
          {draft.mode === 'add-lob' ? `Add LOB · ${draft.clientName}` : 'Create a new client plan'}
        </h1>
      </section>

      <ol className="setup-wizard__steps" aria-label="Setup progress">
        {STEPS.map((label, index) => (
          <li
            key={label}
            className={`setup-wizard__step${index === step ? ' setup-wizard__step--active' : ''}${index < step ? ' setup-wizard__step--done' : ''}`}
          >
            <span className="setup-wizard__step-index">{index + 1}</span>
            <span>{label}</span>
          </li>
        ))}
      </ol>

      <section className="setup-wizard__panel saas-card">
        {step === 0 ? (
          <div className="setup-wizard__grid">
            <label className="saas-field">
              <span className="saas-field__label">Client name *</span>
              <input
                className="cap-field__input"
                value={draft.clientName}
                onChange={(event) => setDraft((prev) => ({ ...prev, clientName: event.target.value }))}
              />
            </label>
            <label className="saas-field">
              <span className="saas-field__label">Site *</span>
              <input
                className="cap-field__input"
                value={draft.locationName}
                required
                placeholder="e.g. Manila"
                onChange={(event) => setDraft((prev) => ({ ...prev, locationName: event.target.value }))}
              />
            </label>
            <label className="saas-field">
              <span className="saas-field__label">Industry</span>
              {industryCustom ? (
                <div className="setup-wizard__industry-custom">
                  <input
                    className="cap-field__input"
                    value={draft.industry}
                    maxLength={MAX_INDUSTRY_LENGTH}
                    placeholder="e.g. Logistics"
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, industry: event.target.value }))
                    }
                    onBlur={() => {
                      if (!draft.industry.trim()) return
                      setIndustryOptions(rememberIndustryOption(draft.industry))
                    }}
                  />
                  <button
                    type="button"
                    className="saas-btn saas-btn--secondary saas-btn--sm"
                    onClick={() => {
                      setIndustryCustom(false)
                      setDraft((prev) => ({ ...prev, industry: '' }))
                    }}
                  >
                    Use list
                  </button>
                </div>
              ) : (
                <select
                  className="cap-field__input"
                  value={draft.industry}
                  onChange={(event) => {
                    const value = event.target.value
                    if (value === '__custom__') {
                      setIndustryCustom(true)
                      setDraft((prev) => ({ ...prev, industry: '' }))
                      return
                    }
                    setDraft((prev) => ({ ...prev, industry: value }))
                    if (value) setIndustryOptions(rememberIndustryOption(value))
                  }}
                >
                  <option value="">Select industry</option>
                  {(draft.industry && !industryOptions.includes(draft.industry)
                    ? [...industryOptions, draft.industry]
                    : industryOptions
                  ).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                  <option value="__custom__">Custom industry…</option>
                </select>
              )}
              <span className="cap-panel__desc m-0 mt-1">
                Used to filter portfolios on Home, Executive, and Financials. Choose a sector or add
                your own.
              </span>
            </label>
            <label className="saas-field">
              <span className="saas-field__label">Week starts on *</span>
              <select
                className="cap-field__input"
                value={draft.weekStart}
                disabled={draft.mode === 'add-lob'}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    weekStart: event.target.value as CapacitySetupDraft['weekStart'],
                    capacityPlanStartWeek: defaultCapacityPlanStartWeek(
                      event.target.value as CapacitySetupDraft['weekStart'],
                      prev.timezone,
                    ),
                  }))
                }
              >
                <option value="sunday">Sunday</option>
                <option value="monday">Monday</option>
              </select>
            </label>
            <label className="saas-field">
              <span className="saas-field__label">Timezone *</span>
              <select
                className="cap-field__input"
                value={draft.timezone}
                disabled={draft.mode === 'add-lob'}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    timezone: event.target.value,
                    capacityPlanStartWeek: defaultCapacityPlanStartWeek(prev.weekStart, event.target.value),
                  }))
                }
              >
                {timezoneSelectOptions(draft.timezone).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <span className="cap-panel__desc m-0 mt-1">
                Used for current week, Actual vs Planned, and scheduling calendar boundaries for this client.
              </span>
            </label>
            <PlanStartWeekField
              weekStart={draft.weekStart}
              timeZone={draft.timezone}
              value={draft.capacityPlanStartWeek}
              onChange={(capacityPlanStartWeek) => setDraft((prev) => ({ ...prev, capacityPlanStartWeek }))}
            />
            <label className="saas-field">
              <span className="saas-field__label">Planning weeks</span>
              <StableNumberInput
                className="cap-field__input"
                min={4}
                max={52}
                value={draft.planningWeeks}
                allowEmpty={false}
                onCommit={(parsed) => {
                  if (parsed == null) return
                  setDraft((prev) => ({ ...prev, planningWeeks: parsed }))
                }}
                aria-label="Planning weeks"
              />
            </label>
            <label className="saas-field">
              <span className="saas-field__label">Build method</span>
              <select
                className="cap-field__input"
                value={draft.buildMethod}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    buildMethod: event.target.value as CapacitySetupDraft['buildMethod'],
                  }))
                }
              >
                <option value="forward">Forward build (Week 1 carry-forward)</option>
                <option value="import">Import historical actuals later</option>
              </select>
            </label>
            <label className="saas-field">
              <span className="saas-field__label">Default paid hours / FTE</span>
              <StableNumberInput
                className="cap-field__input"
                min={20}
                max={60}
                step={0.5}
                value={draft.defaultPaidHours}
                allowEmpty={false}
                onCommit={(parsed) => {
                  if (parsed == null) return
                  setDraft((prev) => ({
                    ...prev,
                    defaultPaidHours: parsed,
                    channels: patchSupportedChannels(prev, 'paidHoursPerFte', parsed),
                  }))
                }}
                aria-label="Default paid hours per FTE"
              />
            </label>
            <label className="saas-field">
              <span className="saas-field__label">Default shrinkage % (optional)</span>
              <StableNumberInput
                className="cap-field__input"
                min={0}
                max={60}
                step={0.1}
                value={Math.round(draft.defaultShrinkagePct * 100000) / 1000}
                onCommit={(parsed) => {
                  const nextShrinkage = parsed == null ? 0 : Math.max(0, Math.min(0.6, parsed / 100))
                  setDraft((prev) => ({
                    ...prev,
                    defaultShrinkagePct: nextShrinkage,
                    channels: patchSupportedChannels(prev, 'shrinkagePct', nextShrinkage),
                  }))
                }}
                aria-label="Default shrinkage percent"
              />
            </label>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="setup-wizard__grid">
            <label className="saas-field">
              <span className="saas-field__label">LOB name *</span>
              <input
                className="cap-field__input"
                value={draft.lobName}
                onChange={(event) => setDraft((prev) => ({ ...prev, lobName: event.target.value }))}
                placeholder="e.g. Voice · Tier 1"
              />
            </label>
            <label className="saas-field">
              <span className="saas-field__label">Site *</span>
              <input
                className="cap-field__input"
                value={draft.locationName}
                required
                onChange={(event) => setDraft((prev) => ({ ...prev, locationName: event.target.value }))}
                placeholder="e.g. Manila"
              />
            </label>
            <label className="saas-field">
              <span className="saas-field__label">Client code</span>
              <input
                className="cap-field__input"
                value={draft.projectCode}
                onChange={(event) => setDraft((prev) => ({ ...prev, projectCode: event.target.value }))}
                placeholder="Optional"
              />
            </label>
            <label className="saas-field">
              <span className="saas-field__label">Project name</span>
              <input
                className="cap-field__input"
                value={draft.projectName}
                onChange={(event) => setDraft((prev) => ({ ...prev, projectName: event.target.value }))}
                placeholder="Optional"
              />
            </label>
            <label className="saas-field">
              <span className="saas-field__label">Billing type</span>
              <select
                className="cap-field__input"
                value={draft.billingType}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    billingType: event.target.value,
                    week1RequiredProductionFte: isFteBillingPlan(event.target.value)
                      ? prev.week1RequiredProductionFte
                      : null,
                  }))
                }
              >
                {BILLABLE_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="saas-field setup-wizard__full">
              <ChannelSelector
                single
                selected={draft.supportedChannels}
                onChange={(supportedChannels) =>
                  setDraft((prev) => ({
                    ...prev,
                    supportedChannels,
                    channels: initChannelsForSupported(prev.channels, supportedChannels, {
                      trainingWeeks: prev.trainingWeeks,
                      nestingWeeks: prev.nestingWeeks,
                      requireUserEntry: true,
                      defaultPaidHours: prev.defaultPaidHours,
                      defaultShrinkagePct: prev.defaultShrinkagePct,
                    }),
                  }))
                }
              />
            </div>
            <label className="saas-field">
              <span className="saas-field__label">Training length (weeks)</span>
              <StableNumberInput
                className="cap-field__input"
                min={1}
                value={draft.trainingWeeks}
                allowEmpty={false}
                onCommit={(parsed) => {
                  if (parsed == null) return
                  setDraft((prev) => ({
                    ...prev,
                    trainingWeeks: parsed,
                    channels: patchSupportedChannels(prev, 'trainingWeeks', parsed),
                  }))
                }}
                aria-label="Training length in weeks"
              />
            </label>
            <label className="saas-field">
              <span className="saas-field__label">Nesting length (weeks)</span>
              <StableNumberInput
                className="cap-field__input"
                min={1}
                value={draft.nestingWeeks}
                allowEmpty={false}
                onCommit={(parsed) => {
                  if (parsed == null) return
                  setDraft((prev) => ({
                    ...prev,
                    nestingWeeks: parsed,
                    channels: patchSupportedChannels(prev, 'nestingWeeks', parsed),
                  }))
                }}
                aria-label="Nesting length in weeks"
              />
            </label>
          </div>
        ) : null}

        {step === 2 ? (
          <div>
            <p className="cap-panel__desc m-0">
              {fteBilling
                ? `Per FTE billing: enter Week 1 Required Production FTE. Volume, AHT, and occupancy are not used. Weeks 2–${draft.planningWeeks} copy Week 1 when carry-forward is enabled.`
                : `Enter Week 1 requirement drivers only. Weeks 2–${draft.planningWeeks} will copy these values automatically.`}
            </p>
            {fteBilling ? (
              <div className="setup-wizard__grid mt-4">
                <label className="saas-field">
                  <span className="saas-field__label">Required Production FTE (Week 1) *</span>
                  <StableNumberInput
                    className="cap-field__input"
                    min={0}
                    placeholder="e.g. 42.5"
                    value={draft.week1RequiredProductionFte ?? ''}
                    onChange={(raw) => {
                      const parsed = raw.trim() === '' ? null : Number(raw)
                      setDraft((prev) => ({
                        ...prev,
                        week1RequiredProductionFte:
                          parsed != null && Number.isFinite(parsed) ? Math.max(0, parsed) : null,
                      }))
                    }}
                    onCommit={(parsed) => {
                      setDraft((prev) => ({ ...prev, week1RequiredProductionFte: parsed }))
                    }}
                    aria-label="Required Production FTE Week 1"
                  />
                </label>
              </div>
            ) : (
              <ChannelCapacityDriversPanel
                supportedChannels={draft.supportedChannels}
                channels={draft.channels}
                onChange={(channels) => setDraft((prev) => ({ ...prev, channels }))}
                validationIssues={driverIssues}
                defaultPaidHours={draft.defaultPaidHours}
                fteBilling={fteBilling}
              />
            )}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="setup-wizard__grid">
            <label className="saas-field">
              <span className="saas-field__label">Weekly hiring plan (starts / week)</span>
              <StableNumberInput
                className="cap-field__input"
                min={0}
                value={draft.weeklyHiringPlan || ''}
                onCommit={(parsed) => {
                  setDraft((prev) => ({ ...prev, weeklyHiringPlan: parsed == null ? 0 : Math.max(0, parsed) }))
                }}
                aria-label="Weekly hiring plan"
              />
            </label>
            <NumField
              label="Training attrition %"
              value={draft.trainingAttritionRate}
              onChange={(trainingAttritionRate) => setDraft((prev) => ({ ...prev, trainingAttritionRate }))}
              percent
              min={0}
              max={0.5}
              step={0.001}
            />
            <NumField
              label="Nesting attrition %"
              value={draft.nestingAttritionRate}
              onChange={(nestingAttritionRate) => setDraft((prev) => ({ ...prev, nestingAttritionRate }))}
              percent
              min={0}
              max={0.5}
              step={0.001}
            />
            <NumField
              label="Graduation rate %"
              value={draft.graduationRate}
              onChange={(graduationRate) => setDraft((prev) => ({ ...prev, graduationRate }))}
              percent
              min={0}
              max={1}
              step={0.01}
            />
            <label className="saas-field setup-wizard__full">
              <span className="saas-field__label">Week 1 carry-forward</span>
              <label className="setup-wizard__checkbox">
                <input
                  type="checkbox"
                  checked={draft.propagateFutureWeeks}
                  onChange={(event) => setDraft((prev) => ({ ...prev, propagateFutureWeeks: event.target.checked }))}
                />
                <span>
                  {fteBilling
                    ? 'Copy Week 1 Required Production FTE to all future weeks (locked weeks stay unchanged)'
                    : 'Automatically copy Week 1 drivers to all future weeks (locked weeks stay unchanged)'}
                </span>
              </label>
            </label>
          </div>
        ) : null}

        {saveError ? (
          <p className="cap-panel__desc setup-wizard__save-error" role="alert">
            {saveError}
          </p>
        ) : null}

        <div className="setup-wizard__actions">
          <button type="button" className="saas-btn saas-btn--secondary" onClick={() => requestLeave('/')}>
            Cancel
          </button>
          {step > 0 ? (
            <button type="button" className="saas-btn saas-btn--secondary" onClick={() => setStep((prev) => prev - 1)}>
              Back
            </button>
          ) : null}
          {step < STEPS.length - 1 ? (
            <button type="button" className="saas-btn" disabled={!canNext} onClick={() => setStep((prev) => prev + 1)}>
              Next
            </button>
          ) : (
            <button type="button" className="saas-btn" disabled={!canNext || saving} onClick={() => void createPlan()}>
              {saving ? 'Creating…' : 'Create'}
            </button>
          )}
        </div>
      </section>

      {navigationBlocked ? (
        <UnsavedChangesDialog
          title="Leave setup?"
          message="You have unsaved capacity setup changes. Leave without saving, or stay and finish Create?"
          saveLabel="Stay and continue"
          discardLabel="Leave without saving"
          onSave={cancelNavigation}
          onDiscard={proceedNavigation}
          onCancel={cancelNavigation}
        />
      ) : null}
    </div>
  )
}
