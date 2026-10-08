import type {
  ExecutiveSummary,
  FinancialLeakages,
  PeriodGranularity,
  PeriodResult,
  PlannerAssumptions,
  PlannerScenario,
  SimulationResult,
} from './types'
import { buildTrainingPipeline } from './trainingPipelineHc'
import { demoPlannedShrinkageRate } from './demoHistoricalSeries'
import { headcountCapacityGap, headcountOverUnder } from './workforceMetrics'
import {
  calculateConsolidatedStaffing,
  calculatePeriodChannelFinancials,
  getSupportedChannels,
  getTotalStartingProductionHc,
  resolveChannelAssumptions,
} from './channelPlanning'

const WEEKS_PER_MONTH = 4.33
const MIN_OCCUPANCY = 0.75

function periodCount(granularity: PeriodGranularity, horizonWeeks = 52): number {
  switch (granularity) {
    case 'daily':
      return horizonWeeks * 7
    case 'weekly':
      return horizonWeeks
    case 'monthly':
      return Math.ceil(horizonWeeks / WEEKS_PER_MONTH)
    case 'quarterly':
      return Math.ceil(horizonWeeks / (WEEKS_PER_MONTH * 3))
    case 'yearly':
      return 1
    default:
      return horizonWeeks
  }
}

function periodLabel(i: number, granularity: PeriodGranularity): string {
  switch (granularity) {
    case 'weekly':
      return `W${i + 1}`
    case 'monthly':
      return `M${i + 1}`
    case 'quarterly':
      return `Q${i + 1}`
    case 'yearly':
      return 'FY'
    case 'daily':
      return `D${i + 1}`
    default:
      return `P${i + 1}`
  }
}

function weeksInPeriod(granularity: PeriodGranularity): number {
  switch (granularity) {
    case 'daily':
      return 1 / 7
    case 'weekly':
      return 1
    case 'monthly':
      return WEEKS_PER_MONTH
    case 'quarterly':
      return WEEKS_PER_MONTH * 3
    case 'yearly':
      return 52
    default:
      return 1
  }
}

function seasonality(a: PlannerAssumptions, periodIndex: number, granularity: PeriodGranularity): number {
  const factors = a.business.seasonalityFactors
  if (!factors.length) return 1
  const monthIdx =
    granularity === 'monthly'
      ? periodIndex % factors.length
      : granularity === 'quarterly'
        ? (periodIndex * 3) % factors.length
        : periodIndex % factors.length
  return factors[monthIdx] ?? 1
}

function growthFactor(a: PlannerAssumptions, periodIndex: number, granularity: PeriodGranularity): number {
  const monthsElapsed =
    granularity === 'monthly'
      ? periodIndex
      : granularity === 'quarterly'
        ? periodIndex * 3
        : granularity === 'yearly'
          ? 12
          : periodIndex / WEEKS_PER_MONTH
  return Math.pow(1 + a.business.growthRateMonthly, monthsElapsed)
}

