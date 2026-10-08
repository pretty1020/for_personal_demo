import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChannelCapacityDriversPanel } from '../components/planner/ChannelCapacityDriversPanel'
import { ChannelSelector } from '../components/planner/ChannelSelector'
import { NumField } from '../components/planner/NumField'
import { PlanStartWeekField } from '../components/planner/PlanStartWeekField'
import { useDemoSession } from '../context/DemoSessionContext'
import { usePlanner } from '../context/PlannerContext'
import {
  defaultCapacitySetupDraft,
  finalizeCapacitySetup,
  type CapacitySetupDraft,
} from '../planner/capacitySetupService'
import { findClientById, findClientByName } from '../planner/clientRegistry'
import { initChannelsForSupported, validateChannelCapacityDrivers } from '../planner/channelPlanning'
import type { ChannelAssumptions } from '../planner/types'
import { defaultCapacityPlanStartWeek } from '../planner/capacityWeekUtils'
import { BILLABLE_TYPE_OPTIONS, isFteBillingPlan } from '../utils/staffingCapacity/billingModel'

const STEPS = ['Client & LOB', 'Requirement Drivers', 'Training & Hiring'] as const

export function CapacitySetupWizardPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { canCreatePlans } = useDemoSession()
  const { createNewScenario, saveAsCapacityPlanView, selectScenario, hydrateCapacityStores } = usePlanner()
  const clientId = searchParams.get('clientId')
  const clientNameParam = searchParams.get('clientName')
  const initialClient =
    (clientId ? findClientById(clientId) : null) ??
    (clientNameParam ? findClientByName(clientNameParam) : null)
  const [step, setStep] = useState(0)
  const [showMore, setShowMore] = useState(false)
  const [draft, setDraft] = useState<CapacitySetupDraft>(() => {
    const base = defaultCapacitySetupDraft(initialClient)
    // Opening /setup with a known client always means add another LOB under that client.
    if (initialClient) {
      base.mode = 'add-lob'
      base.clientId = initialClient.id
      base.clientName = initialClient.name
    }
    if (!base.capacityPlanStartWeek) {
      base.capacityPlanStartWeek = defaultCapacityPlanStartWeek(base.weekStart)
    }
    return base
  })
  const [requiredFteText, setRequiredFteText] = useState(
    () => (draft.week1RequiredProductionFte != null ? String(draft.week1RequiredProductionFte) : ''),
  )

  const fteBilling = isFteBillingPlan(draft.billingType)
  const addingLobOnly = draft.mode === 'add-lob'

  const driverIssues = useMemo(
    () => validateChannelCapacityDrivers(draft.channels, draft.supportedChannels, { billingType: draft.billingType }),
    [draft.billingType, draft.channels, draft.supportedChannels],
  )

  const canNext = useMemo(() => {
    if (step === 0) {
      return Boolean(
        draft.clientName.trim() &&
          draft.lobName.trim() &&
          draft.locationName.trim() &&
          draft.capacityPlanStartWeek &&
          draft.supportedChannels.length === 1,
      )
    }
    if (step === 1) {
      if (driverIssues.length > 0) return false
      if (fteBilling) {
        return draft.week1RequiredProductionFte != null && draft.week1RequiredProductionFte >= 0
      }
      return true
    }
    return true
  }, [draft, driverIssues.length, fteBilling, step])

  const createPlan = () => {
    const { scenario } = finalizeCapacitySetup(draft, createNewScenario)
    hydrateCapacityStores()
    selectScenario(scenario.id)
    saveAsCapacityPlanView(scenario.id)
    navigate('/summary')
  }

  if (!canCreatePlans) {
    return (
      <div className="setup-wizard setup-wizard--v2">
        <section className="setup-wizard__hero">
          <p className="setup-wizard__eyebrow">Capacity setup</p>
          <h1 className="setup-wizard__title">Access restricted</h1>
          <p className="setup-wizard__lead m-0">
            Only Admins and Capacity planners / Schedulers can create client plans.
          </p>
        </section>
        <button type="button" className="saas-btn" onClick={() => navigate('/')}>
          Back to Home
        </button>
      </div>
    )
  }

  return (
    <div className="setup-wizard setup-wizard--v2">
      <section className="setup-wizard__hero">
        <p className="setup-wizard__eyebrow">Capacity setup</p>
        <h1 className="setup-wizard__title">
          {addingLobOnly ? `Add LOB · ${draft.clientName}` : 'Create a client & LOB'}
        </h1>
        <p className="setup-wizard__lead m-0">
          {addingLobOnly
            ? 'Add another line of business under this client, then set Week 1 drivers.'
            : 'Name the client and its first LOB together. Week 1 drivers carry forward across the horizon.'}
        </p>
      </section>

      <ol className="setup-wizard__steps setup-wizard__steps--3" aria-label="Setup progress">
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
          <div className="setup-wizard__sections">
            <div className="setup-wizard__section">
              <header className="setup-wizard__section-head">
                <p className="setup-wizard__section-eyebrow">Client</p>
                <h3>Who is this plan for?</h3>
              </header>
              <div className="setup-wizard__grid">
                <label className="saas-field">
                  <span className="saas-field__label">Client name *</span>
                  <input
                    className="cap-field__input"
                    value={draft.clientName}
                    disabled={addingLobOnly}
                    onChange={(event) => setDraft((prev) => ({ ...prev, clientName: event.target.value }))}
                    placeholder="e.g. Contoso Support"
                  />
                </label>
                <label className="saas-field">
                  <span className="saas-field__label">Week starts on *</span>
                  <select
                    className="cap-field__input"
                    value={draft.weekStart}
                    disabled={addingLobOnly}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        weekStart: event.target.value as CapacitySetupDraft['weekStart'],
                        capacityPlanStartWeek: defaultCapacityPlanStartWeek(
                          event.target.value as CapacitySetupDraft['weekStart'],
                        ),
                      }))
                    }
                  >
                    <option value="sunday">Sunday</option>
                    <option value="monday">Monday</option>
                  </select>
                </label>
                <div className="setup-wizard__full">
                  <PlanStartWeekField
                    weekStart={draft.weekStart}
                    value={draft.capacityPlanStartWeek}
                    onChange={(capacityPlanStartWeek) => setDraft((prev) => ({ ...prev, capacityPlanStartWeek }))}
                  />
                </div>
              </div>
            </div>

            <div className="setup-wizard__section">
              <header className="setup-wizard__section-head">
                <p className="setup-wizard__section-eyebrow">LOB</p>
                <h3>Add line of business</h3>
              </header>
              <div className="setup-wizard__grid">
                <label className="saas-field">
                  <span className="saas-field__label">LOB *</span>
                  <input
                    className="cap-field__input"
                    value={draft.lobName}
                    onChange={(event) => setDraft((prev) => ({ ...prev, lobName: event.target.value }))}
                    placeholder="e.g. Voice · Tier 1"
                  />
                </label>
                <label className="saas-field">
                  <span className="saas-field__label">Location *</span>
                  <input
                    className="cap-field__input"
                    value={draft.locationName}
                    onChange={(event) => setDraft((prev) => ({ ...prev, locationName: event.target.value }))}
                    placeholder="e.g. Manila"
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
              </div>
            </div>

            <div className="setup-wizard__section setup-wizard__section--muted">
              <button
                type="button"
                className="setup-wizard__more-toggle"
                onClick={() => setShowMore((prev) => !prev)}
                aria-expanded={showMore}
              >
                {showMore ? 'Hide calendar defaults' : 'Show calendar defaults'}
              </button>
              {showMore ? (
                <div className="setup-wizard__grid mt-3">
                  <NumField
                    label="Planning weeks"
                    value={draft.planningWeeks}
                    min={4}
                    max={52}
                    step={1}
                    placeholder="e.g. 52"
                    help="How many forward weeks to generate for this plan."
                    onChange={(planningWeeks) =>
                      setDraft((prev) => ({
                        ...prev,
                        planningWeeks: Math.max(4, Math.min(52, Math.round(planningWeeks))),
                      }))
                    }
                  />
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
                  <NumField
                    label="Default paid hours / FTE"
                    value={draft.defaultPaidHours}
                    min={20}
                    max={60}
                    step={0.5}
                    placeholder="e.g. 40"
                    onChange={(nextHours) => {
                      const hours = Math.max(20, nextHours)
                      setDraft((prev) => ({
                        ...prev,
                        defaultPaidHours: hours,
                        channels: Object.fromEntries(
                          prev.supportedChannels.map((channel) => [
                            channel,
                            { ...(prev.channels[channel] ?? {}), paidHoursPerFte: hours } as ChannelAssumptions,
                          ]),
                        ),
                      }))
                    }}
                  />
                  <NumField
                    label="Default shrinkage (optional)"
                    value={draft.defaultShrinkagePct}
                    percent
                    min={0}
                    max={0.6}
                    step={0.1}
                    placeholder="e.g. 12"
                    onChange={(nextShrinkage) => {
                      setDraft((prev) => ({
                        ...prev,
                        defaultShrinkagePct: nextShrinkage,
                        channels: Object.fromEntries(
                          prev.supportedChannels.map((channel) => [
                            channel,
                            { ...(prev.channels[channel] ?? {}), shrinkagePct: nextShrinkage } as ChannelAssumptions,
                          ]),
                        ),
                      }))
                    }}
                  />
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div>
            <header className="setup-wizard__section-head">
              <p className="setup-wizard__section-eyebrow">Drivers</p>
              <h3>Week 1 requirement</h3>
            </header>
            <p className="cap-panel__desc m-0">
              {fteBilling
                ? `Per FTE billing: enter Week 1 Required Production FTE. Weeks 2–${draft.planningWeeks} copy Week 1 when carry-forward is enabled.`
                : `Enter Week 1 requirement drivers only. Weeks 2–${draft.planningWeeks} copy these values automatically.`}
            </p>
            {fteBilling ? (
              <div className="setup-wizard__grid mt-4">
                <label className="saas-field">
                  <span className="saas-field__label">Required Production FTE (Week 1) *</span>
                  <input
                    className="cap-field__input"
                    type="text"
                    inputMode="decimal"
                    value={requiredFteText}
                    placeholder="e.g. 42.5"
                    onChange={(event) => setRequiredFteText(event.target.value)}
                    onBlur={() => {
                      const trimmed = requiredFteText.trim()
                      if (!trimmed) {
                        setDraft((prev) => ({ ...prev, week1RequiredProductionFte: null }))
                        setRequiredFteText('')
                        return
                      }
                      const parsed = Number(trimmed)
                      if (!Number.isFinite(parsed) || parsed < 0) {
                        setRequiredFteText(
                          draft.week1RequiredProductionFte != null ? String(draft.week1RequiredProductionFte) : '',
                        )
                        return
                      }
                      const next = Math.round(parsed * 100) / 100
                      setDraft((prev) => ({ ...prev, week1RequiredProductionFte: next }))
                      setRequiredFteText(String(next))
                    }}
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

        {step === 2 ? (
          <div className="setup-wizard__sections">
            <div className="setup-wizard__section">
              <header className="setup-wizard__section-head">
                <p className="setup-wizard__section-eyebrow">Pipeline</p>
                <h3>Training &amp; nesting length</h3>
              </header>
              <div className="setup-wizard__grid">
                <NumField
                  label="Training length (weeks)"
                  value={draft.trainingWeeks}
                  min={1}
                  step={1}
                  placeholder="e.g. 4"
                  onChange={(nextTrainingWeeks) =>
                    setDraft((prev) => {
                      const weeks = Math.max(1, Math.round(nextTrainingWeeks))
                      return {
                        ...prev,
                        trainingWeeks: weeks,
                        channels: Object.fromEntries(
                          prev.supportedChannels.map((channel) => [
                            channel,
                            { ...(prev.channels[channel] ?? {}), trainingWeeks: weeks } as ChannelAssumptions,
                          ]),
                        ),
                      }
                    })
                  }
                />
                <NumField
                  label="Nesting length (weeks)"
                  value={draft.nestingWeeks}
                  min={1}
                  step={1}
                  placeholder="e.g. 2"
                  onChange={(nextNestingWeeks) =>
                    setDraft((prev) => {
                      const weeks = Math.max(1, Math.round(nextNestingWeeks))
                      return {
                        ...prev,
                        nestingWeeks: weeks,
                        channels: Object.fromEntries(
                          prev.supportedChannels.map((channel) => [
                            channel,
                            { ...(prev.channels[channel] ?? {}), nestingWeeks: weeks } as ChannelAssumptions,
                          ]),
                        ),
                      }
                    })
                  }
                />
              </div>
            </div>

            <div className="setup-wizard__section">
              <header className="setup-wizard__section-head">
                <p className="setup-wizard__section-eyebrow">Hiring</p>
                <h3>Starts &amp; attrition</h3>
              </header>
              <div className="setup-wizard__grid">
                <NumField
                  label="Weekly hiring plan (starts / week)"
                  value={draft.weeklyHiringPlan || 0}
                  min={0}
                  step={1}
                  placeholder="e.g. 5"
                  onChange={(weeklyHiringPlan) =>
                    setDraft((prev) => ({
                      ...prev,
                      weeklyHiringPlan: Math.max(0, weeklyHiringPlan),
                    }))
                  }
                />
                <NumField
                  label="Training attrition"
                  percent
                  value={draft.trainingAttritionRate}
                  min={0}
                  max={0.5}
                  step={0.1}
                  placeholder="e.g. 5"
                  onChange={(trainingAttritionRate) => setDraft((prev) => ({ ...prev, trainingAttritionRate }))}
                />
                <NumField
                  label="Nesting attrition"
                  percent
                  value={draft.nestingAttritionRate}
                  min={0}
                  max={0.5}
                  step={0.1}
                  placeholder="e.g. 3"
                  onChange={(nestingAttritionRate) => setDraft((prev) => ({ ...prev, nestingAttritionRate }))}
                />
                <NumField
                  label="Graduation rate"
                  percent
                  value={draft.graduationRate}
                  min={0}
                  max={1}
                  step={1}
                  placeholder="e.g. 95"
                  onChange={(graduationRate) => setDraft((prev) => ({ ...prev, graduationRate }))}
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
                        ? 'Copy Week 1 Required Production FTE to all future weeks'
                        : 'Automatically copy Week 1 drivers to all future weeks'}
                    </span>
                  </label>
                </label>
              </div>
            </div>
          </div>
        ) : null}

        <div className="setup-wizard__actions">
          <button type="button" className="saas-btn saas-btn--secondary" onClick={() => navigate('/')}>
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
            <button type="button" className="saas-btn" disabled={!canNext} onClick={createPlan}>
              Create plan
            </button>
          )}
        </div>
      </section>
    </div>
  )
}
