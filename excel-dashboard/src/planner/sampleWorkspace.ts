import { syncBusinessDerivedFields, syncChannelDerivedFields } from './assumptionDerivation'
import { addWeeks, defaultCapacityPlanStartWeek, isoDate } from './capacityWeekUtils'
import { DEFAULT_CLIENT_TIMEZONE } from './clientTimezones'
import { defaultChannelAssumptions } from './channelPlanning'
import { createClientProfile, loadClientRegistry, saveClientRegistry, type ClientProfile } from './clientRegistry'
import { createCleanAssumptions, createScenario } from './defaults'
import { savePlanAccessStore } from './planAccess'
import { saveCapacityPlanView } from './capacityPlanView'
import { syncCapacityMatrixScope } from './capacityPlanPublish'
import { DEFAULT_CAPACITY_MATRIX_COLLAPSED, DEFAULT_CAPACITY_MATRIX_LAYOUT } from './capacityViewPersistence'
import type { ChannelType, PlannerAssumptions, PlannerPlanMetadata, PlannerScenario } from './types'
import { saveRosterStore, type RosterEmployee, type ScenarioRosterStore } from './rosterPersistence'
import { DEFAULT_ADMIN_EMAIL, SEED_USERS } from './userDirectory'
import {
  createRevenueProjectionLine,
  DEFAULT_REV_PROJ_DEFAULTS,
  emptyMonthInput,
  listFiscalMonthKeys,
  saveRevenueProjectionLines,
  type RevenueProjectionMonthInput,
} from './revenueProjections/revenueProjectionPersistence'
import { saveLedgerOverrides } from './ledgerPersistence'
import { buildSampleLedgerOverrideStore } from './sampleLedgerActuals'
import { seedSampleScheduling } from './scheduling/sampleSchedulingSeed'
import { seedSampleVolumeForecasts } from './sampleVolumeForecastSeed'

const SCENARIOS_STORAGE_KEY = 'wfp-planner-scenarios-v1'
const ACTIVE_SCENARIO_STORAGE_KEY = 'wfp-planner-active-v1'

export const SAMPLE_WORKSPACE_VERSION = 'apex-telco-positive-margin-v5'
export const SAMPLE_WORKSPACE_VERSION_KEY = 'wfp-sample-workspace-version'
export const SAMPLE_CLIENT_NAME = 'Retail'
export const SAMPLE_LOCATION = 'Manila'
export const TELCO_CLIENT_NAME = 'Telco'
export const TELCO_LOCATION = 'Cebu'
export const SAMPLE_PAID_HOURS = 40
export const SAMPLE_SHRINKAGE = 0.25

const TRAINING_WEEKS = 4
const NESTING_WEEKS = 2

const SAMPLE_NAMES = [
  'Alex Cruz',
  'Jordan Reyes',
  'Sam Ortega',
  'Riley Santos',
  'Casey Villanueva',
  'Morgan Dela Cruz',
  'Jamie Ramos',
  'Taylor Bautista',
  'Avery Mendoza',
  'Quinn Navarro',
  'Parker Garcia',
  'Cameron Flores',
  'Drew Aquino',
  'Skyler Lim',
  'Hayden Tan',
  'Reese Sy',
  'Blake Go',
  'Finley Chua',
  'Rowan Yu',
  'Peyton Ong',
  'Kai Villar',
  'Noel Castillo',
  'Mira Santos',
  'Elena Prado',
  'Luis Mercado',
  'Nina Corpuz',
  'Owen Sison',
  'Pia Alonzo',
] as const

/** Planner keys replaced when the sample workspace is applied. Session/users are kept. */
export const SAMPLE_WORKSPACE_RESET_KEYS = [
  'wfp-planner-scenarios-v1',
  'wfp-planner-active-v1',
  'wfp-planner-granularity-v1',
  'wfp-roster-store-v1',
  'wfp-roster-sync-meta-v1',
  'wfp-ledger-actual-overrides-v1',
  'wfp-forecast-overrides-v1',
  'wfp-capacity-plan-overrides-v1',
  'wfp-capacity-plan-view-v1',
  'wfp-capacity-matrix-view-v2',
  'wfp-capacity-matrix-view-v4',
  'wfp-capacity-matrix-view-v5',
  'wfp-aht-analysis-overrides-v1',
  'wfp-capacity-metric-order-v1',
  'wfp-capacity-metric-optional-v1',
  'wfp-capacity-metric-hidden-v1',
  'wfp-scheduling-v1',
  'wfp-scheduling-templates-v1',
  'wfp-scheduling-artifacts-v1',
  'wfp-sample-scheduling-v1',
  'wfp-plan-access-grants-v1',
  'wfp-revenue-projection-lines-v1',
  'wfp-revenue-projection-lines-v2',
  'wfp-client-registry-v1',
  'wfp-formula-registry-v1',
  'wfp-capacity-stage-attrition-v1',
  'wfp-capacity-shrinkage-categories-v1',
  'wfp-capacity-forecast-modes-v1',
  'wfp-capacity-driver-week-locks-v1',
  'wfp-capacity-plan-previous-publish-v1',
  'wfp-driver-forecast-v3',
] as const

