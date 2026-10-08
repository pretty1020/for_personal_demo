import { loadAhtAnalysisOverrides } from '../planner/ahtAnalysisPersistence'
import { loadCapacityMatrixView } from '../planner/capacityViewPersistence'
import { loadCapacityPlanOverrides } from '../planner/capacityPlanOverridePersistence'
import { loadCapacityPlanView } from '../planner/capacityPlanView'
import {
  analyzeHistoricalAhtMix,
  applyAhtAnalysisOverrides,
  deriveCapacityPlanRows,
} from '../planner/capacityPlanDerived'
import { calculateCapacityRevenueLeakages } from '../planner/capacityRevenueLeakage'
import { runSimulation } from '../planner/engine'
import {
  buildScenarioForecast,
  forecastMetricDisplayLabel,
  usesBestForecastModel,
  type ForecastMetricUnit,
  type MetricForecastResult,
} from '../planner/forecasting'
import { fmtCurrency, fmtNum, fmtPct } from '../planner/format'
import { loadForecastOverrides, type ForecastMetricId } from '../planner/forecastPersistence'
import { loadLedgerOverrides } from '../planner/ledgerPersistence'
import { METRIC_LABELS } from '../planner/metricLabels'
import { loadActiveScenarioId, loadGranularity, loadScenarios } from '../planner/persistence'
import { loadRosterStore, type RosterEmployee } from '../planner/rosterPersistence'
import { SCENARIO_TEMPLATES } from '../planner/templates'
import type { PlannerAssumptions, PlannerScenario, PeriodResult } from '../planner/types'
import { CHANNEL_LABELS } from '../planner/types'
import { getSupportedChannels, resolveChannelAssumptions } from '../planner/channelPlanning'
import { buildWeeklyPlanLedger } from '../planner/weeklyLedger'
import { loadCustomBusinessInsights } from '../utils/idealBusinessInsightsStorage'

const FORECAST_HORIZON_WEEKS = 52
const ACTIVE_PERIOD_SAMPLE = 12
const FORECAST_WEEK_SAMPLE = 12

function rosterStatusSummary(employees: RosterEmployee[]): string {
  const counts = employees.reduce<Record<string, number>>((acc, employee) => {
    acc[employee.status] = (acc[employee.status] ?? 0) + 1
    return acc
  }, {})
  return Object.entries(counts)
    .map(([status, count]) => `${status}: ${count}`)
    .join(', ')
}

function countOverrideCells(store: Record<string, Record<string, unknown>> | undefined): number {
  if (!store) return 0
  return Object.values(store).reduce((sum, metrics) => {
    if (!metrics || typeof metrics !== 'object') return sum
    return sum + Object.keys(metrics).length
  }, 0)
}

function fmtForecastValue(unit: ForecastMetricUnit, value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (unit === 'percent') return fmtPct(value)
  if (unit === 'seconds') return `${fmtNum(value, 1)} sec`
  return fmtNum(value, unit === 'number' && value < 10 ? 2 : 0)
}

function buildScenarioLedger(
  scenario: PlannerScenario,
  ledgerOverrides: ReturnType<typeof loadLedgerOverrides>,
): ReturnType<typeof buildWeeklyPlanLedger> {
  const weeklyResult = runSimulation(scenario, 'weekly', FORECAST_HORIZON_WEEKS)
  return buildWeeklyPlanLedger(scenario, weeklyResult, ledgerOverrides[scenario.id] ?? [])
}