function computeLeakages(
  a: PlannerAssumptions,
  required: number,
  productive: number,
  scheduled: number,
  serviceLevel: number,
  revenue: number,
): FinancialLeakages {
  const over = Math.max(0, productive - required)
  const under = Math.max(0, required - productive)
  const costPerFteWeek = a.tenured.laborCostPerFteMonthly / WEEKS_PER_MONTH

  const overstaffing = over * costPerFteWeek * 0.35
  const understaffing = under * costPerFteWeek * 0.45
  const overtime = under * costPerFteWeek * Math.max(a.business.overtimeMultiplier - 1, 0) * 0.2
  const idleTime = over * costPerFteWeek * 0.18
  const absenteeism = scheduled * costPerFteWeek * (1 - a.tenured.attendanceRate) * 0.25
  const shrinkage = scheduled * costPerFteWeek * a.tenured.shrinkageRate * 0.15
  const productivityLoss =
    scheduled * costPerFteWeek * Math.max(0, 1 - a.tenured.productivityFactor) * 0.12
  const slaGap = Math.max(0, a.business.serviceLevelTarget - serviceLevel)
  const slaPenalties = Math.min(slaGap * 100 * a.business.slaPenaltyPerMissedPoint, revenue * 0.02)

  const rawTotal =
    overstaffing + understaffing + overtime + idleTime + absenteeism + shrinkage + productivityLoss + slaPenalties
  const cap = revenue * 0.08
  const scale = rawTotal > cap && rawTotal > 0 ? cap / rawTotal : 1

  return {
    overstaffing: overstaffing * scale,
    understaffing: understaffing * scale,
    overtime: overtime * scale,
    idleTime: idleTime * scale,
    absenteeism: absenteeism * scale,
    shrinkage: shrinkage * scale,
    productivityLoss: productivityLoss * scale,
    slaPenalties: slaPenalties * scale,
    total: rawTotal * scale,
  }
}

function requiredFteForPeriod(
  a: PlannerAssumptions,
  plan: { supportedChannels?: import('./types').ChannelType[] },
  forecastVolume: number,
  weeksPerPeriod: number,
  volumeScale = 1,
): number {
  const supported = getSupportedChannels(plan as import('./types').PlannerPlanMetadata)
  if (supported.length > 1 || (supported.length === 1 && a.channels?.[supported[0]!])) {
    const consolidated = calculateConsolidatedStaffing(a, plan as import('./types').PlannerPlanMetadata, volumeScale)
    return consolidated.totalRequiredFte * (1 + a.business.staffingBufferPct)
  }
  const workloadHours = (forecastVolume * a.tenured.ahtSeconds) / 3600
  const productiveHoursPerFte = a.tenured.standardScheduledHoursPerWeek * weeksPerPeriod * a.tenured.occupancyTarget
  if (productiveHoursPerFte <= 0) return 0
  return (workloadHours / productiveHoursPerFte) * (1 + a.business.staffingBufferPct)
}

function productiveHoursForFte(a: PlannerAssumptions, productiveFte: number, weeksPerPeriod: number): number {
  return productiveFte * a.tenured.standardScheduledHoursPerWeek * weeksPerPeriod * a.tenured.occupancyTarget * a.tenured.productivityFactor
}

function safeRatio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null
  return numerator / denominator
}