export type SampleLobDefinition = {
  id: string
  lob: string
  channel: ChannelType
  projectCode: string
  productionHc: number
  weeklyHires: number
  forecastVolume: number
  ahtSeconds: number
  occupancyTarget: number
  productivityPct: number
  chatConcurrency: number
}

/**
 * Bill / labor rates shared by Capacity financials and Revenue Projections.
 *
 * Capacity portfolio cards read scenario.assumptions.business — leaving those at
 * 0 fell through to $20 bill / $22 salary and a permanent −10% margin. Rates here
 * keep cost below revenue (~12–20% GM after support/training/other).
 */
export type SampleLobFinance = {
  billingType: 'Production Hours' | 'Transactional' | 'FTE'
  billRateMethod: 'hourly' | 'per_minute' | 'monthly' | 'per_transaction'
  /** Active Capacity billingRate (hourly $ for Production Hours; unit $ for Transactional; monthly $ for FTE). */
  billingRate: number
  hourlyBillRate: number
  monthlyBillRate: number
  perMinuteBillRate: number
  perTransactionBillRate: number
  hourlySalaryUsd: number
  monthlyLaborPerFteUsd: number
  supportSalaryUsd: number
  trainingSalaryRateUsd: number
  otherCostUsd: number
}

export const SAMPLE_LOB_FINANCE: Record<string, SampleLobFinance> = {
  'scenario-apex-abc': {
    billingType: 'Production Hours',
    billRateMethod: 'hourly',
    billingRate: 24,
    hourlyBillRate: 24,
    monthlyBillRate: 0,
    perMinuteBillRate: 0,
    perTransactionBillRate: 0,
    hourlySalaryUsd: 18,
    monthlyLaborPerFteUsd: 0,
    supportSalaryUsd: 180,
    trainingSalaryRateUsd: 90,
    otherCostUsd: 40,
  },
  'scenario-apex-efg': {
    billingType: 'Production Hours',
    billRateMethod: 'hourly',
    billingRate: 22,
    hourlyBillRate: 22,
    monthlyBillRate: 0,
    perMinuteBillRate: 0.42,
    perTransactionBillRate: 0,
    hourlySalaryUsd: 16,
    monthlyLaborPerFteUsd: 0,
    supportSalaryUsd: 140,
    trainingSalaryRateUsd: 70,
    otherCostUsd: 35,
  },
  'scenario-apex-lmn': {
    billingType: 'Production Hours',
    billRateMethod: 'hourly',
    billingRate: 20,
    hourlyBillRate: 20,
    monthlyBillRate: 0,
    perMinuteBillRate: 0,
    perTransactionBillRate: 0,
    hourlySalaryUsd: 15,
    monthlyLaborPerFteUsd: 0,
    supportSalaryUsd: 90,
    trainingSalaryRateUsd: 55,
    otherCostUsd: 25,
  },
  'scenario-apex-xyz': {
    billingType: 'Production Hours',
    billRateMethod: 'hourly',
    billingRate: 23,
    hourlyBillRate: 23,
    monthlyBillRate: 2550,
    perMinuteBillRate: 0,
    perTransactionBillRate: 0,
    hourlySalaryUsd: 17,
    monthlyLaborPerFteUsd: 2100,
    supportSalaryUsd: 160,
    trainingSalaryRateUsd: 80,
    otherCostUsd: 45,
  },
  'scenario-telco-mobile-care': {
    billingType: 'Production Hours',
    billRateMethod: 'hourly',
    billingRate: 23,
    hourlyBillRate: 23,
    monthlyBillRate: 0,
    perMinuteBillRate: 0,
    perTransactionBillRate: 0,
    hourlySalaryUsd: 17,
    monthlyLaborPerFteUsd: 0,
    supportSalaryUsd: 220,
    trainingSalaryRateUsd: 110,
    otherCostUsd: 55,
  },
  'scenario-telco-tech-l1': {
    billingType: 'Production Hours',
    billRateMethod: 'hourly',
    billingRate: 26,
    hourlyBillRate: 26,
    monthlyBillRate: 0,
    perMinuteBillRate: 0,
    perTransactionBillRate: 0,
    hourlySalaryUsd: 19,
    monthlyLaborPerFteUsd: 0,
    supportSalaryUsd: 200,
    trainingSalaryRateUsd: 120,
    otherCostUsd: 60,
  },
  'scenario-telco-digital-chat': {
    billingType: 'Production Hours',
    billRateMethod: 'hourly',
    billingRate: 21,
    hourlyBillRate: 21,
    monthlyBillRate: 0,
    perMinuteBillRate: 0.48,
    perTransactionBillRate: 0,
    hourlySalaryUsd: 15.5,
    monthlyLaborPerFteUsd: 0,
    supportSalaryUsd: 160,
    trainingSalaryRateUsd: 85,
    otherCostUsd: 42,
  },
  'scenario-telco-billing': {
    billingType: 'Production Hours',
    billRateMethod: 'hourly',
    billingRate: 24,
    hourlyBillRate: 24,
    monthlyBillRate: 2680,
    perMinuteBillRate: 0,
    perTransactionBillRate: 0,
    hourlySalaryUsd: 18,
    monthlyLaborPerFteUsd: 2250,
    supportSalaryUsd: 175,
    trainingSalaryRateUsd: 95,
    otherCostUsd: 50,
  },
}

