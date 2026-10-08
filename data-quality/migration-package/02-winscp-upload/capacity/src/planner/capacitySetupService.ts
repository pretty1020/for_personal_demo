import { syncBusinessDerivedFields, syncChannelDerivedFields, syncDerivedTenuredFields } from './assumptionDerivation'
import { clearUnlockedFutureWeeks, loadDriverWeekLocks } from './capacityDriverLocks'
import { buildWeek1DriverSnapshot, propagateWeek1Drivers } from './capacityDriverPropagation'
import {
  loadCapacityPlanOverrides,
  saveCapacityPlanOverrides,
  type ScenarioCapacityPlanOverrideStore,
} from './capacityPlanOverridePersistence'
import {
  loadStageAttritionOverrides,
  saveStageAttritionOverrides,
  type ScenarioStageAttritionStore,
  type StageAttritionOverride,
} from './capacityStageAttritionPersistence'
import { createClientProfile, upsertClientProfile, findClientById, findClientByName, type ClientProfile } from './clientRegistry'
import { defaultChannelAssumptions, emptyChannelAssumptions, initChannelsForSupported, normalizeChannelMix } from './channelPlanning'
import type { ChannelAssumptions, ChannelType, PlannerAssumptions, PlannerPlanMetadata, PlannerScenario } from './types'
import { createCleanAssumptions } from './defaults'
import { BILLABLE_TYPE_OPTIONS, isFteBillingPlan } from '../utils/staffingCapacity/billingModel'

export type CapacitySetupDraft = {
  mode: 'new-client' | 'add-lob'
  clientId?: string
  clientName: string
  weekStart: PlannerPlanMetadata['weekStart']
  capacityPlanStartWeek: string
  planningWeeks: number
  buildMethod: NonNullable<PlannerPlanMetadata['buildMethod']>
  defaultPaidHours: number
  defaultShrinkagePct: number
  lobName: string
  locationName: string
  projectCode: string
  projectName: string
  billingType: string
  supportedChannels: ChannelType[]
  trainingWeeks: number
  nestingWeeks: number
  channels: Partial<Record<ChannelType, ChannelAssumptions>>
  weeklyHiringPlan: number
  trainingAttritionRate: number
  nestingAttritionRate: number
  graduationRate: number
  propagateFutureWeeks: boolean
  /** Week 1 Required Production FTE when billing type is Per FTE. */
  week1RequiredProductionFte: number | null
}

export function defaultCapacitySetupDraft(client?: ClientProfile | null): CapacitySetupDraft {
  const defaultPaidHours = client?.defaultPaidHours ?? 40
  const defaultShrinkagePct = client?.defaultShrinkagePct ?? 0
  return {
    mode: client ? 'add-lob' : 'new-client',
    clientId: client?.id,
    clientName: client?.name ?? '',
    weekStart: client?.weekStart ?? 'sunday',
    capacityPlanStartWeek: client?.capacityPlanStartWeek ?? '',
    planningWeeks: client?.planningWeeks ?? 52,
    buildMethod: client?.buildMethod ?? 'forward',
    defaultPaidHours,
    defaultShrinkagePct,
    lobName: '',
    locationName: '',
    projectCode: '',
    projectName: '',
    billingType: BILLABLE_TYPE_OPTIONS[0]?.value ?? 'FTE',
    supportedChannels: ['voice'],
    trainingWeeks: 4,
    nestingWeeks: 2,
    channels: initChannelsForSupported(
      {
        voice: defaultChannelAssumptions('voice', {
          forecastVolume: 0,
          ahtSeconds: 0,
          paidHoursPerFte: defaultPaidHours,
          occupancyTarget: 0,
          shrinkagePct: defaultShrinkagePct,
          productivityPct: 0,
          revenuePerContact: 0,
          startingProductionHc: 0,
          trainingWeeks: 4,
          nestingWeeks: 2,
          classSize: 1,
          trainingAttritionRate: 0,
          nestingAttritionRate: 0,
          graduationRate: 1,
          nestingPhoneTimePct: 0,
        }),
      },
      ['voice'],
      { requireUserEntry: true, defaultPaidHours, defaultShrinkagePct },
    ),
    weeklyHiringPlan: 0,
    trainingAttritionRate: 0,
    nestingAttritionRate: 0,
    graduationRate: 1,
    propagateFutureWeeks: true,
    week1RequiredProductionFte: null,
  }
}