export function runSimulation(
  scenario: PlannerScenario,
  granularity: PeriodGranularity = 'weekly',
  horizonWeeks = 52,
): SimulationResult {
  const a = scenario.assumptions
  const n = periodCount(granularity, horizonWeeks)
  const wpp = weeksInPeriod(granularity)
  const periods: PeriodResult[] = []
  const attritionPerPeriod = a.tenured.attritionRateMonthly * (wpp / WEEKS_PER_MONTH)
  const plannedHires = Array.from({ length: n }, () => 0)

  let beginningProductionHc = getTotalStartingProductionHc(a, scenario.plan)

  for (let i = 0; i < n; i++) {
    const season = seasonality(a, i, granularity)
    const growth = growthFactor(a, i, granularity)
    const volumeScale = season * growth * (wpp / WEEKS_PER_MONTH)
    const channelAssumptions = resolveChannelAssumptions(a, scenario.plan)
    const channelStaffing = calculateConsolidatedStaffing(a, scenario.plan, volumeScale)
    const forecastVolume = channelStaffing.totalForecastVolume || Math.round(a.business.baseForecastVolume * volumeScale)
    const requiredFte = requiredFteForPeriod(a, scenario.plan, forecastVolume, wpp, volumeScale)

    const attritionPlanned = beginningProductionHc * attritionPerPeriod
    const projectedEndingWithoutHiring = Math.max(0, beginningProductionHc - attritionPlanned)
    const gapToRequired = requiredFte - projectedEndingWithoutHiring
    const hiringPlanned =
      gapToRequired > 0.25
        ? Math.min(Math.round(a.newHire.hiringPlanPerPeriod * wpp), Math.ceil(gapToRequired))
        : 0

    plannedHires[i] = hiringPlanned
    const pipeline = buildTrainingPipeline(plannedHires, a).periods[i]!

    const endingProductionHc = Math.max(0, beginningProductionHc + pipeline.graduates - attritionPlanned)
    const totalShrinkageRate = demoPlannedShrinkageRate(i, a.tenured.shrinkageRate)
    const coreProductionFte = endingProductionHc * (1 - totalShrinkageRate)
    const nestingProductiveFte = pipeline.nestingProductiveFte
    const productiveFte = coreProductionFte + nestingProductiveFte
    const staffingPct = safeRatio(productiveFte, requiredFte)
    const netStaffing = productiveFte - requiredFte
    const overstaffing = Math.max(0, netStaffing)
    const understaffing = Math.max(0, -netStaffing)
    const capacityGap = headcountCapacityGap(productiveFte, requiredFte)
    const backfillRequired = Math.ceil(attritionPlanned + pipeline.trainingAttrition + pipeline.nestingAttrition)

    const productiveHours = productiveHoursForFte(a, productiveFte, wpp)
    const effectiveAht =
      channelStaffing.weightedAhtSeconds > 0 ? channelStaffing.weightedAhtSeconds : a.tenured.ahtSeconds
    const handledCapacity = effectiveAht > 0 ? (productiveHours * 3600) / effectiveAht : 0
    const handledVolume = Math.min(forecastVolume, handledCapacity)
    const serviceLevel = Math.min(
      0.99,
      a.business.serviceLevelTarget * Math.max(0.7, productiveFte / Math.max(requiredFte, 1)),
    )
    const occupancy = Math.min(
      0.99,
      Math.max(
        MIN_OCCUPANCY,
        safeRatio((handledVolume * effectiveAht) / 3600, Math.max(productiveHours, 1)) ?? MIN_OCCUPANCY,
      ),
    )
    const productivity = a.tenured.productivityFactor
    const utilization = Math.min(1.1, Math.max(0, safeRatio(handledVolume, Math.max(forecastVolume, 1)) ?? 0))

    const revenue =
      channelStaffing.byChannel.length > 0
        ? channelStaffing.byChannel.reduce(
            (s, ch) => s + ch.forecastVolume * (channelAssumptions[ch.channel]?.revenuePerContact ?? a.business.revenuePerContact),
            0,
          ) * Math.min(1, handledVolume / Math.max(forecastVolume, 1))
        : handledVolume * a.business.revenuePerContact
    const channelFinancials = calculatePeriodChannelFinancials(a, scenario.plan, channelStaffing, productiveFte, wpp)
    const payrollHeadcount = endingProductionHc + pipeline.inTraining + pipeline.nesting
    const laborCost = payrollHeadcount * (a.tenured.laborCostPerFteMonthly / WEEKS_PER_MONTH) * wpp
    const hiringCost = pipeline.actualTrainingStart * 800
    const trainingCost = pipeline.actualTrainingStart * a.newHire.trainingCostPerHire
    const leakages = computeLeakages(a, requiredFte, productiveFte, endingProductionHc, serviceLevel, revenue)
    const overtimeCost = leakages.overtime
    const rawTotalCost = laborCost + hiringCost + trainingCost + leakages.total
    const totalCost = Math.min(rawTotalCost, revenue * 0.9)
    const grossMargin = revenue - laborCost
    const profitability = revenue - totalCost
    const costPerFte = endingProductionHc > 0 ? totalCost / endingProductionHc : 0
    const revenuePerEmployee = endingProductionHc > 0 ? revenue / endingProductionHc : 0
    const budgetForPeriod = (a.business.budgetConstraintMonthly / WEEKS_PER_MONTH) * wpp
    const budgetVariance = budgetForPeriod - totalCost

    const stdHrs = a.tenured.standardScheduledHoursPerWeek * wpp
    const scheduledHours = endingProductionHc * stdHrs
    const shrinkageTotalHours = scheduledHours * totalShrinkageRate
    const shrinkageInOfficeHours = shrinkageTotalHours * a.tenured.shrinkageInOfficeShare
    const shrinkageOutOfOfficeHours = shrinkageTotalHours * (1 - a.tenured.shrinkageInOfficeShare)
    const otHours = endingProductionHc * a.tenured.otHoursPerFtePerWeek * wpp
    const vtoHours = endingProductionHc * a.tenured.vtoHoursPerFtePerWeek * wpp
    const payrollHours = payrollHeadcount * stdHrs + otHours - vtoHours

    const actuals = scenario.actualsByPeriod?.[i]
    const actualAttrition = actuals?.attrition ?? attritionPlanned

    periods.push({
      periodIndex: i,
      periodLabel: periodLabel(i, granularity),
      granularity,
      forecastVolume,
      channelStaffing,
      channelFinancials,
      requiredFte,
      beginningProductionHc,
      scheduledFte: endingProductionHc,
      actualTrainingStart: actuals?.actualTrainingStart ?? pipeline.actualTrainingStart,
      trainingHeadcount: pipeline.inTraining,
      nestingHeadcount: pipeline.nesting,
      graduateHc: pipeline.graduates,
      trainingAttritionHc: pipeline.trainingAttrition,
      nestingAttritionHc: pipeline.nestingAttrition,
      totalShrinkageRate,
      coreProductionFte,
      nestingPhoneTimePct: pipeline.nestingPhoneTimePct,
      nestingProductiveFte,
      productiveFte,
      staffingPct,
      availableFte: productiveFte,
      netStaffing,
      headcountOverUnder: headcountOverUnder(productiveFte, requiredFte),
      hiringPlanned,
      hiringActual: actuals?.hiring ?? pipeline.actualTrainingStart,
      attritionPlanned,
      attritionActual: actualAttrition,
      backfillRequired,
      overstaffing,
      understaffing,
      capacityGap,
      occupancy,
      productivity,
      utilization,
      serviceLevel,
      revenue,
      laborCost,
      hiringCost,
      trainingCost,
      overtimeCost,
      totalCost,
      grossMargin,
      profitability,
      costPerFte,
      revenuePerEmployee,
      budgetVariance,
      scheduledHours,
      payrollHours,
      productiveHours,
      shrinkageInOfficeHours,
      shrinkageOutOfOfficeHours,
      otHours,
      vtoHours,
      leakages,
      actuals,
    })

    beginningProductionHc = endingProductionHc
  }

  const recent = periods.slice(-4)
  const productionHc = recent.reduce((s, p) => s + p.scheduledFte, 0) / Math.max(recent.length, 1)
  const productionFte = recent.reduce((s, p) => s + p.productiveFte, 0) / Math.max(recent.length, 1)
  const requiredHc = recent.reduce((s, p) => s + p.requiredFte, 0) / Math.max(recent.length, 1)
  const lastPeriod = periods[periods.length - 1]
  const summary: ExecutiveSummary = {
    workforceFte: productionHc,
    productionFte,
    requiredFte: requiredHc,
    capacityGap: headcountCapacityGap(productionFte, requiredHc),
    overUnderStaffing: headcountOverUnder(productionFte, requiredHc),
    occupancy: recent.reduce((s, p) => s + p.occupancy, 0) / Math.max(recent.length, 1),
    productivity: recent.reduce((s, p) => s + p.productivity, 0) / Math.max(recent.length, 1),
    revenueProjection: periods.reduce((s, p) => s + p.revenue, 0),
    costProjection: periods.reduce((s, p) => s + p.totalCost, 0),
    grossMargin: periods.reduce((s, p) => s + p.grossMargin, 0),
    profitability: periods.reduce((s, p) => s + p.profitability, 0),
    totalLeakage: periods.reduce((s, p) => s + p.leakages.total, 0),
    hiringTotal: periods.reduce((s, p) => s + p.hiringPlanned, 0),
    attritionTotal: periods.reduce((s, p) => s + p.attritionPlanned + p.trainingAttritionHc + p.nestingAttritionHc, 0),
    channelStaffing: lastPeriod?.channelStaffing,
    channelFinancials: lastPeriod?.channelFinancials,
    risks: buildRisks(periods, a),
    recommendedActions: buildActions(periods),
  }

  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    granularity,
    periods,
    summary,
  }
}