function financeForLob(lob: SampleLobDefinition): SampleLobFinance {
  return (
    SAMPLE_LOB_FINANCE[lob.id] ?? {
      billingType: 'Production Hours',
      billRateMethod: 'hourly',
      billingRate: 22,
      hourlyBillRate: 22,
      monthlyBillRate: 0,
      perMinuteBillRate: 0,
      perTransactionBillRate: 0,
      hourlySalaryUsd: 16,
      monthlyLaborPerFteUsd: 0,
      supportSalaryUsd: 120,
      trainingSalaryRateUsd: 60,
      otherCostUsd: 30,
    }
  )
}

type SampleClientBundle = {
  id: string
  name: string
  location: string
  lobs: readonly SampleLobDefinition[]
}

/**
 * Sample volumes are sized so Paid FTE = Production HC:
 * Required Production FTE = (Volume × AHT) ÷ (Paid hours × 3600 × Occupancy [× Chat concurrency])
 * Paid FTE = Required Production FTE ÷ (1 − Shrinkage)
 */
export const SAMPLE_LOBS: readonly SampleLobDefinition[] = [
  {
    id: 'scenario-apex-abc',
    lob: 'ABC',
    channel: 'voice',
    projectCode: 'APX-ABC',
    productionHc: 20,
    weeklyHires: 0,
    forecastVolume: 6_120,
    ahtSeconds: 300,
    occupancyTarget: 0.85,
    productivityPct: 0.94,
    chatConcurrency: 1,
  },
  {
    id: 'scenario-apex-efg',
    lob: 'EFG',
    channel: 'chat',
    projectCode: 'APX-EFG',
    productionHc: 16,
    weeklyHires: 0,
    forecastVolume: 7_200,
    ahtSeconds: 480,
    occupancyTarget: 0.8,
    productivityPct: 0.92,
    chatConcurrency: 2.5,
  },
  {
    id: 'scenario-apex-lmn',
    lob: 'LMN',
    channel: 'email',
    projectCode: 'APX-LMN',
    productionHc: 10,
    weeklyHires: 0,
    forecastVolume: 1_800,
    ahtSeconds: 480,
    occupancyTarget: 0.8,
    productivityPct: 0.9,
    chatConcurrency: 1,
  },
  {
    id: 'scenario-apex-xyz',
    lob: 'XYZ',
    channel: 'blended',
    projectCode: 'APX-XYZ',
    productionHc: 18,
    weeklyHires: 0,
    forecastVolume: 4_428,
    ahtSeconds: 360,
    occupancyTarget: 0.82,
    productivityPct: 0.91,
    chatConcurrency: 1,
  },
]

