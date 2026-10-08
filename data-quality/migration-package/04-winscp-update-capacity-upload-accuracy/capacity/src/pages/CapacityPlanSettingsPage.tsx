import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CapacityDataUploadPanel } from '../components/planner/CapacityDataUploadPanel'
import { ChannelSelector } from '../components/planner/ChannelSelector'
import { NumField } from '../components/planner/NumField'
import { PlanStartWeekField } from '../components/planner/PlanStartWeekField'
import { ShrinkagePlanningPanel } from '../components/planner/ShrinkagePlanningPanel'
import { StageAttritionPanel } from '../components/planner/StageAttritionPanel'
import { ModulePageHeader } from '../components/shell/ModulePageHeader'
import { useDemoSession } from '../context/DemoSessionContext'
import { usePlanner } from '../context/PlannerContext'
import { flushAllCapacityDocuments } from '../data/capacityDocuments'
import { flushStaffingPlanRequiredHcSync } from '../data/staffingPlanSync'
import { deriveCapacityPlanRows } from '../planner/capacityPlanDerived'
import { loadCapacityMatrixView, saveCapacityMatrixView } from '../planner/capacityViewPersistence'
import {
  forecastModesEqual,
  loadScenarioForecastModes,
  saveScenarioForecastModes,
  type ScenarioForecastModes,
} from '../planner/capacityForecastModesPersistence'
import { resolveCurrentCalendarWeek } from '../planner/capacityWeekUtils'
import { syncBusinessDerivedFields, syncDerivedTenuredFields } from '../planner/assumptionDerivation'
import { getSupportedChannels, initChannelsForSupported } from '../planner/channelPlanning'
import { DEFAULT_VISIBLE_SHRINKAGE_CATEGORY_IDS, resolveActiveShrinkageCategoryIds } from '../planner/shrinkageCategories'
import { billableTypeLabel, BILLABLE_TYPE_OPTIONS, resolveBillableTypeOptionValue } from '../utils/staffingCapacity/billingModel'
import { resolvePlanLob, resolvePlanLocation } from '../planner/planIdentity'

const DEFAULT_FORECAST_MODES: ScenarioForecastModes = {
  callVolume: 'manual',
  ahtSeconds: 'manual',
  occupancy: 'manual',
  totalShrinkagePct: 'manual',
  attritionHc: 'forecast',
}