function formatAssumptionsDetail(a: PlannerAssumptions): string[] {
  return [
    'New hire pipeline:',
    `  Hiring plan per period: ${a.newHire.hiringPlanPerPeriod}`,
    `  Class size: ${a.newHire.classSize}`,
    `  Training weeks: ${a.newHire.trainingWeeks}, attrition in training: ${fmtPct(a.newHire.trainingAttritionRate)}`,
    `  Graduation rate: ${fmtPct(a.newHire.graduationRate)}, nesting weeks: ${a.newHire.nestingWeeks}`,
    `  Nesting attrition: ${fmtPct(a.newHire.nestingAttritionRate)}, nesting phone time: ${fmtPct(a.newHire.nestingPhoneTimePct)}`,
    `  Nesting phone ramp: [${a.newHire.nestingPhoneTimeRamp.map((v) => fmtPct(v)).join(', ')}]`,
    `  Ramp curve (productivity): [${a.newHire.rampCurve.map((v) => fmtPct(v)).join(', ')}]`,
    `  Time to proficiency: ${a.newHire.timeToProficiencyWeeks} weeks, hiring delay: ${a.newHire.hiringDelayWeeks} weeks`,
    `  Training cost per hire: ${fmtCurrency(a.newHire.trainingCostPerHire)}`,
    'Tenured staff:',
    `  Beginning production HC: ${fmtNum(a.tenured.beginningProductionHeadcount, 1)}`,
    `  Monthly attrition: ${fmtPct(a.tenured.attritionRateMonthly)}`,
    `  Shrinkage: ${fmtPct(a.tenured.shrinkageRate)} (${fmtPct(a.tenured.shrinkageInOfficeShare)} in-office)`,
    `  Scheduled hours/week: ${fmtNum(a.tenured.standardScheduledHoursPerWeek, 1)}`,
    `  OT hours/FTE/week: ${fmtNum(a.tenured.otHoursPerFtePerWeek, 1)}, VTO: ${fmtNum(a.tenured.vtoHoursPerFtePerWeek, 1)}`,
    `  Occupancy target: ${fmtPct(a.tenured.occupancyTarget)}, productivity factor: ${fmtPct(a.tenured.productivityFactor)}`,
    `  AHT: ${fmtNum(a.tenured.ahtSeconds, 0)} sec, utilization target: ${fmtPct(a.tenured.utilizationTarget)}`,
    `  Labor cost/FTE/month: ${fmtCurrency(a.tenured.laborCostPerFteMonthly)}`,
    'Business & financial:',
    `  Base forecast volume (monthly): ${fmtNum(a.business.baseForecastVolume, 0)}`,
    `  Monthly growth rate: ${fmtPct(a.business.growthRateMonthly)}`,
    `  Seasonality factors: [${a.business.seasonalityFactors.map((v) => fmtNum(v, 2)).join(', ')}]`,
    `  Service level target: ${fmtPct(a.business.serviceLevelTarget)}, ASA target: ${fmtNum(a.business.asaTargetSeconds, 0)} sec`,
    `  Staffing buffer: ${fmtPct(a.business.staffingBufferPct)}`,
    `  Revenue per contact: ${fmtCurrency(a.business.revenuePerContact)}, billing rate: ${fmtCurrency(a.business.billingRate)}`,
    `  Hourly salary: ${fmtCurrency(a.business.hourlySalaryUsd)}/hr, support salary: ${fmtCurrency(a.business.supportSalaryUsd)}/wk`,
    `  Training salary rate: ${fmtCurrency(a.business.trainingSalaryRateUsd)}/HC/wk, other cost: ${fmtCurrency(a.business.otherCostUsd)}/wk`,
    `  Revenue target/month: ${fmtCurrency(a.business.revenueTargetMonthly)}, budget/month: ${fmtCurrency(a.business.budgetConstraintMonthly)}`,
    `  SLA penalty per missed point: ${fmtCurrency(a.business.slaPenaltyPerMissedPoint)}, OT multiplier: ${fmtNum(a.business.overtimeMultiplier, 2)}x`,
  ]
}

function formatChannelAssumptionsDetail(a: PlannerAssumptions, plan: PlannerScenario['plan']): string[] {
  const supported = getSupportedChannels(plan)
  const channels = resolveChannelAssumptions(a, plan)
  const lines: string[] = ['Channel assumptions (omnichannel workforce planning):']
  for (const channel of supported) {
    const ch = channels[channel]
    lines.push(
      `  ${CHANNEL_LABELS[channel]}:`,
      `    Forecast volume: ${fmtNum(ch.forecastVolume, 0)}`,
      `    AHT/processing time: ${fmtNum(ch.ahtSeconds, 0)} sec`,
      `    Paid hours/FTE/week: ${fmtNum(ch.paidHoursPerFte, 1)}`,
      `    Occupancy: ${fmtPct(ch.occupancyTarget)}, Productivity: ${fmtPct(ch.productivityPct)}`,
      `    Shrinkage: ${fmtPct(ch.shrinkagePct)}, Chat concurrency: ${fmtNum(ch.chatConcurrency, 1)}`,
      `    Channel mix: ${fmtPct(ch.channelMixPct)}, Revenue/contact: ${fmtCurrency(ch.revenuePerContact)}`,
    )
  }
  lines.push(
    'Channel staffing formulas:',
    '  Workload Hours = (Forecast Volume × AHT) ÷ 3600',
    '  Voice: Productive Hours = Paid Hours × Occupancy',
    '  Chat: Productive Hours = Paid Hours × Occupancy × Chat Concurrency',
    '  Async channels: Productive Hours = Paid Hours × Productivity',
    '  Required FTE = Workload Hours ÷ Productive Hours per FTE',
    '  Required Headcount = Required FTE ÷ (1 − Shrinkage) — shrinkage applied once per channel',
    '  Total Required FTE = Sum of channel Required FTE (not averaged)',
  )
  return lines
}