/** Telco contact-center LOBs — prepaid care, tech support, digital chat, billing. */
export const TELCO_LOBS: readonly SampleLobDefinition[] = [
  {
    id: 'scenario-telco-mobile-care',
    lob: 'Mobile Care',
    channel: 'voice',
    projectCode: 'TLC-CARE',
    productionHc: 48,
    weeklyHires: 0,
    forecastVolume: 11_596,
    ahtSeconds: 380,
    occupancyTarget: 0.85,
    productivityPct: 0.93,
    chatConcurrency: 1,
  },
  {
    id: 'scenario-telco-tech-l1',
    lob: 'Tech Support L1',
    channel: 'voice',
    projectCode: 'TLC-TECH',
    productionHc: 36,
    weeklyHires: 0,
    forecastVolume: 6_131,
    ahtSeconds: 520,
    occupancyTarget: 0.82,
    productivityPct: 0.91,
    chatConcurrency: 1,
  },
  {
    id: 'scenario-telco-digital-chat',
    lob: 'Digital Chat',
    channel: 'chat',
    projectCode: 'TLC-CHAT',
    productionHc: 28,
    weeklyHires: 0,
    forecastVolume: 15_120,
    ahtSeconds: 400,
    occupancyTarget: 0.8,
    productivityPct: 0.92,
    chatConcurrency: 2.5,
  },
  {
    id: 'scenario-telco-billing',
    lob: 'Billing & Collections',
    channel: 'blended',
    projectCode: 'TLC-BILL',
    productionHc: 22,
    weeklyHires: 0,
    forecastVolume: 3_960,
    ahtSeconds: 480,
    occupancyTarget: 0.8,
    productivityPct: 0.9,
    chatConcurrency: 1,
  },
]

export const ALL_SAMPLE_LOBS: readonly SampleLobDefinition[] = [...SAMPLE_LOBS, ...TELCO_LOBS]

const SAMPLE_CLIENT_BUNDLES: readonly SampleClientBundle[] = [
  {
    id: 'client-apex-retail',
    name: SAMPLE_CLIENT_NAME,
    location: SAMPLE_LOCATION,
    lobs: SAMPLE_LOBS,
  },
  {
    id: 'client-telco-client',
    name: TELCO_CLIENT_NAME,
    location: TELCO_LOCATION,
    lobs: TELCO_LOBS,
  },
]

export function sampleRequiredProductionFte(lob: SampleLobDefinition): number {
  const productiveSeconds = SAMPLE_PAID_HOURS * 3600
  const concurrency = lob.channel === 'chat' ? lob.chatConcurrency : 1
  return (lob.forecastVolume * lob.ahtSeconds) / (productiveSeconds * lob.occupancyTarget * concurrency)
}

export function samplePaidFte(lob: SampleLobDefinition): number {
  return sampleRequiredProductionFte(lob) / (1 - SAMPLE_SHRINKAGE)
}

/**
 * Volume that yields the target Staffing % = Production FTE / Required FTE.
 * Production FTE = HC × (1 − shrinkage). Target band for demos: 95%–105%.
 */
export function sampleVolumeForStaffingPct(
  lob: Pick<
    SampleLobDefinition,
    'productionHc' | 'ahtSeconds' | 'occupancyTarget' | 'channel' | 'chatConcurrency'
  >,
  staffingPct: number,
  shrinkagePct = SAMPLE_SHRINKAGE,
): number {
  const pct = Math.min(1.2, Math.max(0.8, staffingPct))
  const productionFte = lob.productionHc * (1 - shrinkagePct)
  const required = productionFte / pct
  const productiveSeconds = SAMPLE_PAID_HOURS * 3600
  const concurrency = lob.channel === 'chat' ? lob.chatConcurrency : 1
  return (required * productiveSeconds * lob.occupancyTarget * concurrency) / Math.max(1, lob.ahtSeconds)
}

/** Week-indexed Staffing % oscillating inside 95%–105%. */
export function sampleStaffingPctForWeek(weekIndex: number, phase = 0): number {
  const wave = Math.sin((weekIndex + phase) * 0.85)
  return 1 + wave * 0.05
}

function shiftIso(week: string, weeks: number): string {
  return isoDate(addWeeks(new Date(`${week}T12:00:00`), weeks))
}

