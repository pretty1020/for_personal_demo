import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDemoSession } from '../../context/DemoSessionContext'
import { HelpTip } from '../../components/planner/HelpTip'
import { ChannelAssumptionsPanel } from '../../components/planner/ChannelAssumptionsPanel'
import { ChannelSelector } from '../../components/planner/ChannelSelector'
import { ChannelStaffingSummary } from '../../components/planner/ChannelStaffingSummary'
import { PlanStartWeekField } from '../../components/planner/PlanStartWeekField'
import { KpiCard } from '../../components/planner/KpiCard'
import { NumField } from '../../components/planner/NumField'
import { TrainingPipelineTimeline } from '../../components/planner/TrainingPipelineTimeline'
import { usePlanner } from '../../context/PlannerContext'
import { applyAssumptionPatch, syncBusinessDerivedFields, syncChannelDerivedFields, syncDerivedTenuredFields } from '../../planner/assumptionDerivation'
import { defaultChannelAssumptions, getSupportedChannels, getTotalStartingProductionHc, normalizeChannelMix } from '../../planner/channelPlanning'
import { defaultCapacityPlanStartWeek } from '../../planner/capacityWeekUtils'
import { DEFAULT_PLAN_METADATA, DEFAULT_SUPPORTED_CHANNELS } from '../../planner/defaults'
import { runSimulation } from '../../planner/engine'
import { FIELD_DEFINITIONS } from '../../planner/fieldDefinitions'
import { fmtCurrency, fmtNum, fmtPct } from '../../planner/format'
import { METRIC_LABELS } from '../../planner/metricLabels'
import { DEFAULT_REFERENCE_SCENARIO_NAME } from '../../planner/scenarioNames'
import { SCENARIO_TEMPLATES } from '../../planner/templates'
import { ScenarioTemplateCard } from '../../components/planner/ScenarioTemplateCard'
import type { ChannelType, PlannerAssumptions, PlannerPlanMetadata, PlannerScenario } from '../../planner/types'
import { CHANNEL_LABELS } from '../../planner/types'
import { BILLABLE_TYPE_OPTIONS } from '../../utils/staffingCapacity/billingModel'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="cap-panel">
      <h3 className="cap-panel__title">{title}</h3>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  )
}

function AssumptionField({
  section,
  field,
  label,
  value,
  onChange,
  step,
  min,
  max,
}: {
  section: keyof PlannerAssumptions
  field: string
  label: string
  value: number
  onChange: (v: number) => void
  step?: number
  min?: number
  max?: number
}) {
  const key = `${section}.${field}`
  return (
    <NumField
      label={label}
      help={FIELD_DEFINITIONS[key]}
      value={value}
      onChange={onChange}
      step={step}
      min={min}
      max={max}
    />
  )
}

type Props = Record<string, never>

function planMetaLabel(plan: PlannerPlanMetadata) {
  const channels = getSupportedChannels(plan).map((c) => CHANNEL_LABELS[c]).join(', ')
  return `${plan.client} · ${plan.location} · ${plan.billingType} · ${plan.weekStart === 'monday' ? 'Mon' : 'Sun'} · ${channels}`
}