function formatChannelStaffingSummary(period: PeriodResult): string[] {
  if (!period.channelStaffing) return []
  const cs = period.channelStaffing
  const lines: string[] = [
    'Channel staffing (latest period):',
    `  Total workload hours: ${fmtNum(cs.totalWorkloadHours, 1)}`,
    `  Total required FTE: ${fmtNum(cs.totalRequiredFte, 2)}`,
    `  Total required headcount: ${fmtNum(cs.totalRequiredHeadcount, 2)}`,
  ]
  for (const ch of cs.byChannel) {
    lines.push(
      `  ${CHANNEL_LABELS[ch.channel]}: vol ${fmtNum(ch.forecastVolume, 0)}, workload ${fmtNum(ch.workloadHours, 1)} hrs, req FTE ${fmtNum(ch.requiredFte, 2)}, req HC ${fmtNum(ch.requiredHeadcount, 2)}, gap vs production allocated in financials`,
    )
  }
  if (period.channelFinancials?.length) {
    lines.push('Channel financials (latest period):')
    for (const fin of period.channelFinancials) {
      lines.push(
        `  ${CHANNEL_LABELS[fin.channel]}: prod FTE ${fmtNum(fin.productionFte, 2)}, staffing gap ${fmtNum(fin.staffingGap, 2)}, revenue ${fmtCurrency(fin.revenue)}, labor ${fmtCurrency(fin.laborCost)}, margin ${fmtCurrency(fin.grossMargin)} (${fmtPct(fin.grossMarginPct)}), utilization ${fmtPct(fin.capacityUtilization)}`,
      )
    }
  }
  return lines
}

function samplePeriods(periods: PeriodResult[], max = ACTIVE_PERIOD_SAMPLE): PeriodResult[] {
  if (periods.length <= max) return periods
  const head = periods.slice(0, Math.ceil(max * 0.67))
  const tail = periods.slice(-Math.floor(max * 0.33))
  return [...head, ...tail]
}

function formatPeriodSummary(p: PeriodResult): string {
  return [
    p.periodLabel,
    `vol ${fmtNum(p.forecastVolume, 0)}`,
    `req HC ${fmtNum(p.requiredFte, 1)}`,
    `prod FTE ${fmtNum(p.productiveFte, 1)}`,
    `gap ${fmtNum(p.capacityGap, 1)}`,
    `occ ${fmtPct(p.occupancy)}`,
    `rev ${fmtCurrency(p.revenue)}`,
    `cost ${fmtCurrency(p.totalCost)}`,
    `leak ${fmtCurrency(p.leakages.total)}`,
  ].join(' · ')
}