function buildAssumptions(lob: SampleLobDefinition): PlannerAssumptions {
  const clean = createCleanAssumptions()
  const finance = financeForLob(lob)
  const channel = defaultChannelAssumptions(lob.channel, {
    forecastVolume: lob.forecastVolume,
    ahtSeconds: lob.ahtSeconds,
    paidHoursPerFte: SAMPLE_PAID_HOURS,
    occupancyTarget: lob.occupancyTarget,
    shrinkagePct: SAMPLE_SHRINKAGE,
    productivityPct: lob.productivityPct,
    chatConcurrency: lob.chatConcurrency,
    backlogVolume: 0,
    targetBacklogReduction: 0,
    channelMixPct: 1,
    startingProductionHc: lob.productionHc,
    trainingWeeks: TRAINING_WEEKS,
    nestingWeeks: NESTING_WEEKS,
    classSize: 1,
    trainingAttritionRate: 0,
    nestingAttritionRate: 0,
    graduationRate: 1,
    nestingPhoneTimePct: lob.channel === 'voice' ? 0.5 : 0.35,
  })
  const plan: PlannerPlanMetadata = {
    client: SAMPLE_CLIENT_NAME,
    location: SAMPLE_LOCATION,
    billingType: finance.billingType,
    weekStart: 'sunday',
    timezone: DEFAULT_CLIENT_TIMEZONE,
    lob: lob.lob,
    projectCode: lob.projectCode,
    supportedChannels: [lob.channel],
    buildMethod: 'forward',
    planningWeeks: 52,
  }
  return syncChannelDerivedFields(
    syncBusinessDerivedFields({
      ...clean,
      channels: { [lob.channel]: channel },
      tenured: {
        ...clean.tenured,
        beginningProductionHeadcount: lob.productionHc,
        standardScheduledHoursPerWeek: SAMPLE_PAID_HOURS,
        shrinkageRate: SAMPLE_SHRINKAGE,
        occupancyTarget: lob.occupancyTarget,
        ahtSeconds: lob.ahtSeconds,
        productivityFactor: lob.productivityPct,
        attritionRateMonthly: 0,
        otHoursPerFtePerWeek: 0,
        vtoHoursPerFtePerWeek: 0,
        laborCostPerFteMonthly: finance.monthlyLaborPerFteUsd,
      },
      business: {
        ...clean.business,
        baseForecastVolume: lob.forecastVolume,
        growthRateMonthly: 0,
        revenuePerContact: 0,
        billingRate: finance.billingRate,
        hourlySalaryUsd: finance.hourlySalaryUsd,
        supportSalaryUsd: finance.supportSalaryUsd,
        trainingSalaryRateUsd: finance.trainingSalaryRateUsd,
        otherCostUsd: finance.otherCostUsd,
      },
      newHire: {
        ...clean.newHire,
        hiringPlanPerPeriod: lob.weeklyHires,
        classSize: 1,
        trainingWeeks: TRAINING_WEEKS,
        nestingWeeks: NESTING_WEEKS,
        trainingAttritionRate: 0,
        nestingAttritionRate: 0,
        graduationRate: 1,
        graduationWeek: TRAINING_WEEKS + NESTING_WEEKS,
        hiringDelayWeeks: 0,
        timeToProficiencyWeeks: TRAINING_WEEKS + NESTING_WEEKS,
        rampCurve: [1],
      },
    }),
    plan,
  )
}

function buildPlan(lob: SampleLobDefinition, client: ClientProfile, location: string): PlannerPlanMetadata {
  const finance = financeForLob(lob)
  return {
    client: client.name,
    lob: lob.lob,
    location,
    projectCode: lob.projectCode,
    projectName: `${client.name} ${lob.lob}`,
    billingType: finance.billingType,
    weekStart: client.weekStart,
    clientId: client.id,
    supportedChannels: [lob.channel],
    capacityPlanStartWeek: client.capacityPlanStartWeek,
    planningWeeks: client.planningWeeks,
    buildMethod: client.buildMethod,
    timezone: client.timezone,
  }
}