export function CapacityPlanSettingsPage() {
  const navigate = useNavigate()
  const { canCreatePlans, canEditCapacity, isAdmin } = useDemoSession()
  const {
    scenarios,
    activeScenario,
    selectScenario,
    updateScenarioPlan,
    updateAssumptions,
    getScenarioCapacityPlanOverrides,
    getScenarioLedger,
    getScenarioForecast,
    getScenarioStageAttritionOverrides,
    getScenarioShrinkageCategories,
    updatePlannedShrinkageCategory,
    addScenarioShrinkageCategory,
    deleteScenarioShrinkageCategory,
    updateStageAttritionRate,
    applyPlannedWeekOverrides,
    deleteScenario,
    hasPreviousCapacityPlan,
    resetToPreviousCapacityPlan,
  } = usePlanner()

  const visible = useMemo(() => scenarios.filter((s) => !s.isBaseline), [scenarios])
  const scenario = activeScenario && !activeScenario.isBaseline ? activeScenario : visible[0] ?? null

  const [forecastModes, setForecastModes] = useState<ScenarioForecastModes>(DEFAULT_FORECAST_MODES)
  const [message, setMessage] = useState('')
  const [visibleShrinkageIds, setVisibleShrinkageIds] = useState<string[]>(() => {
    const saved = loadCapacityMatrixView()?.visibleShrinkageCategoryIds
    return saved?.length ? saved : [...DEFAULT_VISIBLE_SHRINKAGE_CATEGORY_IDS]
  })

  useEffect(() => {
    if (!scenario) return
    setForecastModes({
      ...DEFAULT_FORECAST_MODES,
      ...loadScenarioForecastModes(scenario.id),
    })
  }, [scenario?.id])

  const plannedOverrides = scenario ? getScenarioCapacityPlanOverrides(scenario.id) : {}
  const ledger = scenario ? getScenarioLedger(scenario.id) : []
  const forecast = scenario ? getScenarioForecast(scenario.id, 52) : null
  const stageOverrides = scenario ? getScenarioStageAttritionOverrides(scenario.id) : {}
  const categories = scenario ? getScenarioShrinkageCategories(scenario.id) : []
  const activeShrinkageIds = resolveActiveShrinkageCategoryIds(
    visibleShrinkageIds,
    categories.map((item) => item.id),
  )
  const currentWeek = resolveCurrentCalendarWeek(scenario?.plan.weekStart ?? 'sunday')

  const derivedRows = useMemo(() => {
    if (!scenario || !forecast) return []
    return deriveCapacityPlanRows(ledger, scenario, forecast, plannedOverrides, forecastModes)
  }, [forecast, forecastModes, ledger, plannedOverrides, scenario])

  const getPlannedShrinkageValue = (week: string, categoryId: string): number | null => {
    const fromOverride = plannedOverrides[week]?.shrinkageById?.[categoryId]
    if (fromOverride != null) return fromOverride
    return null
  }

  if (!scenario) {
    return (
      <div className="plan-settings">
        <ModulePageHeader title="Plan settings" description="No client plan yet." />
        <p className="saas-muted">Add a client from Home, then return here to configure the plan.</p>
        <button type="button" className="saas-btn" onClick={() => navigate('/setup')}>
          Add a client
        </button>
      </div>
    )
  }

  const savedModes = { ...DEFAULT_FORECAST_MODES, ...loadScenarioForecastModes(scenario.id) }
  const driversDirty = !forecastModesEqual(forecastModes, savedModes)

  const updatePipeline = (
    field: 'trainingWeeks' | 'nestingWeeks' | 'trainingAttritionRate' | 'nestingAttritionRate',
    value: number,
  ) => {
    const currentRamp = Array.isArray(scenario.assumptions.newHire.nestingPhoneTimeRamp)
      ? scenario.assumptions.newHire.nestingPhoneTimeRamp
      : []
    const next = {
      ...scenario.assumptions,
      newHire: {
        ...scenario.assumptions.newHire,
        nestingPhoneTimeRamp: currentRamp,
        [field]: value,
      },
    }
    if (field === 'trainingWeeks' || field === 'nestingWeeks') {
      next.newHire.graduationWeek = Math.max(1, next.newHire.trainingWeeks + next.newHire.nestingWeeks)
    }
    if (field === 'nestingWeeks') {
      const weeks = Math.max(1, Math.round(value))
      const defaultPhone = scenario.assumptions.newHire.nestingPhoneTimePct
      next.newHire.nestingPhoneTimeRamp = Array.from({ length: weeks }, (_, index) => currentRamp[index] ?? defaultPhone)
      next.newHire.nestingPhoneTimePct = next.newHire.nestingPhoneTimeRamp[0] ?? defaultPhone
    }
    updateAssumptions(scenario.id, syncBusinessDerivedFields(syncDerivedTenuredFields(next)))
  }

  const updateNestingPhoneWeek = (weekIndex: number, value: number) => {
    const weeks = Math.max(1, Math.round(scenario.assumptions.newHire.nestingWeeks))
    const currentRamp = Array.isArray(scenario.assumptions.newHire.nestingPhoneTimeRamp)
      ? scenario.assumptions.newHire.nestingPhoneTimeRamp
      : []
    const ramp = Array.from(
      { length: weeks },
      (_, index) => (index === weekIndex ? value : (currentRamp[index] ?? scenario.assumptions.newHire.nestingPhoneTimePct)),
    )
    updateAssumptions(
      scenario.id,
      syncBusinessDerivedFields(
        syncDerivedTenuredFields({
          ...scenario.assumptions,
          newHire: {
            ...scenario.assumptions.newHire,
            nestingPhoneTimeRamp: ramp,
            nestingPhoneTimePct: ramp[0] ?? 0,
          },
        }),
      ),
    )
  }

  const saveDrivers = () => {
    saveScenarioForecastModes(scenario.id, forecastModes)
    const view = loadCapacityMatrixView()
    if (view) {
      saveCapacityMatrixView({
        ...view,
        visibleShrinkageCategoryIds: visibleShrinkageIds,
        savedAt: new Date().toISOString(),
      })
    }
    setMessage('Settings saved.')
  }

  return (
    <div className="plan-settings">
      <ModulePageHeader
        title="Plan settings"
        description={`${scenario.plan.client} — ${resolvePlanLob(scenario.plan)}${resolvePlanLocation(scenario.plan) ? ` · ${resolvePlanLocation(scenario.plan)}` : ''} · ${billableTypeLabel(scenario.plan.billingType)}`}
        actions={
          <div className="plan-settings__actions">
            {canCreatePlans ? (
              <button
                type="button"
                className="saas-btn saas-btn--secondary"
                onClick={() => {
                  const params = new URLSearchParams()
                  if (scenario.plan.clientId) params.set('clientId', scenario.plan.clientId)
                  if (scenario.plan.client) params.set('clientName', scenario.plan.client)
                  navigate(`/setup?${params.toString()}`)
                }}
              >
                Add LOB
              </button>
            ) : null}
            <button type="button" className="saas-btn saas-btn--secondary" onClick={() => navigate('/capacity-plan')}>
              Back to grid
            </button>
            <button type="button" className="saas-btn" onClick={saveDrivers}>
              {driversDirty ? 'Save settings' : message ? 'Saved' : 'Save settings'}
            </button>
          </div>
        }
      />

      {message ? <p className="plan-settings__flash">{message}</p> : null}

      <div className="plan-settings__grid">
        <section className="plan-settings__card">
          <header>
            <p className="plan-settings__eyebrow">Scope</p>
            <h3>Which plan?</h3>
          </header>
          <label className="saas-field">
            <span className="saas-field__label">Client / team</span>
            <select
              className="cap-field__input"
              value={scenario.id}
              onChange={(event) => {
                selectScenario(event.target.value)
                setMessage('')
              }}
            >
              {visible.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.plan.client} · {resolvePlanLob(item.plan)}
                  {resolvePlanLocation(item.plan) ? ` · ${resolvePlanLocation(item.plan)}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="saas-field">
            <span className="saas-field__label">LOB</span>
            <input
              className="cap-field__input"
              type="text"
              disabled={!canEditCapacity}
              value={resolvePlanLob(scenario.plan)}
              onChange={(event) => {
                updateScenarioPlan(scenario.id, {
                  ...scenario.plan,
                  lob: event.target.value,
                  // Promote legacy LOB-in-location into dedicated lob; keep site blank until set.
                  location: scenario.plan.lob?.trim() ? scenario.plan.location : '',
                })
                setMessage('')
              }}
              placeholder="e.g. Voice · Tier 1"
            />
          </label>
          {canCreatePlans ? (
            <p className="saas-muted m-0 text-sm">
              To add another LOB under <strong>{scenario.plan.client}</strong>, use{' '}
              <button
                type="button"
                className="portfolio-hierarchy__link"
                onClick={() => {
                  const params = new URLSearchParams()
                  if (scenario.plan.clientId) params.set('clientId', scenario.plan.clientId)
                  if (scenario.plan.client) params.set('clientName', scenario.plan.client)
                  navigate(`/setup?${params.toString()}`)
                }}
              >
                Add LOB
              </button>
              .
            </p>
          ) : null}
          <label className="saas-field">
            <span className="saas-field__label">Location</span>
            <input
              className="cap-field__input"
              type="text"
              disabled={!canEditCapacity}
              value={resolvePlanLocation(scenario.plan)}
              onChange={(event) => {
                updateScenarioPlan(scenario.id, {
                  ...scenario.plan,
                  lob: resolvePlanLob(scenario.plan),
                  location: event.target.value,
                })
                setMessage('')
              }}
              placeholder="e.g. Manila"
            />
          </label>
          <label className="saas-field">
            <span className="saas-field__label">Billing type</span>
            <select
              className="cap-field__input"
              disabled={!canEditCapacity}
              value={resolveBillableTypeOptionValue(scenario.plan.billingType)}
              onChange={(event) => {
                updateScenarioPlan(scenario.id, {
                  ...scenario.plan,
                  billingType: event.target.value,
                })
                setMessage('')
              }}
            >
              {BILLABLE_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="saas-field">
            <ChannelSelector
              single
              disabled={!canEditCapacity}
              selected={getSupportedChannels(scenario.plan)}
              onChange={(supportedChannels) => {
                if (!canEditCapacity) return
                updateScenarioPlan(scenario.id, {
                  ...scenario.plan,
                  supportedChannels,
                  requiredProductionPrimaryChannel: supportedChannels[0],
                })
                updateAssumptions(
                  scenario.id,
                  syncBusinessDerivedFields(
                    syncDerivedTenuredFields({
                      ...scenario.assumptions,
                      channels: initChannelsForSupported(
                        scenario.assumptions.channels ?? {},
                        supportedChannels,
                        {
                          trainingWeeks: scenario.assumptions.newHire.trainingWeeks,
                          nestingWeeks: scenario.assumptions.newHire.nestingWeeks,
                          requireUserEntry: false,
                        },
                      ),
                    }),
                  ),
                )
                setMessage('Channel updated.')
              }}
            />
            {!canEditCapacity ? (
              <p className="saas-muted m-0 text-xs">You do not have permission to change the channel.</p>
            ) : null}
          </div>

          <div className="plan-settings__project">
            <div className="plan-settings__project-head" aria-hidden>
              <span>Project Code</span>
              <span>Project Name</span>
            </div>
            <div className="plan-settings__project-fields">
              <label className="saas-field">
                <span className="sr-only">Project Code</span>
                <input
                  className="cap-field__input"
                  type="text"
                  value={scenario.plan.projectCode ?? ''}
                  onChange={(event) => {
                    updateScenarioPlan(scenario.id, {
                      ...scenario.plan,
                      projectCode: event.target.value,
                    })
                    setMessage('')
                  }}
                  placeholder="e.g. PRJ-1042"
                />
              </label>
              <label className="saas-field">
                <span className="sr-only">Project Name</span>
                <input
                  className="cap-field__input"
                  type="text"
                  value={scenario.plan.projectName ?? ''}
                  onChange={(event) => {
                    updateScenarioPlan(scenario.id, {
                      ...scenario.plan,
                      projectName: event.target.value,
                    })
                    setMessage('')
                  }}
                  placeholder="e.g. Contoso Voice FY26"
                />
              </label>
            </div>
          </div>

          <p className="saas-muted m-0 text-xs">Current week: {currentWeek}</p>
          <PlanStartWeekField
            weekStart="sunday"
            value={scenario.plan.capacityPlanStartWeek ?? ''}
            onChange={(capacityPlanStartWeek) => {
              updateScenarioPlan(scenario.id, {
                ...scenario.plan,
                weekStart: 'sunday',
                capacityPlanStartWeek,
                capacityImportedWeeks: undefined,
              })
            }}
            compact
          />
          <div className="plan-settings__row">
            {hasPreviousCapacityPlan(scenario.id) ? (
              <button
                type="button"
                className="saas-btn saas-btn--secondary"
                onClick={() => {
                  if (resetToPreviousCapacityPlan(scenario.id)) setMessage('Previous plan restored.')
                }}
              >
                Undo last plan
              </button>
            ) : null}
            <button
              type="button"
              className="saas-btn saas-btn--danger"
              disabled={!canEditCapacity && !isAdmin && !canCreatePlans}
              onClick={() => {
                if (!canEditCapacity && !isAdmin && !canCreatePlans) {
                  setMessage('You do not have permission to delete this plan.')
                  return
                }
                if (
                  !window.confirm(
                    `Delete plan for ${scenario.plan.client} · ${resolvePlanLob(scenario.plan)}? This cannot be undone.`,
                  )
                )
                  return
                deleteScenario(scenario.id)
                navigate('/')
              }}
            >
              Delete this plan
            </button>
          </div>
        </section>

        <section className="plan-settings__card">
          <header>
            <p className="plan-settings__eyebrow">Hiring path</p>
            <h3>Training &amp; nesting</h3>
          </header>
          <NumField
            label="Training weeks"
            value={scenario.assumptions.newHire.trainingWeeks}
            min={1}
            step={1}
            placeholder="e.g. 4"
            onChange={(value) => updatePipeline('trainingWeeks', Math.max(1, Math.round(value)))}
          />
          <NumField
            label="Nesting weeks"
            value={scenario.assumptions.newHire.nestingWeeks}
            min={1}
            step={1}
            placeholder="e.g. 2"
            onChange={(value) => updatePipeline('nestingWeeks', Math.max(1, Math.round(value)))}
          />
          <NumField
            label="Training attrition"
            value={scenario.assumptions.newHire.trainingAttritionRate}
            min={0}
            max={1}
            step={0.1}
            percent
            placeholder="e.g. 5"
            onChange={(value) => updatePipeline('trainingAttritionRate', value)}
          />
          <NumField
            label="Nesting attrition"
            value={scenario.assumptions.newHire.nestingAttritionRate}
            min={0}
            max={1}
            step={0.1}
            percent
            placeholder="e.g. 3"
            onChange={(value) => updatePipeline('nestingAttritionRate', value)}
          />
          {Array.from({ length: Math.max(1, Math.round(scenario.assumptions.newHire.nestingWeeks)) }, (_, index) => (
            <NumField
              key={`settings-nesting-phone-${index}`}
              label={`Nesting Week ${index + 1} phone time (%)`}
              value={
                scenario.assumptions.newHire.nestingPhoneTimeRamp?.[index] ??
                scenario.assumptions.newHire.nestingPhoneTimePct
              }
              min={0}
              max={1}
              step={0.01}
              percent
              placeholder="e.g. 50"
              onChange={(value) => updateNestingPhoneWeek(index, value)}
            />
          ))}
        </section>

        <div className="plan-settings__span">
          <CapacityDataUploadPanel
            scenario={scenario}
            disabled={false}
            existingOverrides={plannedOverrides}
            onImport={async (result) => {
              applyPlannedWeekOverrides(scenario.id, result.plannedByWeek, result.mode, {
                skipRemoteSync: true,
              })
              const uploadedDrivers = Object.values(result.plannedByWeek).some(
                (week) => week.callVolume != null || week.ahtSeconds != null || week.occupancy != null,
              )
              if (uploadedDrivers) {
                const nextModes: ScenarioForecastModes = {
                  ...forecastModes,
                  callVolume: 'manual',
                  ahtSeconds: 'manual',
                  occupancy: 'manual',
                }
                setForecastModes(nextModes)
                saveScenarioForecastModes(scenario.id, nextModes)
              }
              try {
                await flushStaffingPlanRequiredHcSync()
                await flushAllCapacityDocuments()
                setMessage(`${result.message} Saved to MariaDB.`)
              } catch (error) {
                setMessage(
                  error instanceof Error
                    ? `${result.message} ${error.message}`
                    : `${result.message} Saved locally but MariaDB sync failed.`,
                )
              }
            }}
          />
        </div>

        <div className="plan-settings__span">
          <ShrinkagePlanningPanel
            rows={derivedRows}
            categories={categories}
            visibleCategoryIds={activeShrinkageIds}
            onVisibleCategoryIdsChange={setVisibleShrinkageIds}
            onPlannedCategoryChange={(week, categoryId, value) =>
              updatePlannedShrinkageCategory(scenario.id, week, categoryId, value)
            }
            getPlannedCategoryValue={getPlannedShrinkageValue}
            onAddCategory={(category) => {
              addScenarioShrinkageCategory(scenario.id, category)
              setVisibleShrinkageIds((prev) => (prev.includes(category.id) ? prev : [...prev, category.id]))
            }}
            onDeleteCategory={(categoryId) => {
              deleteScenarioShrinkageCategory(scenario.id, categoryId)
              setVisibleShrinkageIds((prev) => prev.filter((id) => id !== categoryId))
            }}
            disabled={false}
          />
        </div>

        <div className="plan-settings__span">
          <StageAttritionPanel
            assumptions={scenario.assumptions}
            overrides={stageOverrides ?? {}}
            onChange={(stage, stageWeek, value) => updateStageAttritionRate(scenario.id, stage, stageWeek, value)}
            disabled={false}
          />
        </div>
      </div>

      <p className="plan-settings__foot">
        Grid editing lives on <Link to="/capacity-plan">Capacity Plan</Link>. Portfolio roll-up is on{' '}
        <Link to="/summary">Summary view</Link>.
      </p>
    </div>
  )
}