function buildAssumptions(draft: CapacitySetupDraft, client: ClientProfile): PlannerAssumptions {
  const channels = normalizeChannelMix(
    Object.fromEntries(
      draft.supportedChannels.map((channel) => [
        channel,
        {
          ...(draft.channels[channel] ?? emptyChannelAssumptions(channel)),
          paidHoursPerFte: draft.defaultPaidHours,
          shrinkagePct: draft.defaultShrinkagePct,
          trainingWeeks: draft.trainingWeeks,
          nestingWeeks: draft.nestingWeeks,
          startingProductionHc: 0,
          classSize: 1,
        },
      ]),
    ),
    draft.supportedChannels,
  )
  const totalVolume = draft.supportedChannels.reduce(
    (sum, channel) => sum + (channels[channel]?.forecastVolume ?? 0),
    0,
  )
  const cleanAssumptions = createCleanAssumptions()
  return syncChannelDerivedFields(
    syncBusinessDerivedFields(
      syncDerivedTenuredFields({
        ...cleanAssumptions,
        channels,
        tenured: {
          ...cleanAssumptions.tenured,
          standardScheduledHoursPerWeek: draft.defaultPaidHours,
          shrinkageRate: draft.defaultShrinkagePct,
          occupancyTarget: channels.voice?.occupancyTarget ?? channels.chat?.occupancyTarget ?? 0.85,
          ahtSeconds: channels.voice?.ahtSeconds ?? channels.chat?.ahtSeconds ?? 0,
          productivityFactor:
            draft.supportedChannels
              .map((channel) => channels[channel]?.productivityPct ?? 0)
              .find((value) => value > 0) ?? 0,
        },
        business: {
          ...cleanAssumptions.business,
          baseForecastVolume: totalVolume,
        },
        newHire: {
          ...cleanAssumptions.newHire,
          hiringPlanPerPeriod: draft.weeklyHiringPlan,
          classSize: 1,
          trainingWeeks: draft.trainingWeeks,
          nestingWeeks: draft.nestingWeeks,
          trainingAttritionRate: draft.trainingAttritionRate,
          nestingAttritionRate: draft.nestingAttritionRate,
          graduationRate: draft.graduationRate,
          graduationWeek: Math.max(1, draft.trainingWeeks + draft.nestingWeeks),
        },
      }),
    ),
    {
      client: client.name,
      lob: draft.lobName.trim(),
      location: draft.locationName.trim(),
      projectCode: draft.projectCode.trim(),
      projectName: draft.projectName.trim(),
      billingType: draft.billingType,
      weekStart: client.weekStart,
      supportedChannels: draft.supportedChannels,
      capacityPlanStartWeek: client.capacityPlanStartWeek,
      planningWeeks: client.planningWeeks,
      buildMethod: client.buildMethod,
      clientId: client.id,
    },
  )
}

function buildStageAttrition(draft: CapacitySetupDraft): StageAttritionOverride {
  const training: Record<number, number> = {}
  const nesting: Record<number, number> = {}
  for (let index = 0; index < draft.trainingWeeks; index += 1) {
    training[index] = draft.trainingAttritionRate
  }
  for (let index = 0; index < draft.nestingWeeks; index += 1) {
    nesting[index] = draft.nestingAttritionRate
  }
  return { training, nesting }
}