export function buildSampleRosterEmployees(
  lob: SampleLobDefinition,
  planStartWeek: string,
  nameOffset = 0,
  clientName = SAMPLE_CLIENT_NAME,
  location = SAMPLE_LOCATION,
): RosterEmployee[] {
  /** Stable demo floor: only production agents already graduated before plan start. */
  const hireCount = lob.productionHc
  const employees: RosterEmployee[] = []
  for (let index = 0; index < hireCount; index += 1) {
    const weeksBeforeStart = TRAINING_WEEKS + NESTING_WEEKS + (hireCount - index)
    const trainingStart = shiftIso(planStartWeek, -weeksBeforeStart)
    const nestingStart = shiftIso(trainingStart, TRAINING_WEEKS)
    const productionDate = shiftIso(nestingStart, NESTING_WEEKS)
    const hiringDate = shiftIso(trainingStart, -1)
    const name = SAMPLE_NAMES[(nameOffset + index) % SAMPLE_NAMES.length] ?? `Agent ${index + 1}`
    employees.push({
      id: `${lob.id}-emp-${String(index + 1).padStart(3, '0')}`,
      name: hireCount > SAMPLE_NAMES.length ? `${name} ${index + 1}` : name,
      position: 'Agent',
      role: 'Agent',
      employeeId: `${lob.projectCode}-${String(index + 1).padStart(3, '0')}`,
      hiringDate,
      waveNumber: `Wave ${index + 1}`,
      startTrainingDate: trainingStart,
      startNestingDate: nestingStart,
      productionDate,
      status: 'active',
      source: 'manual',
      client: clientName,
      lob: lob.lob,
      channel: lob.channel,
      accountName: clientName,
      siteLocation: location,
      department: lob.lob,
      supervisor: index % 2 === 0 ? `${lob.lob} Supervisor A` : `${lob.lob} Supervisor B`,
      manager: `${location} Manager`,
      assignmentHistory: [
        {
          id: `${lob.id}-hist-${index + 1}`,
          kind: 'pipeline',
          effectiveDate: trainingStart,
          trainingDate: trainingStart,
          nestingDate: nestingStart,
          productionDate,
        },
      ],
    })
  }
  return employees
}

export type SampleWorkspace = {
  client: ClientProfile
  clients: ClientProfile[]
  scenarios: PlannerScenario[]
  rosterStore: ScenarioRosterStore
}

export function buildSampleWorkspace(
  planStartWeek = defaultCapacityPlanStartWeek('sunday', DEFAULT_CLIENT_TIMEZONE),
): SampleWorkspace {
  const clients: ClientProfile[] = []
  const scenarios: PlannerScenario[] = []
  const rosterStore: ScenarioRosterStore = {}
  let nameOffset = 0

  for (const bundle of SAMPLE_CLIENT_BUNDLES) {
    const client = createClientProfile({
      name: bundle.name,
      industry: /telco|telecom/i.test(bundle.name)
        ? 'Telecom'
        : /retail/i.test(bundle.name)
          ? 'Retail'
          : /travel/i.test(bundle.name)
            ? 'Travel'
            : 'Other',
      weekStart: 'sunday',
      timezone: DEFAULT_CLIENT_TIMEZONE,
      capacityPlanStartWeek: planStartWeek,
      planningWeeks: 52,
      buildMethod: 'forward',
      defaultPaidHours: 40,
      defaultShrinkagePct: 0.25,
      site: bundle.location,
    })
    client.id = bundle.id
    clients.push(client)

    for (const lob of bundle.lobs) {
      const plan = buildPlan(lob, client, bundle.location)
      const scenario = createScenario(
        `${bundle.name} · ${lob.lob}`,
        `${lob.lob} (${lob.channel}) capacity plan for ${bundle.name}.`,
        buildAssumptions(lob),
        plan,
        DEFAULT_ADMIN_EMAIL,
      )
      scenario.id = lob.id
      scenario.isBaseline = false
      scenarios.push(scenario)
      rosterStore[scenario.id] = buildSampleRosterEmployees(
        lob,
        planStartWeek,
        nameOffset,
        bundle.name,
        bundle.location,
      )
      nameOffset += rosterStore[scenario.id]!.length
    }
  }

  return { client: clients[0]!, clients, scenarios, rosterStore }
}

export function isSampleWorkspaceCurrent(): boolean {
  try {
    return localStorage.getItem(SAMPLE_WORKSPACE_VERSION_KEY) === SAMPLE_WORKSPACE_VERSION
  } catch {
    return false
  }
}