function formatForecastModels(metric: MetricForecastResult): string[] {
  const lines: string[] = []
  const bestRmse = metric.modelResults
    .map((model) => model.rmse)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)[0]

  lines.push(
    `${forecastMetricDisplayLabel(metric.metricId as ForecastMetricId)} (${metric.unit}):`,
    `  Historical points: ${metric.actualSeries.length}`,
    `  Selection rule: ${usesBestForecastModel(metric.metricId as ForecastMetricId) ? 'best RMSE model' : 'preferred/default model'}`,
    `  Selected model: ${metric.selectedModel?.label ?? 'none'} (RMSE ${metric.selectedModel ? fmtNum(metric.selectedModel.rmse, 2) : 'n/a'})`,
  )

  if (metric.modelResults.length) {
    lines.push('  Model comparison:')
    for (const model of metric.modelResults) {
      const isBest = bestRmse != null && model.rmse === bestRmse
      const isSelected = metric.selectedModel?.id === model.id
      lines.push(
        `    - ${model.label}: RMSE ${fmtNum(model.rmse, 2)}, MAE ${fmtNum(model.mae, 2)}, MAPE ${fmtNum(model.mapePct, 1)}%${isBest ? ' [best RMSE]' : ''}${isSelected ? ' [selected]' : ''}`,
      )
    }
  }

  const forecastSample = metric.forecast.slice(0, FORECAST_WEEK_SAMPLE)
  if (forecastSample.length) {
    lines.push(`  Forecast (${forecastSample.length} of ${metric.forecast.length} planned weeks):`)
    for (const point of forecastSample) {
      lines.push(`    ${point.label}: ${fmtForecastValue(metric.unit, point.value)} (${point.source})`)
    }
  }

  return lines
}

function formatForecastOverrideValues(
  overrides: Partial<Record<ForecastMetricId, Record<number, number>>>,
  maxMetrics = 8,
  maxPeriodsPerMetric = 6,
): string[] {
  const lines: string[] = []
  const metricIds = Object.keys(overrides) as ForecastMetricId[]
  if (!metricIds.length) return ['No manual forecast overrides — model values drive the plan.']

  for (const metricId of metricIds.slice(0, maxMetrics)) {
    const periods = overrides[metricId]
    if (!periods) continue
    const entries = Object.entries(periods)
      .map(([index, value]) => ({ index: Number(index), value }))
      .filter((entry) => Number.isFinite(entry.value))
      .sort((a, b) => a.index - b.index)
    if (!entries.length) continue
    lines.push(`${forecastMetricDisplayLabel(metricId)} overrides (${entries.length} week(s)):`)
    for (const entry of entries.slice(0, maxPeriodsPerMetric)) {
      lines.push(`  Week index ${entry.index}: ${fmtNum(entry.value, 2)}`)
    }
    if (entries.length > maxPeriodsPerMetric) {
      lines.push(`  … and ${entries.length - maxPeriodsPerMetric} more week(s)`)
    }
  }
  return lines
}

function orderScenarios(scenarios: PlannerScenario[], activeId: string | null): PlannerScenario[] {
  const active = scenarios.find((s) => s.id === activeId)
  const baseline = scenarios.find((s) => s.isBaseline && s.id !== activeId)
  const rest = scenarios.filter((s) => s.id !== activeId && s.id !== baseline?.id)
  return [active, baseline, ...rest].filter((s): s is PlannerScenario => s != null)
}

