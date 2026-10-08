import { createCleanAssumptions, DEFAULT_PLAN_METADATA } from '../src/planner/defaults.ts'
import { emptyChannelAssumptions, initChannelsForSupported } from '../src/planner/channelPlanning.ts'
import {
  resolveRequiredProductionFteForPlan,
  shouldPreferChannelRequiredFte,
  buildRequiredProductionFteBreakdown,
  assumptionsWithWeeklyRequiredProductionDrivers,
} from '../src/planner/requiredProductionFte.ts'
import { deriveCapacityPlanRows } from '../src/planner/capacityPlanDerived.ts'
import { createScenario } from '../src/planner/defaults.ts'
import type { WeeklyLedgerRow } from '../src/planner/weeklyLedger.ts'

const plan = {
  ...DEFAULT_PLAN_METADATA,
  billingType: 'Production Hours' as const,
  supportedChannels: ['voice'] as const,
  clientId: 'demo-client',
  buildMethod: 'forward' as const,
}

const assumptions = createCleanAssumptions()
assumptions.channels = initChannelsForSupported({}, ['voice'], {
  requireUserEntry: true,
  defaultPaidHours: 0,
})
console.log('prefer', shouldPreferChannelRequiredFte(plan, assumptions))
console.log('channel', assumptions.channels.voice)
const fte = resolveRequiredProductionFteForPlan(assumptions, plan, 10000, {
  volume: 10000,
  ahtSeconds: 300,
  occupancy: 0.85,
})
console.log('resolve_empty_requireUserEntry', fte)

const assumptions2 = createCleanAssumptions()
assumptions2.channels = {
  voice: emptyChannelAssumptions('voice', {
    paidHoursPerFte: 40,
    ahtSeconds: 300,
    occupancyTarget: 0.85,
    forecastVolume: 0,
  }),
}
console.log(
  'zero_forecast_single',
  resolveRequiredProductionFteForPlan(assumptions2, plan, 10000, {
    volume: 10000,
    ahtSeconds: 300,
    occupancy: 0.85,
  }),
)

const multi = { ...plan, supportedChannels: ['voice', 'chat'] as const }
const assumptions3 = createCleanAssumptions()
assumptions3.channels = {
  voice: emptyChannelAssumptions('voice', {
    paidHoursPerFte: 40,
    ahtSeconds: 300,
    occupancyTarget: 0.85,
    forecastVolume: 0,
  }),
  chat: emptyChannelAssumptions('chat', {
    paidHoursPerFte: 40,
    ahtSeconds: 200,
    occupancyTarget: 0.85,
    chatConcurrency: 2,
    forecastVolume: 0,
  }),
}
console.log(
  'multi_zero_forecast',
  resolveRequiredProductionFteForPlan(assumptions3, multi, 10000, {
    volume: 10000,
    ahtSeconds: 300,
    occupancy: 0.85,
  }),
)

const patched = assumptionsWithWeeklyRequiredProductionDrivers(assumptions3, multi, {
  volume: 10000,
  ahtSeconds: 300,
  occupancy: 0.85,
})
console.log('patched channels volumes', {
  voice: patched.channels?.voice?.forecastVolume,
  chat: patched.channels?.chat?.forecastVolume,
  voiceAht: patched.channels?.voice?.ahtSeconds,
})
console.log('breakdown multi', buildRequiredProductionFteBreakdown(patched, multi, 1))

// Derive path: empty channels + planned overrides with volume/aht/occ
const scenario = createScenario('test', '', assumptions2, plan)
const week = '2026-07-12'
const ledgerRow: WeeklyLedgerRow = {
  key: week,
  week,
  timeline: 'forward_plan',
  planned: {
    callVolume: 10000,
    handledVolume: null,
    ahtSeconds: 300,
    cappedAhtSeconds: null,
    occupancy: 0.85,
    beginningProductionHc: 50,
    plannedNewHires: 0,
    actualTrainingStartHc: 0,
    trainingHc: 0,
    nestingHc: 0,
    graduateHc: 0,
    attritionHc: 0,
    attritionPct: null,
    trainingAttritionPct: null,
    nestingAttritionPct: null,
    transferInHc: 0,
    transferOutHc: 0,
    offRosterLoaHc: 0,
    supportHc: 0,
    productionHc: 50,
    requiredFte: null,
    coreProductionFte: 40,
    nestingProductiveFte: 0,
    productionFte: 40,
    overUnderStaffing: null,
    staffingPct: null,
    totalShrinkagePct: 0.2,
  },
  actual: null,
  shrinkage: [],
}
const derived = deriveCapacityPlanRows(
  [ledgerRow],
  scenario,
  null,
  {
    [week]: { callVolume: 10000, ahtSeconds: 300, occupancy: 0.85 },
  },
)
console.log('derived planned requiredFte', derived[0]?.planned.requiredFte)
console.log('derived planned volume/aht/occ', {
  volume: derived[0]?.planned.volume,
  aht: derived[0]?.planned.ahtSeconds,
  occ: derived[0]?.planned.occupancy,
})
console.log('status', derived[0]?.statusLabel)