function buildSampleRevenueProjectionLines() {
  const year = new Date().getFullYear()
  const months = listFiscalMonthKeys(year)

  return SAMPLE_CLIENT_BUNDLES.flatMap((bundle) =>
    bundle.lobs.map((lob) => {
      const finance = financeForLob(lob)
      const monthInputs: Record<string, RevenueProjectionMonthInput> = {}
      const monthlyCapacity = Math.round(lob.forecastVolume * 4.33)
      for (const month of months) {
        monthInputs[month] = {
          ...emptyMonthInput(),
          capacity: monthlyCapacity,
          fte: lob.productionHc,
          aht: lob.ahtSeconds,
          occupancyPct: Math.round(lob.occupancyTarget * 100),
        }
      }
      return createRevenueProjectionLine({
        clientName: bundle.name,
        lobProjectName: lob.lob,
        location: bundle.location,
        projectCode: lob.projectCode,
        billingType: finance.billingType,
        channel: lob.channel,
        agentGroup: '',
        billRateMethod: finance.billRateMethod,
        billRateMethods: [finance.billRateMethod],
        defaults: {
          ...DEFAULT_REV_PROJ_DEFAULTS,
          aht: lob.ahtSeconds,
          occupancyPct: Math.round(lob.occupancyTarget * 100),
          loginHours: 8,
          absenteeismPct: 0,
          shrinkagePct: 0,
          hourlyBillRate: finance.hourlyBillRate,
          monthlyBillRate: finance.monthlyBillRate,
          perMinuteBillRate: finance.perMinuteBillRate,
          perTransactionBillRate: finance.perTransactionBillRate,
          hourlySalaryUsd: finance.hourlySalaryUsd,
          monthlyLaborPerFteUsd: finance.monthlyLaborPerFteUsd,
          supportSalaryUsd: finance.supportSalaryUsd,
          trainingSalaryRateUsd: finance.trainingSalaryRateUsd,
          otherCostUsd: finance.otherCostUsd,
        },
        useStaffingAbsenteeismShrinkage: false,
        months: monthInputs,
      })
    }),
  )
}

export function applySampleWorkspace(workspace = buildSampleWorkspace()): SampleWorkspace {
  for (const key of SAMPLE_WORKSPACE_RESET_KEYS) {
    try {
      localStorage.removeItem(key)
    } catch {
      /* ignore */
    }
  }
  saveClientRegistry(workspace.clients)
  localStorage.setItem(SCENARIOS_STORAGE_KEY, JSON.stringify(workspace.scenarios))
  const preferred =
    workspace.scenarios.find((scenario) => scenario.id.startsWith('scenario-telco-')) ?? workspace.scenarios[0]
  localStorage.setItem(ACTIVE_SCENARIO_STORAGE_KEY, preferred?.id ?? '')
  saveRosterStore(workspace.rosterStore)
  const planStart = workspace.clients[0]?.capacityPlanStartWeek ?? workspace.client.capacityPlanStartWeek
  const weekStart = workspace.clients[0]?.weekStart ?? workspace.client.weekStart
  saveLedgerOverrides(
    buildSampleLedgerOverrideStore(
      ALL_SAMPLE_LOBS.map((lob) => ({ ...lob, shrinkagePct: SAMPLE_SHRINKAGE })),
      planStart,
      weekStart,
    ),
  )
  const grantedAt = new Date().toISOString()
  savePlanAccessStore({
    grants: workspace.scenarios.flatMap((scenario) =>
      SEED_USERS.filter((user) => user.email !== DEFAULT_ADMIN_EMAIL).map((user) => ({
        scenarioId: scenario.id,
        granteeEmail: user.email,
        grantedByEmail: DEFAULT_ADMIN_EMAIL,
        grantedAt,
      })),
    ),
  })
  if (preferred) {
    saveCapacityPlanView({
      scenarioId: preferred.id,
      scenarioName: preferred.name,
      savedAt: new Date().toISOString(),
      granularity: 'weekly',
    })
    syncCapacityMatrixScope(preferred.id, {
      scenarioId: preferred.id,
      scopeId: `lob:${preferred.id}`,
      ...DEFAULT_CAPACITY_MATRIX_LAYOUT,
      collapsed: {
        ...DEFAULT_CAPACITY_MATRIX_COLLAPSED,
        staffing: false,
      },
      visibleShrinkageCategoryIds: ['absenteeism', 'vacation_leave'],
      savedAt: new Date().toISOString(),
    })
  }
  localStorage.setItem(SAMPLE_WORKSPACE_VERSION_KEY, SAMPLE_WORKSPACE_VERSION)
  saveRevenueProjectionLines(buildSampleRevenueProjectionLines())
  seedSampleVolumeForecasts(workspace.scenarios, ALL_SAMPLE_LOBS, SAMPLE_SHRINKAGE)
  seedSampleScheduling({
    scenarios: workspace.scenarios,
    rosterStore: workspace.rosterStore,
    lobs: ALL_SAMPLE_LOBS,
    preferredScenarioId: preferred?.id,
  })
  return workspace
}