export function ScenariosAssumptionsPage(_props: Props) {
  const navigate = useNavigate()
  const { canViewFinancials } = useDemoSession()
  const {
    scenarios,
    activeScenario,
    granularity,
    capacityPlanView,
    selectScenario,
    createNewScenario,
    cloneScenario,
    deleteScenario,
    setBaseline,
    updateAssumptions,
    updateScenarioPlan,
    applyTemplate,
    publishScenarioToCapacity,
    resetToPreviousCapacityPlan,
    hasPreviousCapacityPlan,
  } = usePlanner()

  const [newName, setNewName] = useState('')
  const [newPlan, setNewPlan] = useState<PlannerPlanMetadata>(DEFAULT_PLAN_METADATA)
  const [newPlanChannels, setNewPlanChannels] = useState<ChannelType[]>([...DEFAULT_SUPPORTED_CHANNELS])
  const [newPlanStartWeek, setNewPlanStartWeek] = useState(defaultCapacityPlanStartWeek(DEFAULT_PLAN_METADATA.weekStart))
  const [newTrainingWeeks, setNewTrainingWeeks] = useState(4)
  const [newNestingWeeks, setNewNestingWeeks] = useState(2)
  const [draft, setDraft] = useState<PlannerAssumptions | null>(null)
  const [draftPlan, setDraftPlan] = useState<PlannerPlanMetadata | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const [templateFlash, setTemplateFlash] = useState('')
  const [openFlash, setOpenFlash] = useState<string | null>(null)
  const [resetFlash, setResetFlash] = useState<string | null>(null)
  const assumptionsEditorRef = useRef<HTMLDivElement | null>(null)

  const baselineScenario = useMemo(
    () => scenarios.find((s) => s.isBaseline) ?? scenarios[0] ?? null,
    [scenarios],
  )

  const baselineResult = useMemo(
    () => (baselineScenario ? runSimulation(baselineScenario, granularity) : null),
    [baselineScenario, granularity],
  )

  const baselinePeriod = baselineResult?.periods[baselineResult.periods.length - 1]

  useEffect(() => {
    setDraft(null)
    setDraftPlan(null)
  }, [activeScenario?.id])

  const workingAssumptions = activeScenario ? draft ?? activeScenario.assumptions : null
  const workingPlan = activeScenario ? draftPlan ?? activeScenario.plan : null
  const supportedChannels = workingPlan ? getSupportedChannels(workingPlan) : []

  const previewScenario = useMemo((): PlannerScenario | null => {
    if (!activeScenario || !workingAssumptions || !workingPlan) return null
    return { ...activeScenario, plan: workingPlan, assumptions: workingAssumptions }
  }, [activeScenario, workingAssumptions, workingPlan])

  const previewResult = useMemo(
    () => (previewScenario ? runSimulation(previewScenario, granularity) : null),
    [previewScenario, granularity],
  )

  const previewPeriod = previewResult?.periods[previewResult.periods.length - 1]
  const previewSummary = previewResult?.summary

  if (!activeScenario || !workingAssumptions || !workingPlan) {
    return <p className="saas-muted">No scenarios available. Refresh to load the baseline plan.</p>
  }

  const a = workingAssumptions
  const plan = workingPlan

  const patchChannels = (channels: PlannerAssumptions['channels']) => {
    setDraft({ ...a, channels })
  }

  const patchSupportedChannels = (nextChannels: ChannelType[]) => {
    const nextPlan = { ...plan, supportedChannels: nextChannels }
    setDraftPlan(nextPlan)
    const channelMap = { ...(a.channels ?? {}) }
    for (const ch of nextChannels) {
      if (!channelMap[ch]) {
        channelMap[ch] = defaultChannelAssumptions(ch)
      }
    }
    for (const key of Object.keys(channelMap) as ChannelType[]) {
      if (!nextChannels.includes(key)) {
        delete channelMap[key]
      }
    }
    setDraft({
      ...a,
      channels: normalizeChannelMix(channelMap, nextChannels),
    })
  }

  const patch = (section: keyof PlannerAssumptions, key: string, value: number) => {
    setDraft(applyAssumptionPatch(a, section, key, value))
  }

  const patchNestingPhoneRamp = (index: number, value: number) => {
    const nextRamp = [...a.newHire.nestingPhoneTimeRamp]
    nextRamp[index] = value
    setDraft({
      ...a,
      newHire: {
        ...a.newHire,
        nestingPhoneTimeRamp: nextRamp,
      },
    })
  }

  const save = () => {
    const toSave = syncChannelDerivedFields(
      syncBusinessDerivedFields(syncDerivedTenuredFields(draft ?? a)),
      draftPlan ?? plan,
    )
    updateAssumptions(activeScenario.id, toSave)
    if (draftPlan) {
      updateScenarioPlan(activeScenario.id, draftPlan)
    }
    setDraft(null)
    setDraftPlan(null)
    if (capacityPlanView?.scenarioId === activeScenario.id) {
      publishScenarioToCapacity(activeScenario.id)
    }
  }

  const resetDraft = () => {
    setDraft(null)
    setDraftPlan(null)
  }

  const saveToCapacityPlan = () => {
    const toSave = syncChannelDerivedFields(
      syncBusinessDerivedFields(syncDerivedTenuredFields(draft ?? a)),
      draftPlan ?? plan,
    )
    updateAssumptions(activeScenario.id, toSave)
    if (draftPlan) {
      updateScenarioPlan(activeScenario.id, draftPlan)
    }
    setDraft(null)
    setDraftPlan(null)
    window.setTimeout(() => {
      publishScenarioToCapacity(activeScenario.id)
    }, 0)
    setSavedFlash(true)
    window.setTimeout(() => setSavedFlash(false), 2500)
  }

  const openScenarioToCapacity = (scenarioId: string) => {
    const scenario = scenarios.find((item) => item.id === scenarioId)
    if (!scenario) return
    if (scenarioId === activeScenario.id && (draft || draftPlan)) {
      const toSave = syncChannelDerivedFields(
        syncBusinessDerivedFields(syncDerivedTenuredFields(draft ?? a)),
        draftPlan ?? plan,
      )
      updateAssumptions(activeScenario.id, toSave)
      if (draftPlan) {
        updateScenarioPlan(activeScenario.id, draftPlan)
      }
      setDraft(null)
      setDraftPlan(null)
    }
    publishScenarioToCapacity(scenarioId)
    setOpenFlash(scenario.name)
    window.setTimeout(() => setOpenFlash(null), 3000)
    navigate('/capacity-plan')
  }

  const editScenario = (scenarioId: string) => {
    selectScenario(scenarioId)
    window.setTimeout(() => {
      assumptionsEditorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
  }

  const resetPreviousCapacity = () => {
    const restored = resetToPreviousCapacityPlan()
    if (!restored) return
    setResetFlash('Previous capacity plan restored and republished.')
    window.setTimeout(() => setResetFlash(null), 3000)
    navigate('/capacity-plan')
  }

  const isLinkedToCapacity = capacityPlanView?.scenarioId === activeScenario.id
  const canResetPrevious = hasPreviousCapacityPlan()

  return (
    <div className="cap-scenario-layout space-y-6">
      <section className="cap-baseline-banner">
        <div className="cap-baseline-banner__head">
          <div>
            <p className="cap-baseline-banner__eyebrow">
              Starting point
              <HelpTip text="This is your main reference plan. New what-if scenarios copy these settings as a starting point." />
            </p>
            <h2 className="cap-baseline-banner__title">
              {baselineScenario?.name ?? DEFAULT_REFERENCE_SCENARIO_NAME}
              <span className="saas-badge saas-badge--muted">Reference</span>
            </h2>
            {baselineScenario ? <p className="cap-panel__desc m-0">{planMetaLabel(baselineScenario.plan)}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {activeScenario.id !== baselineScenario?.id ? (
              <button type="button" className="saas-btn saas-btn--secondary" onClick={() => baselineScenario && selectScenario(baselineScenario.id)}>
                View reference plan
              </button>
            ) : null}
            <div className="cap-publish-wrap">
              <button type="button" className="saas-btn" onClick={saveToCapacityPlan}>
                {isLinkedToCapacity ? 'Republish' : 'Publish to Capacity'}
              </button>
              <HelpTip
                text={
                  isLinkedToCapacity
                    ? 'Updates the Capacity page with your latest saved assumptions. Use this after you change hiring, volume, or cost settings.'
                    : 'Sends this scenario to the Capacity page so weekly staffing numbers match your plan.'
                }
              />
            </div>
            {savedFlash ? (
              <span className="cap-save-flash" role="status">
                {isLinkedToCapacity ? 'Republished to Capacity' : 'Published to Capacity'}
              </span>
            ) : null}
          </div>
        </div>
        {baselinePeriod ? (
          <div className="exec-kpi-grid mt-4">
            <KpiCard label={METRIC_LABELS.productionHeadcount} value={fmtNum(baselinePeriod.scheduledFte, 1)} />
            <KpiCard label="Scheduled hours" value={fmtNum(baselinePeriod.scheduledHours, 0)} />
            <KpiCard label="Productive hours" value={fmtNum(baselinePeriod.productiveHours, 0)} />
            <KpiCard label="OT hours" value={fmtNum(baselinePeriod.otHours, 0)} />
            <KpiCard label="VTO hours" value={fmtNum(baselinePeriod.vtoHours, 0)} />
            <KpiCard label="In-office shrinkage" value={fmtNum(baselinePeriod.shrinkageInOfficeHours, 0)} />
            <KpiCard label="Out-of-office shrinkage" value={fmtNum(baselinePeriod.shrinkageOutOfOfficeHours, 0)} />
            {canViewFinancials ? (
              <KpiCard label="Revenue (horizon)" value={fmtCurrency(baselineResult?.summary.revenueProjection ?? 0)} />
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="cap-panel">
        <h3 className="cap-panel__title">Your plans</h3>
        <p className="cap-panel__desc m-0 mt-1">
          Create a new plan or use <strong>Open</strong> to publish a scenario, open the Capacity view, and use{' '}
          <strong>Publish</strong> there for updates. Use <strong>Reset</strong> to republish the previous capacity plan.
        </p>

        {openFlash ? (
          <p className="cap-save-flash mt-3" role="status">
            Opened {openFlash} in Capacity. You can Publish updates from the Capacity page.
          </p>
        ) : null}
        {resetFlash ? (
          <p className="cap-save-flash mt-3" role="status">
            {resetFlash}
          </p>
        ) : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <input
            className="cap-field__input"
            placeholder="Plan name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <input
            className="cap-field__input"
            placeholder="Client"
            value={newPlan.client}
            onChange={(e) => setNewPlan((prev) => ({ ...prev, client: e.target.value }))}
          />
          <input
            className="cap-field__input"
            placeholder="LOB"
            value={newPlan.location}
            onChange={(e) => setNewPlan((prev) => ({ ...prev, location: e.target.value }))}
          />
          <select
            className="cap-field__input"
            value={newPlan.billingType}
            onChange={(e) => setNewPlan((prev) => ({ ...prev, billingType: e.target.value }))}
          >
            {BILLABLE_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            className="cap-field__input"
            value={newPlan.weekStart}
            onChange={(e) => setNewPlan((prev) => ({ ...prev, weekStart: e.target.value as PlannerPlanMetadata['weekStart'] }))}
          >
            <option value="sunday">Week start: Sunday</option>
            <option value="monday">Week start: Monday</option>
          </select>
        </div>

        <div className="mt-4">
          <PlanStartWeekField
            weekStart={newPlan.weekStart}
            value={newPlanStartWeek}
            onChange={setNewPlanStartWeek}
            compact
          />
        </div>

        <div className="mt-4">
          <ChannelSelector selected={newPlanChannels} onChange={setNewPlanChannels} compact />
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input
            className="cap-field__input"
            type="number"
            min={1}
            placeholder="Training duration"
            value={newTrainingWeeks}
            onChange={(e) => setNewTrainingWeeks(Math.max(1, Number(e.target.value) || 1))}
          />
          <input
            className="cap-field__input"
            type="number"
            min={1}
            placeholder="Nesting duration"
            value={newNestingWeeks}
            onChange={(e) => setNewNestingWeeks(Math.max(1, Number(e.target.value) || 1))}
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="saas-btn"
            onClick={() => {
              if (!newName.trim() || !newPlanChannels.length) return
              const planWithChannels = {
                ...newPlan,
                supportedChannels: newPlanChannels,
                capacityPlanStartWeek: newPlanStartWeek,
              }
              const channelDefaults = normalizeChannelMix(
                Object.fromEntries(newPlanChannels.map((ch) => [ch, defaultChannelAssumptions(ch)])),
                newPlanChannels,
              )
              const nextAssumptions = syncBusinessDerivedFields(syncDerivedTenuredFields({
                ...a,
                channels: channelDefaults,
                newHire: {
                  ...a.newHire,
                  trainingWeeks: newTrainingWeeks,
                  nestingWeeks: newNestingWeeks,
                  graduationWeek: Math.max(1, newTrainingWeeks + newNestingWeeks),
                },
              }))
              createNewScenario(newName.trim(), '', planWithChannels, nextAssumptions)
              setNewName('')
              setNewPlan(DEFAULT_PLAN_METADATA)
              setNewPlanChannels([...DEFAULT_SUPPORTED_CHANNELS])
              setNewPlanStartWeek(defaultCapacityPlanStartWeek(DEFAULT_PLAN_METADATA.weekStart))
              setNewTrainingWeeks(4)
              setNewNestingWeeks(2)
            }}
            disabled={!newPlanChannels.length}
          >
            Create plan
          </button>
        </div>

        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
          <table className="wfp-table w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-bold uppercase text-slate-600">
              <tr>
                <th className="px-4 py-3">Scenario</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">LOB</th>
                <th className="px-4 py-3">Channels</th>
                <th className="px-4 py-3">Billing</th>
                <th className="px-4 py-3">Week start</th>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {scenarios.map((s) => (
                <tr key={s.id} className={`border-t border-slate-100 ${activeScenario.id === s.id ? 'bg-slate-50' : ''}`}>
                  <td className="px-4 py-3 font-medium">{s.name}</td>
                  <td className="px-4 py-3">{s.plan.client}</td>
                  <td className="px-4 py-3">{s.plan.location}</td>
                  <td className="px-4 py-3">{getSupportedChannels(s.plan).map((c) => CHANNEL_LABELS[c]).join(', ')}</td>
                  <td className="px-4 py-3">{s.plan.billingType}</td>
                  <td className="px-4 py-3">{s.plan.weekStart === 'monday' ? 'Monday' : 'Sunday'}</td>
                  <td className="px-4 py-3">{s.isBaseline ? 'Yes' : '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{new Date(s.updatedAt).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="cap-link" onClick={() => openScenarioToCapacity(s.id)}>
                        {capacityPlanView?.scenarioId === s.id ? 'Republish' : 'Open'}
                      </button>
                      {canResetPrevious && capacityPlanView?.scenarioId === s.id ? (
                        <button
                          type="button"
                          className="cap-link"
                          title="Restore and republish the previous capacity plan"
                          onClick={resetPreviousCapacity}
                        >
                          Reset
                        </button>
                      ) : null}
                      <button type="button" className="cap-link cap-link--muted" onClick={() => editScenario(s.id)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="cap-link cap-link--muted"
                        onClick={() => {
                          cloneScenario(s.id)
                          window.setTimeout(() => {
                            assumptionsEditorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                          }, 50)
                        }}
                      >
                        Clone
                      </button>
                      <button
                        type="button"
                        className="cap-link cap-link--muted"
                        disabled={s.isBaseline}
                        onClick={() => setBaseline(s.id)}
                      >
                        Set as reference
                      </button>
                      {!s.isBaseline ? (
                        <button
                          type="button"
                          className="cap-link cap-link--danger"
                          onClick={() => {
                            if (window.confirm(`Delete scenario "${s.name}"? This cannot be undone.`)) {
                              deleteScenario(s.id)
                            }
                          }}
                        >
                          Delete
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SCENARIO_TEMPLATES.map((t) => (
            <ScenarioTemplateCard
              key={t.id}
              template={t}
              onApply={(templateId) => {
                applyTemplate(templateId)
                setDraft(null)
                setTemplateFlash(t.name)
                window.setTimeout(() => setTemplateFlash(''), 2500)
              }}
            />
          ))}
        </div>
        {templateFlash ? (
          <p className="cap-save-flash mt-2" role="status">
            {templateFlash} applied to {activeScenario.name}
          </p>
        ) : null}
      </section>

      <div className="flex flex-wrap items-end justify-between gap-4" ref={assumptionsEditorRef}>
        <div>
          <h2 className="exec-section-title m-0">{activeScenario.name}</h2>
          <p className="cap-panel__desc m-0 mt-1">{planMetaLabel(activeScenario.plan)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {draft || draftPlan ? (
            <button type="button" className="saas-btn saas-btn--secondary" onClick={resetDraft}>
              Reset changes
            </button>
          ) : null}
          <button type="button" className="saas-btn" onClick={save}>
            Save assumptions
          </button>
        </div>
      </div>

      <Section title="New hire">
        <AssumptionField section="newHire" field="hiringPlanPerPeriod" label="Hiring plan (per week)" value={a.newHire.hiringPlanPerPeriod} onChange={(v) => patch('newHire', 'hiringPlanPerPeriod', v)} />
        <AssumptionField section="newHire" field="classSize" label="Class size" value={a.newHire.classSize} onChange={(v) => patch('newHire', 'classSize', v)} />
        <AssumptionField section="newHire" field="trainingWeeks" label="Training duration (weeks)" value={a.newHire.trainingWeeks} onChange={(v) => patch('newHire', 'trainingWeeks', v)} />
        <AssumptionField section="newHire" field="nestingWeeks" label="Nesting period (weeks)" value={a.newHire.nestingWeeks} onChange={(v) => patch('newHire', 'nestingWeeks', v)} />
        <AssumptionField section="newHire" field="timeToProficiencyWeeks" label="Time to proficiency (weeks)" value={a.newHire.timeToProficiencyWeeks} onChange={(v) => patch('newHire', 'timeToProficiencyWeeks', v)} />
        <AssumptionField section="newHire" field="hiringDelayWeeks" label="Hiring delay (weeks)" value={a.newHire.hiringDelayWeeks} onChange={(v) => patch('newHire', 'hiringDelayWeeks', v)} />
        {canViewFinancials ? (
          <AssumptionField section="newHire" field="trainingCostPerHire" label="Training cost per hire ($)" value={a.newHire.trainingCostPerHire} step={100} onChange={(v) => patch('newHire', 'trainingCostPerHire', v)} />
        ) : null}
        <AssumptionField section="newHire" field="graduationRate" label="Graduation rate" value={a.newHire.graduationRate} step={0.01} min={0} max={1} onChange={(v) => patch('newHire', 'graduationRate', v)} />
      </Section>

      <Section title="Training pipeline">
        <div className="saas-field sm:col-span-2 lg:col-span-3">
          <span className="saas-field__label">
            Total starting production HC (all channels)
            <HelpTip text="Auto-calculated as the sum of per-channel starting production HC. Set starting HC on each channel tab." />
          </span>
          <p className="cap-field__input m-0 bg-slate-50 font-semibold text-slate-800">
            {fmtNum(getTotalStartingProductionHc(a, plan), 0)}
          </p>
        </div>
        <AssumptionField section="newHire" field="trainingAttritionRate" label="Training attrition %" value={a.newHire.trainingAttritionRate} step={0.01} min={0} max={0.5} onChange={(v) => patch('newHire', 'trainingAttritionRate', v)} />
        <AssumptionField section="newHire" field="nestingAttritionRate" label="Nesting attrition %" value={a.newHire.nestingAttritionRate} step={0.01} min={0} max={0.5} onChange={(v) => patch('newHire', 'nestingAttritionRate', v)} />
        <AssumptionField section="newHire" field="nestingPhoneTimePct" label="Default nesting phone time %" value={a.newHire.nestingPhoneTimePct} step={0.05} min={0} max={1} onChange={(v) => patch('newHire', 'nestingPhoneTimePct', v)} />
        <AssumptionField section="newHire" field="graduationWeek" label="Graduation week" value={a.newHire.graduationWeek} min={1} onChange={(v) => patch('newHire', 'graduationWeek', v)} />
        <div className="cap-training-ramp-field sm:col-span-2 lg:col-span-3">
          <div className="cap-training-ramp-field__head">
            <span className="saas-field__label">
              Nesting phone time progression
              <HelpTip text="Optional week-by-week nesting productivity ramp. The last value is reused if nesting lasts longer." />
            </span>
          </div>
          <div className="cap-training-ramp-grid">
            {Array.from({ length: Math.max(1, a.newHire.nestingWeeks) }).map((_, index) => (
              <NumField
                key={index}
                label={`Week ${index + 1}`}
                value={a.newHire.nestingPhoneTimeRamp[index] ?? a.newHire.nestingPhoneTimePct}
                onChange={(v) => patchNestingPhoneRamp(index, v)}
                step={0.05}
                min={0}
                max={1}
              />
            ))}
          </div>
        </div>
      </Section>

      <Section title="Tenured staff">
        <AssumptionField section="tenured" field="attritionRateMonthly" label="Production attrition (monthly rate)" value={a.tenured.attritionRateMonthly} step={0.001} min={0} max={0.2} onChange={(v) => patch('tenured', 'attritionRateMonthly', v)} />
        <AssumptionField section="tenured" field="shrinkageRate" label="Shrinkage rate" value={a.tenured.shrinkageRate} step={0.01} min={0} max={0.6} onChange={(v) => patch('tenured', 'shrinkageRate', v)} />
        <AssumptionField section="tenured" field="shrinkageInOfficeShare" label="In-office shrinkage share" value={a.tenured.shrinkageInOfficeShare} step={0.01} min={0} max={1} onChange={(v) => patch('tenured', 'shrinkageInOfficeShare', v)} />
        <AssumptionField section="tenured" field="standardScheduledHoursPerWeek" label="Scheduled hrs / FTE / week" value={a.tenured.standardScheduledHoursPerWeek} step={0.5} min={20} max={60} onChange={(v) => patch('tenured', 'standardScheduledHoursPerWeek', v)} />
        <AssumptionField section="tenured" field="otHoursPerFtePerWeek" label="OT hrs / FTE / week" value={a.tenured.otHoursPerFtePerWeek} step={0.1} min={0} max={20} onChange={(v) => patch('tenured', 'otHoursPerFtePerWeek', v)} />
        <AssumptionField section="tenured" field="vtoHoursPerFtePerWeek" label="VTO hrs / FTE / week" value={a.tenured.vtoHoursPerFtePerWeek} step={0.1} min={0} max={20} onChange={(v) => patch('tenured', 'vtoHoursPerFtePerWeek', v)} />
        <AssumptionField section="tenured" field="occupancyTarget" label="Occupancy target" value={a.tenured.occupancyTarget} step={0.01} min={0.75} max={1} onChange={(v) => patch('tenured', 'occupancyTarget', v)} />
        <AssumptionField section="tenured" field="productivityFactor" label="Productivity factor" value={a.tenured.productivityFactor} step={0.01} min={0} max={1.2} onChange={(v) => patch('tenured', 'productivityFactor', v)} />
        <AssumptionField section="tenured" field="attendanceRate" label="Attendance rate" value={a.tenured.attendanceRate} step={0.01} min={0} max={1} onChange={(v) => patch('tenured', 'attendanceRate', v)} />
        <AssumptionField section="tenured" field="scheduleAdherence" label="Schedule adherence" value={a.tenured.scheduleAdherence} step={0.01} min={0} max={1} onChange={(v) => patch('tenured', 'scheduleAdherence', v)} />
        <AssumptionField section="tenured" field="ahtSeconds" label="AHT (seconds)" value={a.tenured.ahtSeconds} step={5} min={60} max={900} onChange={(v) => patch('tenured', 'ahtSeconds', v)} />
        <AssumptionField section="tenured" field="utilizationTarget" label="Utilization target" value={a.tenured.utilizationTarget} step={0.01} min={0} max={1} onChange={(v) => patch('tenured', 'utilizationTarget', v)} />
        <AssumptionField section="tenured" field="crossSkilledShare" label="Cross-skilled share" value={a.tenured.crossSkilledShare} step={0.01} min={0} max={1} onChange={(v) => patch('tenured', 'crossSkilledShare', v)} />
        <div className="saas-field">
          <span className="saas-field__label">
            Productive hrs / FTE / week
            <HelpTip text="Auto-calculated from scheduled hours, shrinkage, occupancy, and productivity." />
          </span>
          <p className="cap-field__input m-0 bg-slate-50 font-semibold text-slate-800">{fmtNum(a.tenured.productiveHoursPerFtePerWeek, 2)}</p>
        </div>
        {canViewFinancials ? (
          <AssumptionField section="tenured" field="laborCostPerFteMonthly" label="Labor cost / FTE / month ($)" value={a.tenured.laborCostPerFteMonthly} step={50} min={1500} onChange={(v) => patch('tenured', 'laborCostPerFteMonthly', v)} />
        ) : null}
      </Section>

      <section className="cap-panel">
        <ChannelSelector selected={supportedChannels} onChange={patchSupportedChannels} />
      </section>

      <ChannelAssumptionsPanel
        supportedChannels={supportedChannels}
        channels={a.channels ?? {}}
        onChange={patchChannels}
      />

      <Section title="Business">
        <AssumptionField section="business" field="baseForecastVolume" label="Base forecast volume (monthly)" value={a.business.baseForecastVolume} step={500} min={1000} onChange={(v) => patch('business', 'baseForecastVolume', v)} />
        <AssumptionField section="business" field="growthRateMonthly" label={`Growth rate (monthly · ${fmtPct(a.business.growthRateMonthly)} / mo)`} value={a.business.growthRateMonthly} step={0.005} min={0} max={0.15} onChange={(v) => patch('business', 'growthRateMonthly', v)} />
        <AssumptionField section="business" field="serviceLevelTarget" label="Service level target" value={a.business.serviceLevelTarget} step={0.01} min={0} max={1} onChange={(v) => patch('business', 'serviceLevelTarget', v)} />
        <AssumptionField section="business" field="asaTargetSeconds" label="ASA target (sec)" value={a.business.asaTargetSeconds} step={1} min={5} onChange={(v) => patch('business', 'asaTargetSeconds', v)} />
        <AssumptionField section="business" field="responseTimeTargetSeconds" label="Response time target (sec)" value={a.business.responseTimeTargetSeconds} step={10} min={30} onChange={(v) => patch('business', 'responseTimeTargetSeconds', v)} />
        {canViewFinancials ? (
          <>
            <AssumptionField section="business" field="budgetConstraintMonthly" label="Budget constraint / month ($)" value={a.business.budgetConstraintMonthly} step={5000} min={50000} onChange={(v) => patch('business', 'budgetConstraintMonthly', v)} />
            <AssumptionField section="business" field="revenueTargetMonthly" label="Revenue target / month ($)" value={a.business.revenueTargetMonthly} step={5000} min={50000} onChange={(v) => patch('business', 'revenueTargetMonthly', v)} />
            <AssumptionField section="business" field="revenuePerContact" label="Revenue per contact ($)" value={a.business.revenuePerContact} step={0.1} min={0.5} onChange={(v) => patch('business', 'revenuePerContact', v)} />
            <AssumptionField section="business" field="slaPenaltyPerMissedPoint" label="SLA penalty / point ($)" value={a.business.slaPenaltyPerMissedPoint} step={500} min={0} onChange={(v) => patch('business', 'slaPenaltyPerMissedPoint', v)} />
          </>
        ) : null}
        <AssumptionField section="business" field="requiredOccupancy" label="Required occupancy" value={a.business.requiredOccupancy} step={0.01} min={0.75} max={1} onChange={(v) => patch('business', 'requiredOccupancy', v)} />
        <AssumptionField section="business" field="staffingBufferPct" label="Staffing buffer %" value={a.business.staffingBufferPct} step={0.01} min={0} max={0.25} onChange={(v) => patch('business', 'staffingBufferPct', v)} />
        <AssumptionField section="business" field="overtimeMultiplier" label="Overtime multiplier" value={a.business.overtimeMultiplier} step={0.05} min={1} max={3} onChange={(v) => patch('business', 'overtimeMultiplier', v)} />
      </Section>

      {previewSummary?.channelStaffing ? (
        <ChannelStaffingSummary
          staffing={previewSummary.channelStaffing}
          financials={previewSummary.channelFinancials}
          showFinancials={canViewFinancials}
        />
      ) : null}

      {previewSummary && previewPeriod ? (
        <section className="cap-panel cap-panel--accent">
          <h3 className="cap-panel__title">Capacity preview — {activeScenario.name}</h3>
          {draft ? <p className="cap-panel__desc m-0">Unsaved preview</p> : null}
          <div className="exec-kpi-grid mt-3">
            <KpiCard label={METRIC_LABELS.requiredHeadcount} value={fmtNum(previewSummary.requiredFte, 1)} />
            <KpiCard label={METRIC_LABELS.beginningProductionHeadcount} value={fmtNum(previewPeriod.beginningProductionHc, 1)} />
            <KpiCard label={METRIC_LABELS.productionHeadcount} value={fmtNum(previewSummary.workforceFte, 1)} />
            <KpiCard label={METRIC_LABELS.productionFte} value={fmtNum(previewSummary.productionFte, 1)} />
            <KpiCard
              label={METRIC_LABELS.staffingPct}
              value={previewPeriod.staffingPct == null ? '—' : fmtPct(previewPeriod.staffingPct)}
              tone={
                previewPeriod.staffingPct == null
                  ? 'neutral'
                  : previewPeriod.staffingPct < 0.95
                    ? 'bad'
                    : previewPeriod.staffingPct < 1
                      ? 'warn'
                      : previewPeriod.staffingPct <= 1.05
                        ? 'good'
                        : 'info'
              }
            />
            <KpiCard label="Latest forecast volume" value={fmtNum(previewPeriod.forecastVolume, 0)} />
            <KpiCard label={METRIC_LABELS.occupancy} value={fmtPct(previewSummary.occupancy)} />
            <KpiCard label="Hiring (horizon)" value={fmtNum(previewSummary.hiringTotal, 0)} />
            {canViewFinancials ? (
              <>
                <KpiCard label="Revenue (horizon)" value={fmtCurrency(previewSummary.revenueProjection)} />
                <KpiCard label={METRIC_LABELS.costLeakage} value={fmtCurrency(previewSummary.totalLeakage)} tone="warn" />
              </>
            ) : null}
          </div>
        </section>
      ) : null}

      {previewResult ? <TrainingPipelineTimeline periods={previewResult.periods} assumptions={a} /> : null}

      {!activeScenario.isBaseline && previewSummary && baselineResult?.summary ? (
        <section className="cap-panel cap-panel--accent">
          <h3 className="cap-panel__title">vs {DEFAULT_REFERENCE_SCENARIO_NAME}</h3>
          {draft ? <p className="cap-panel__desc m-0">Unsaved preview</p> : null}
          <div className="exec-kpi-grid mt-3">
            <KpiCard
              label="Required HC delta"
              value={fmtNum(previewSummary.requiredFte - baselineResult.summary.requiredFte, 1)}
              tone={previewSummary.requiredFte > baselineResult.summary.requiredFte ? 'warn' : 'good'}
            />
            <KpiCard
              label="Production HC delta"
              value={fmtNum(previewSummary.workforceFte - baselineResult.summary.workforceFte, 1)}
            />
            {canViewFinancials ? (
              <>
                <KpiCard
                  label="Revenue delta"
                  value={fmtCurrency(previewSummary.revenueProjection - baselineResult.summary.revenueProjection)}
                />
                <KpiCard
                  label="Cost delta"
                  value={fmtCurrency(previewSummary.costProjection - baselineResult.summary.costProjection)}
                />
              </>
            ) : null}
            <KpiCard
              label="Hiring plan delta"
              value={fmtNum(previewSummary.hiringTotal - baselineResult.summary.hiringTotal, 0)}
            />
          </div>
        </section>
      ) : null}
    </div>
  )
}