export function finalizeCapacitySetup(
  draft: CapacitySetupDraft,
  createNewScenario: (
    name: string,
    description?: string,
    plan?: PlannerPlanMetadata,
    assumptionsOverride?: PlannerAssumptions,
  ) => PlannerScenario,
): { scenario: PlannerScenario; client: ClientProfile } {
  const existingClient = draft.clientId ? findClientById(draft.clientId) : null
  const sameNameClient = findClientByName(draft.clientName)
  // Reuse an existing client when adding LOB, or when the typed name already exists
  // (prevents "one client only" feel and duplicate registry rows).
  const clientProfile =
    draft.mode === 'add-lob' && existingClient
      ? {
          ...existingClient,
          updatedAt: new Date().toISOString(),
        }
      : sameNameClient
        ? {
            ...sameNameClient,
            weekStart: draft.weekStart,
            capacityPlanStartWeek: draft.capacityPlanStartWeek || sameNameClient.capacityPlanStartWeek,
            planningWeeks: draft.planningWeeks,
            buildMethod: draft.buildMethod,
            defaultPaidHours: draft.defaultPaidHours,
            defaultShrinkagePct: draft.defaultShrinkagePct,
            updatedAt: new Date().toISOString(),
          }
        : createClientProfile({
            name: draft.clientName,
            weekStart: draft.weekStart,
            capacityPlanStartWeek: draft.capacityPlanStartWeek,
            planningWeeks: draft.planningWeeks,
            buildMethod: draft.buildMethod,
            defaultPaidHours: draft.defaultPaidHours,
            defaultShrinkagePct: draft.defaultShrinkagePct,
          })
  upsertClientProfile(clientProfile)

  const plan: PlannerPlanMetadata = {
    client: clientProfile.name,
    lob: draft.lobName.trim(),
    location: draft.locationName.trim(),
    projectCode: draft.projectCode.trim(),
    projectName: draft.projectName.trim(),
    billingType: draft.billingType,
    weekStart: clientProfile.weekStart,
    clientId: clientProfile.id,
    supportedChannels: draft.supportedChannels,
    capacityPlanStartWeek: clientProfile.capacityPlanStartWeek,
    planningWeeks: clientProfile.planningWeeks,
    buildMethod: clientProfile.buildMethod,
  }
  const assumptions = buildAssumptions(draft, clientProfile)
  const scenario = createNewScenario(
    `${clientProfile.name} · ${draft.lobName.trim()}`,
    'Capacity workspace',
    plan,
    assumptions,
  )

  const stageStore: ScenarioStageAttritionStore = loadStageAttritionOverrides()
  stageStore[scenario.id] = buildStageAttrition(draft)
  saveStageAttritionOverrides(stageStore)

  if (draft.propagateFutureWeeks || draft.week1RequiredProductionFte != null) {
    clearUnlockedFutureWeeks(scenario.id, clientProfile.capacityPlanStartWeek)
    const isFte = isFteBillingPlan(draft.billingType)
    const snapshot = isFte
      ? {
          callVolume: 0,
          ahtSeconds: 0,
          occupancy: 0,
          totalShrinkagePct: draft.defaultShrinkagePct,
          plannedNewHires: Math.round(draft.weeklyHiringPlan),
          requiredFte:
            draft.week1RequiredProductionFte != null && Number.isFinite(draft.week1RequiredProductionFte)
              ? Math.max(0, draft.week1RequiredProductionFte)
              : null,
        }
      : buildWeek1DriverSnapshot(scenario, draft.weeklyHiringPlan)
    if (!isFte && draft.week1RequiredProductionFte != null && Number.isFinite(draft.week1RequiredProductionFte)) {
      snapshot.requiredFte = Math.max(0, draft.week1RequiredProductionFte)
    }
    const overrideStore: ScenarioCapacityPlanOverrideStore = loadCapacityPlanOverrides()
    const locks = loadDriverWeekLocks()
    if (draft.propagateFutureWeeks) {
      const nextOverrides = propagateWeek1Drivers(scenario, overrideStore, locks, snapshot)
      saveCapacityPlanOverrides(nextOverrides)
    } else if (snapshot.requiredFte != null && clientProfile.capacityPlanStartWeek) {
      const scenarioOverrides = { ...(overrideStore[scenario.id] ?? {}) }
      scenarioOverrides[clientProfile.capacityPlanStartWeek] = {
        ...(scenarioOverrides[clientProfile.capacityPlanStartWeek] ?? {}),
        requiredFte: snapshot.requiredFte,
      }
      saveCapacityPlanOverrides({ ...overrideStore, [scenario.id]: scenarioOverrides })
    }
  }

  return { scenario: scenario, client: clientProfile }
}