function hasStoredScenarios(): boolean {
  try {
    const raw = localStorage.getItem(SCENARIOS_STORAGE_KEY)
    if (raw == null) return false
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) && parsed.length > 0
  } catch {
    return false
  }
}

function isSampleOnlyWorkspace(): boolean {
  try {
    const raw = localStorage.getItem(SCENARIOS_STORAGE_KEY)
    if (raw == null) return true
    const parsed = JSON.parse(raw) as Array<{ id?: string; isBaseline?: boolean }>
    if (!Array.isArray(parsed) || parsed.length === 0) return true
    const plans = parsed.filter((scenario) => !scenario.isBaseline)
    if (plans.length === 0) return true
    return plans.every(
      (scenario) =>
        typeof scenario.id === 'string' &&
        (scenario.id.startsWith('scenario-apex-') || scenario.id.startsWith('scenario-telco-')),
    )
  } catch {
    return true
  }
}

function hasTelcoSamplePlans(): boolean {
  try {
    const raw = localStorage.getItem(SCENARIOS_STORAGE_KEY)
    if (raw == null) return false
    const parsed = JSON.parse(raw) as Array<{ id?: string; plan?: { client?: string } }>
    if (!Array.isArray(parsed)) return false
    const hasTelcoScenario = parsed.some(
      (scenario) => typeof scenario.id === 'string' && scenario.id.startsWith('scenario-telco-'),
    )
    const hasTelcoClient = parsed.some((scenario) => scenario.plan?.client === TELCO_CLIENT_NAME)
    return hasTelcoScenario && hasTelcoClient
  } catch {
    return false
  }
}

/** Rewrite stored sample client labels without rebuilding the workspace. */
export function renameLegacySampleClients(): void {
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (!key) continue
      const value = localStorage.getItem(key)
      if (!value || (!value.includes('Apex Retail') && !value.includes('Telco Client'))) continue
      const next = value.replace(/Telco Client/g, 'Telco').replace(/Apex Retail/g, 'Retail')
      if (next !== value) localStorage.setItem(key, next)
    }
  } catch {
    /* storage may be unavailable */
  }
}

/**
 * Seed Retail + Telco for the portfolio.
 * Refreshes when the sample version is outdated or Telco plans are missing.
 * Preserves workspaces that already include Telco plus additional custom plans.
 */
export function ensureSampleWorkspace(): boolean {
  try {
    migrateClientIndustriesFromNames()
    if (isSampleWorkspaceCurrent() && hasTelcoSamplePlans()) return false
    if (hasStoredScenarios() && !isSampleOnlyWorkspace() && hasTelcoSamplePlans()) {
      localStorage.setItem(SAMPLE_WORKSPACE_VERSION_KEY, SAMPLE_WORKSPACE_VERSION)
      return false
    }
    applySampleWorkspace()
    return true
  } catch {
    return false
  }
}

/** Backfill industry on registry clients that predate the Industry field. */
export function migrateClientIndustriesFromNames(): void {
  try {
    const clients = loadClientRegistry()
    let changed = false
    const next = clients.map((client) => {
      if (client.industry?.trim()) return client
      const inferred = inferIndustryFromClientName(client.name)
      if (!inferred) return client
      changed = true
      return { ...client, industry: inferred, updatedAt: new Date().toISOString() }
    })
    if (changed) saveClientRegistry(next)
  } catch {
    /* ignore */
  }
}

function inferIndustryFromClientName(name: string): string {
  if (/telco|telecom/i.test(name)) return 'Telecom'
  if (/retail/i.test(name)) return 'Retail'
  if (/travel/i.test(name)) return 'Travel'
  if (/hospital/i.test(name)) return 'Hospitality'
  if (/bank|financ|insur/i.test(name)) return 'Financial'
  if (/health|medical/i.test(name)) return 'Healthcare'
  return ''
}