function buildRisks(periods: PeriodResult[], a: PlannerAssumptions): string[] {
  const risks: string[] = []
  const avgUnder = periods.reduce((s, p) => s + p.understaffing, 0) / Math.max(periods.length, 1)
  const avgOver = periods.reduce((s, p) => s + p.overstaffing, 0) / Math.max(periods.length, 1)
  const avgSl = periods.reduce((s, p) => s + p.serviceLevel, 0) / Math.max(periods.length, 1)
  if (avgUnder > 5) risks.push('Sustained understaffing may miss SLA and revenue targets.')
  if (avgOver > 8) risks.push('Overstaffing is elevating labor cost and idle-time leakage.')
  if (avgSl < a.business.serviceLevelTarget * 0.95) risks.push('Service level trending below client target.')
  if (a.tenured.attritionRateMonthly > 0.045) risks.push('Attrition above typical BPO range — review retention programs.')
  if (a.newHire.trainingAttritionRate > 0.1 || a.newHire.nestingAttritionRate > 0.06) {
    risks.push('Training pipeline attrition is high — review class readiness and nesting support.')
  }
  if (!risks.length) risks.push('No critical workforce risks detected in the current horizon.')
  return risks
}

function buildActions(periods: PeriodResult[]): string[] {
  const actions: string[] = []
  const last = periods[periods.length - 1]
  if (!last) return ['Define baseline assumptions and run a hiring scenario comparison.']
  if (last.staffingPct != null && last.staffingPct < 0.95) {
    actions.push(`Increase hiring plan by ${Math.ceil(last.backfillRequired)} to recover staffing coverage.`)
  }
  if (last.staffingPct != null && last.staffingPct > 1.05) {
    actions.push('Reduce future hiring or reallocate excess production capacity across queues.')
  }
  if (last.leakages.productivityLoss > last.laborCost * 0.05) {
    actions.push('Launch productivity initiative — AHT and occupancy coaching.')
  }
  if (last.budgetVariance < 0) {
    actions.push('Review overtime and shrinkage drivers to recover budget variance.')
  }
  actions.push('Compare aggressive vs conservative hiring scenarios before committing.')
  return actions.slice(0, 5)
}

export function compareScenarios(results: SimulationResult[]) {
  if (!results.length) return []
  const baseline =
    results.find((r) => r.scenarioName === 'Scenario 1' || r.scenarioName.toLowerCase().includes('baseline')) ??
    results[0]!
  return results.map((r) => ({
    scenarioId: r.scenarioId,
    scenarioName: r.scenarioName,
    staffingDelta: r.summary.workforceFte - baseline.summary.workforceFte,
    revenueDelta: r.summary.revenueProjection - baseline.summary.revenueProjection,
    costDelta: r.summary.costProjection - baseline.summary.costProjection,
    marginDelta: r.summary.grossMargin - baseline.summary.grossMargin,
    profitabilityDelta: r.summary.profitability - baseline.summary.profitability,
    hiringDelta: r.summary.hiringTotal - baseline.summary.hiringTotal,
    capacityGapDelta: r.summary.capacityGap - baseline.summary.capacityGap,
    leakageDelta: r.summary.totalLeakage - baseline.summary.totalLeakage,
  }))
}