export function buildAssistantContext(currentPage?: string): string {
  const scenarios = loadScenarios()
  const activeId = loadActiveScenarioId()
  const granularity = loadGranularity()
  const orderedScenarios = orderScenarios(scenarios, activeId)
  const active = orderedScenarios[0] ?? null
  const capacityView = loadCapacityPlanView()
  const capacityMatrix = loadCapacityMatrixView()
  const capacityOverrides = loadCapacityPlanOverrides()
  const forecastOverrides = loadForecastOverrides()
  const rosterStore = loadRosterStore()
  const ledgerOverrides = loadLedgerOverrides()
  const ahtOverrides = loadAhtAnalysisOverrides()

  const lines: string[] = [
    '=== Full application workspace (all modules) ===',
    `Generated at: ${new Date().toISOString()}`,
    currentPage ? `User is currently viewing: ${currentPage}` : 'User screen: not specified',
    'Modules included below: Planning, Capacity, Roster, Forecasting, Financial insights.',
    '',
    `Active plan: ${active?.name ?? 'none'}`,
    `Total saved plans: ${scenarios.length}`,
    `Planning granularity: ${granularity}`,
    '',
    '=== HOW THE APP MODELS WORK (reference for explanations) ===',
    'Planning simulation (runSimulation):',
    '- Forecast volume each period = base monthly volume × seasonality × growth, scaled to period length.',
    '- Required FTE = (volume × AHT / 3600) ÷ productive hours per FTE, plus staffing buffer.',
    '- Multi-channel LOBs: each channel calculates workload, required FTE, and required headcount independently.',
    '- Channel totals sum required FTE and headcount across channels (never averaged). Shrinkage applied once per channel.',
    '- Channel types: Voice (occupancy), Chat (occupancy × concurrency), async channels (productivity).',
    '- AI can answer: which channel is understaffed, FTE needed for Chat, AHT sensitivity, staffing gaps by client, margin by scenario.',
    '- Hiring fills gaps between projected ending HC (after attrition) and required FTE.',
    '- Training pipeline: hires → training → nesting (partial phone time ramp) → graduates with productivity ramp curve.',
    '- Revenue = handled volume × revenue per contact; costs = labor + training + hiring + leakage penalties.',
    'Forecasting module (buildScenarioForecast):',
    '- Uses historical actuals from the weekly ledger to fit naive, moving average, OLS trend, seasonal naive, and exponential smoothing models.',
    '- Error metrics (RMSE, MAE, MAPE) compare in-sample one-step-ahead fits.',
    '- Volume uses trend model; shrinkage metrics use best RMSE; other drivers have preferred models.',
    '- Manual overrides per week replace model values; Capacity page uses forecast mode when enabled.',
    'AHT analysis:',
    '- Separates production-only vs nesting-heavy weeks; derives nesting multiplier and learning curve from history.',
    '- Tenure-adjusted AHT blends nesting share with multiplier and learning-curve reduction.',
    'Available scenario templates:',
    ...SCENARIO_TEMPLATES.map((template) => `- ${template.name}: ${template.description} — ${template.details}`),
  ]

  lines.push('', '=== PLANNING module ===')
  for (const scenario of orderedScenarios.slice(0, 12)) {
    const isActive = active?.id === scenario.id
    const sim = runSimulation(scenario, granularity)
    const summary = sim.summary
    const last = sim.periods[sim.periods.length - 1]

    lines.push(
      '',
      `--- Plan: ${scenario.name}${scenario.isBaseline ? ' (reference plan)' : ''} ---`,
      `Client: ${scenario.plan.client}`,
      `Team / LOB: ${scenario.plan.location}`,
      `Channels: ${getSupportedChannels(scenario.plan).map((c) => CHANNEL_LABELS[c]).join(', ')}`,
      `Billing: ${scenario.plan.billingType}`,
      `Week starts: ${scenario.plan.weekStart}`,
      `Active: ${isActive ? 'yes' : 'no'}`,
      `Last updated: ${scenario.updatedAt}`,
      `Horizon ${METRIC_LABELS.requiredHeadcount}: ${fmtNum(summary.requiredFte, 1)}`,
      `Production staff (FTE): ${fmtNum(summary.workforceFte, 1)}`,
      `Production FTE: ${fmtNum(summary.productionFte, 1)}`,
      `Hiring total (horizon): ${fmtNum(summary.hiringTotal, 0)}`,
      `Attrition total (horizon): ${fmtNum(summary.attritionTotal, 0)}`,
      `Occupancy: ${fmtPct(summary.occupancy)}`,
      `Productivity: ${fmtPct(summary.productivity)}`,
      `Revenue projection (horizon): ${fmtCurrency(summary.revenueProjection)}`,
      `Cost projection (horizon): ${fmtCurrency(summary.costProjection)}`,
      `Gross margin (horizon): ${fmtCurrency(summary.grossMargin)}`,
      `Profitability (horizon): ${fmtCurrency(summary.profitability)}`,
      `Cost leakage (horizon): ${fmtCurrency(summary.totalLeakage)}`,
      `Capacity gap: ${fmtNum(summary.capacityGap, 1)}`,
      `Over/under staffing: ${fmtNum(summary.overUnderStaffing, 1)}`,
    )

    if (summary.risks.length) {
      lines.push(`Risks: ${summary.risks.join('; ')}`)
    }
    if (summary.recommendedActions.length) {
      lines.push(`Recommended actions: ${summary.recommendedActions.join('; ')}`)
    }

    if (last) {
      lines.push(
        `Latest period snapshot:`,
        `  Scheduled hours: ${fmtNum(last.scheduledHours, 0)}, productive hours: ${fmtNum(last.productiveHours, 0)}`,
        `  Forecast volume: ${fmtNum(last.forecastVolume, 0)}, handled implied capacity: ${fmtNum(last.utilization * last.forecastVolume, 0)}`,
        `  Beginning production HC: ${fmtNum(last.beginningProductionHc, 1)}, training HC: ${fmtNum(last.trainingHeadcount, 1)}, nesting HC: ${fmtNum(last.nestingHeadcount, 1)}`,
        `  Leakage breakdown — overstaffing: ${fmtCurrency(last.leakages.overstaffing)}, understaffing: ${fmtCurrency(last.leakages.understaffing)}, shrinkage: ${fmtCurrency(last.leakages.shrinkage)}, SLA penalties: ${fmtCurrency(last.leakages.slaPenalties)}`,
      )
    }

    if (isActive) {
      lines.push('Full assumptions (active plan):', ...formatAssumptionsDetail(scenario.assumptions))
      lines.push(...formatChannelAssumptionsDetail(scenario.assumptions, scenario.plan))
      if (last) {
        lines.push(...formatChannelStaffingSummary(last))
      }
      lines.push(`Period-by-period (${samplePeriods(sim.periods).length} of ${sim.periods.length} periods):`)
      for (const period of samplePeriods(sim.periods)) {
        lines.push(`  ${formatPeriodSummary(period)}`)
      }
    } else {
      const a = scenario.assumptions
      lines.push(
        'Key assumptions (summary):',
        `- Weekly hiring plan: ${a.newHire.hiringPlanPerPeriod}`,
        `- Training weeks: ${a.newHire.trainingWeeks}, Nesting weeks: ${a.newHire.nestingWeeks}`,
        `- Monthly attrition rate: ${fmtPct(a.tenured.attritionRateMonthly)}`,
        `- Shrinkage rate: ${fmtPct(a.tenured.shrinkageRate)}`,
        `- AHT (seconds): ${fmtNum(a.tenured.ahtSeconds, 0)}`,
        `- Base forecast volume (monthly): ${fmtNum(a.business.baseForecastVolume, 0)}`,
        `- Monthly growth rate: ${fmtPct(a.business.growthRateMonthly)}`,
        `- Revenue per contact: ${fmtCurrency(a.business.revenuePerContact)}`,
      )
    }
  }

  lines.push('', '=== CAPACITY module ===')
  if (capacityView) {
    lines.push(
      `Published capacity view linked plan: ${capacityView.scenarioName}`,
      `Published at: ${capacityView.savedAt}`,
      `View granularity: ${capacityView.granularity}`,
    )
    if (capacityView.snapshot) {
      const snap = capacityView.snapshot
      lines.push(
        `Current published revenue: ${fmtCurrency(snap.revenue)}`,
        `Current published total cost: ${fmtCurrency(snap.totalCost)}`,
        `Snapshot production HC: ${fmtNum(snap.productionHeadcount ?? 0, 1)}`,
        `Snapshot required HC: ${fmtNum(snap.requiredHeadcount ?? 0, 1)}`,
        `Snapshot cost leakage total: ${fmtCurrency(snap.costLeakageTotal ?? 0)}`,
      )
    }
    if (capacityView.originalSnapshot) {
      const orig = capacityView.originalSnapshot
      lines.push(
        `Original publish baseline revenue: ${fmtCurrency(orig.revenue)}`,
        `Original publish baseline total cost: ${fmtCurrency(orig.totalCost)}`,
      )
    }
  } else {
    lines.push('No published capacity snapshot yet.')
  }

  if (capacityMatrix) {
    lines.push(
      `Capacity matrix scenario: ${capacityMatrix.scenarioId}`,
      `Matrix scope: ${capacityMatrix.scopeId}`,
      `Matrix view: ${capacityMatrix.view}`,
      `Show future weeks: ${capacityMatrix.showFutureWeeks ? 'yes' : 'no'}`,
      `Hidden weeks count: ${capacityMatrix.hiddenWeeks.length}`,
      `Saved at: ${capacityMatrix.savedAt}`,
    )
  }

  const capacityOverrideCount = Object.values(capacityOverrides).reduce(
    (sum, scenarioOverrides) => sum + countOverrideCells(scenarioOverrides as Record<string, Record<string, unknown>>),
    0,
  )
  lines.push(`Capacity plan manual overrides: ${capacityOverrideCount}`)

  if (active) {
    const ledger = buildScenarioLedger(active, ledgerOverrides)
    const forecast = buildScenarioForecast(ledger, forecastOverrides[active.id], FORECAST_HORIZON_WEEKS)
    const plannedOverrides = capacityOverrides[active.id] ?? {}
    const ahtOverride = ahtOverrides[active.id]
    const capacityRows = deriveCapacityPlanRows(ledger, active, forecast, plannedOverrides, undefined, 0, ahtOverride)
    const ahtAnalysis = applyAhtAnalysisOverrides(analyzeHistoricalAhtMix(ledger, capacityRows), ahtOverride)
    const leakages = calculateCapacityRevenueLeakages(
      capacityRows,
      active.plan.billingType,
      active.assumptions.business.billingRate,
      active.assumptions.tenured.standardScheduledHoursPerWeek,
      active.assumptions.business.hourlySalaryUsd,
    )

    lines.push(
      '',
      `Active plan capacity detail (${active.name}):`,
      `Historical AHT — production-only: ${ahtAnalysis.productionOnlyAht != null ? `${fmtNum(ahtAnalysis.productionOnlyAht, 1)} sec` : 'n/a'}`,
      `Historical AHT — with nesting: ${ahtAnalysis.withNestingAht != null ? `${fmtNum(ahtAnalysis.withNestingAht, 1)} sec` : 'n/a'}`,
      `Nesting multiplier: ${fmtNum(ahtAnalysis.nestingMultiplier, 3)}`,
      `Learning curve weekly improvement: ${fmtPct(ahtAnalysis.learningCurveWeeklyImprovementPct)}`,
      `Avg nesting HC: ${fmtNum(ahtAnalysis.historicalAvgNestingHc, 1)}, avg production HC: ${fmtNum(ahtAnalysis.historicalAvgProductionHc, 1)}`,
    )
    if (ahtOverride) {
      lines.push(
        'Saved AHT overrides:',
        ahtOverride.nestingMultiplier != null ? `  Nesting multiplier override: ${fmtNum(ahtOverride.nestingMultiplier, 3)}` : '',
        ahtOverride.learningCurveWeeklyImprovementPct != null
          ? `  Learning curve override: ${fmtPct(ahtOverride.learningCurveWeeklyImprovementPct)}`
          : '',
      )
    }

    const forwardRows = capacityRows.filter((row) => row.timeline === 'forward_plan').slice(0, 8)
    if (forwardRows.length) {
      lines.push('Forward capacity weeks (sample):')
      for (const row of forwardRows) {
        lines.push(
          `  ${row.week}: vol ${fmtNum(row.planned.volume, 0)}, AHT ${fmtNum(row.planned.ahtSeconds, 0)}s, shrink ${fmtPct(row.planned.shrinkagePct)}, prod FTE ${fmtNum(row.planned.productionFte, 1)}, req FTE ${fmtNum(row.planned.requiredFte, 1)}, gap ${fmtNum(row.planned.overUnderFte, 1)}`,
        )
      }
    }

    lines.push(
      'Revenue leakage drivers (actual vs planned, active plan):',
      `  Understaffing: ${fmtCurrency(leakages.headcount)}`,
      `  Overstaffing: ${fmtCurrency(leakages.overstaffing)}`,
      `  Non-billable shrinkages: ${fmtCurrency(leakages.shrinkage)}`,
      `  AHT: ${fmtCurrency(leakages.aht)}`,
      `  Attrition: ${fmtCurrency(leakages.attrition)}`,
      `  Volume: ${fmtCurrency(leakages.volume)}`,
      `  Total: ${fmtCurrency(leakages.total)}`,
    )
  }

  lines.push('', '=== ROSTER module ===')
  const rosterScenarioIds = Object.keys(rosterStore)
  if (!rosterScenarioIds.length) {
    lines.push('No roster employees saved yet.')
  } else {
    for (const scenarioId of rosterScenarioIds.slice(0, 8)) {
      const scenario = scenarios.find((item) => item.id === scenarioId)
      const employees = rosterStore[scenarioId] ?? []
      const named = employees.filter((employee) => employee.name.trim()).slice(0, 6)
      lines.push(
        '',
        `--- Roster for ${scenario?.name ?? scenarioId} ---`,
        `Employees: ${employees.length}`,
        rosterStatusSummary(employees) || 'No status breakdown',
      )
      if (named.length) {
        lines.push(
          'Sample people:',
          ...named.map(
            (employee) =>
              `- ${employee.name} (${employee.position || 'role n/a'}) · status ${employee.status} · production ${employee.productionDate || 'n/a'}`,
          ),
        )
      }
    }
  }

  lines.push('', '=== FORECASTING module ===')
  const forecastScenarioIds = [
    ...(active ? [active.id] : []),
    ...Object.keys(forecastOverrides).filter((id) => id !== active?.id),
    ...scenarios.map((s) => s.id).filter((id) => id !== active?.id && !forecastOverrides[id]),
  ].filter((id, index, arr) => arr.indexOf(id) === index)

  for (const scenarioId of forecastScenarioIds.slice(0, 6)) {
    const scenario = scenarios.find((item) => item.id === scenarioId)
    if (!scenario) continue
    const isActive = scenarioId === active?.id
    const ledger = buildScenarioLedger(scenario, ledgerOverrides)
    const overrides = forecastOverrides[scenarioId]
    const forecast = buildScenarioForecast(ledger, overrides, FORECAST_HORIZON_WEEKS)

    lines.push('', `--- Forecasting: ${scenario.name}${isActive ? ' (active)' : ''} ---`)

    if (overrides && Object.keys(overrides).length) {
      lines.push('Manual overrides:', ...formatForecastOverrideValues(overrides, isActive ? 12 : 4, isActive ? 8 : 3))
    } else {
      lines.push('Manual overrides: none — model forecasts drive values.')
    }

    const driverMetricIds: ForecastMetricId[] = [
      'callVolume',
      'attritionHc',
      'absenteeism',
      'ahtSeconds',
      'occupancy',
      'totalShrinkagePct',
    ]
    const metricsToShow = forecast.metrics.filter((metric) =>
      isActive ? driverMetricIds.includes(metric.metricId as ForecastMetricId) : metric.metricId === 'callVolume',
    )

    for (const metric of metricsToShow) {
      lines.push(...formatForecastModels(metric))
    }

    if (!isActive) {
      const otherMetrics = forecast.metrics.length - metricsToShow.length
      if (otherMetrics > 0) {
        lines.push(`  (+ ${otherMetrics} additional forecast metrics available on active plan detail)`)
      }
    }
  }

  lines.push('', '=== FINANCIAL module ===')
  lines.push(
    'Financial figures above come from planning simulations and capacity revenue leakage analysis.',
    'Additional financial notes saved in the app:',
  )

  for (const scenarioKey of [
    'overview',
    'projection_vs_actual',
    'budget_vs_projection',
    'commit_vs_actual',
  ] as const) {
    const insights = loadCustomBusinessInsights(scenarioKey)
    if (!insights) continue
    lines.push(
      '',
      `--- Financial insights (${scenarioKey}) ---`,
      `Updated: ${insights.updatedAt}`,
    )
    if (insights.freeformNotes.trim()) {
      lines.push(`Notes: ${insights.freeformNotes.trim()}`)
    }
    for (const card of insights.cards.slice(0, 8)) {
      lines.push(`Insight · ${card.title} (${card.tone}): ${card.body}`)
    }
  }

  const ledgerScenarioIds = Object.keys(ledgerOverrides)
  if (ledgerScenarioIds.length) {
    lines.push('', '--- Ledger actual overrides ---')
    for (const scenarioId of ledgerScenarioIds.slice(0, 6)) {
      const scenario = scenarios.find((item) => item.id === scenarioId)
      const rows = ledgerOverrides[scenarioId] ?? []
      lines.push(`${scenario?.name ?? scenarioId}: ${rows.length} actual override row(s)`)
      if (scenarioId === active?.id) {
        for (const row of rows.slice(0, 6)) {
          const metricKeys = Object.keys(row.metrics ?? {})
          lines.push(`  Week ${row.week}: overridden fields — ${metricKeys.join(', ') || 'none'}`)
        }
      }
    }
  } else {
    lines.push('No ledger actual overrides saved.')
  }

  return lines.filter(Boolean).join('\n')
}
