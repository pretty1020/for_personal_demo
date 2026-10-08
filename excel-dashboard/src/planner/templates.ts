import { syncBusinessDerivedFields, syncDerivedTenuredFields } from './assumptionDerivation'
import type { PlannerAssumptions, ScenarioTemplate } from './types'

export type ScenarioTemplatePatch = Partial<{
  newHire: Partial<PlannerAssumptions['newHire']>
  tenured: Partial<PlannerAssumptions['tenured']>
  business: Partial<PlannerAssumptions['business']>
}>

function scaleHiringPlan(reference: PlannerAssumptions, multiplier: number) {
  return Math.max(1, Math.round(reference.newHire.hiringPlanPerPeriod * multiplier))
}

function mergeAssumptions(base: PlannerAssumptions, patch: ScenarioTemplatePatch): PlannerAssumptions {
  return {
    newHire: { ...base.newHire, ...patch.newHire },
    tenured: { ...base.tenured, ...patch.tenured },
    business: { ...base.business, ...patch.business },
    channels: { ...base.channels },
  }
}

export function resolveTemplatePatch(
  template: ScenarioTemplate,
  reference: PlannerAssumptions,
  target: PlannerAssumptions,
): ScenarioTemplatePatch {
  return template.patchFromReference
    ? template.patchFromReference(reference, target)
    : template.patch ?? {}
}

export function applyTemplateToAssumptions(
  template: ScenarioTemplate,
  reference: PlannerAssumptions,
  target: PlannerAssumptions,
): PlannerAssumptions {
  const patch = resolveTemplatePatch(template, reference, target)
  let merged = mergeAssumptions(target, patch)
  merged = syncDerivedTenuredFields(syncBusinessDerivedFields(merged))
  return merged
}

export const SCENARIO_TEMPLATES: ScenarioTemplate[] = [
  {
    id: 'aggressive-hiring',
    name: 'Hire faster',
    description: 'Bring on more new staff each week.',
    details:
      'Use when call volume is rising and you need more people on the phones soon. Hiring goes up and new hires reach full productivity faster.',
    patch: {
      newHire: { hiringPlanPerPeriod: 24, classSize: 28, rampCurve: [0.5, 0.65, 0.8, 0.92, 1.0, 1.0] },
    },
  },
  {
    id: 'conservative-hiring',
    name: 'Hire slower',
    description: 'Add fewer people and allow more training time.',
    details:
      'Use when budget is tight or quality needs extra coaching. Fewer hires per week and longer training before agents take live calls.',
    patch: {
      newHire: { hiringPlanPerPeriod: 6, trainingWeeks: 5, nestingWeeks: 3, hiringDelayWeeks: 2 },
    },
  },
  {
    id: 'high-attrition',
    name: 'More people leaving',
    description: 'Test what happens if turnover jumps.',
    details:
      'Simulates staff leaving at a much higher rate. Helps you see how much extra hiring you would need to stay staffed.',
    patchFromReference: (ref) => ({
      tenured: {
        attritionRateMonthly: Math.min(0.12, +(ref.tenured.attritionRateMonthly * 1.75).toFixed(4)),
      },
    }),
  },
  {
    id: 'client-growth-20',
    name: 'Client grows 20%',
    description: 'More calls and revenue expected.',
    details:
      'Raises expected call volume and revenue by 20% and adds hiring to match. Good for a client that is expanding.',
    patchFromReference: (ref) => ({
      business: {
        baseForecastVolume: Math.round(ref.business.baseForecastVolume * 1.2),
        revenueTargetMonthly: Math.round(ref.business.revenueTargetMonthly * 1.2),
        growthRateMonthly: +(ref.business.growthRateMonthly * 1.2).toFixed(4),
      },
      newHire: {
        hiringPlanPerPeriod: scaleHiringPlan(ref, 1.2),
      },
    }),
  },
  {
    id: 'productivity-improvement',
    name: 'Work faster & smarter',
    description: 'Agents handle calls more efficiently.',
    details:
      'Shorter call times, better use of paid hours, and slightly less time lost to breaks. Shows the upside of coaching and better tools.',
    patchFromReference: (ref) => ({
      tenured: {
        productivityFactor: Math.min(1.1, +(ref.tenured.productivityFactor * 1.05).toFixed(3)),
        ahtSeconds: Math.max(60, Math.round(ref.tenured.ahtSeconds * 0.95)),
        occupancyTarget: Math.min(0.99, +(ref.tenured.occupancyTarget * 1.02).toFixed(3)),
        shrinkageRate: Math.max(0.1, +(ref.tenured.shrinkageRate * 0.96).toFixed(3)),
      },
    }),
  },
  {
    id: 'cost-reduction',
    name: 'Tighter budget',
    description: 'Lower spending with less cushion built in.',
    details:
      'Cuts budget limits, reduces overtime assumptions, and trims labor cost. Use when leadership asks for a leaner plan.',
    patchFromReference: (ref) => ({
      business: {
        budgetConstraintMonthly: Math.round(ref.business.budgetConstraintMonthly * 0.88),
        staffingBufferPct: Math.max(0.01, +(ref.business.staffingBufferPct * 0.5).toFixed(3)),
        overtimeMultiplier: Math.max(1.1, +(ref.business.overtimeMultiplier * 0.9).toFixed(2)),
      },
      tenured: {
        laborCostPerFteMonthly: Math.round(ref.tenured.laborCostPerFteMonthly * 0.95),
      },
    }),
  },
]
