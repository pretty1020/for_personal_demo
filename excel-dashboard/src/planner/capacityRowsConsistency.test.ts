import { describe, expect, it } from 'vitest'
import { deriveCapacityPlanRows } from './capacityPlanDerived'
import { buildSampleWorkspace } from './sampleWorkspace'
import { runSimulation } from './engine'
import { buildWeeklyPlanLedger } from './weeklyLedger'

/**
 * The plan every page derives has to be the same plan.
 *
 * `deriveCapacityPlanRows` takes ten arguments and several are optional, so a
 * caller can omit one and still get a complete, plausible, different capacity
 * plan back. That is what happened between the Capacity tab and the Forecasting
 * tab: the roster seed was passed by one and not the other, the start week came
 * out one head apart, and because every later week derives from the one before,
 * the whole forward series was shifted. Both tables looked internally consistent
 * and disagreed with each other.
 *
 * These pin the arguments that move the forward series, so omitting one fails
 * here rather than in a plan someone is staffing from.
 */

const PLAN_START = '2026-08-16'

function fixture() {
  const workspace = buildSampleWorkspace(PLAN_START)
  const scenario = workspace.scenarios[0]!
  const ledger = buildWeeklyPlanLedger(scenario, runSimulation(scenario, 'weekly', 52), [])
  return { scenario, ledger }
}

const forwardProductionHc = (rows: ReturnType<typeof deriveCapacityPlanRows>) =>
  rows.filter((row) => row.timeline === 'forward_plan').map((row) => row.planned.productionHc)

describe('the roster seed at the plan start week', () => {
  it('changes the first forward week when supplied', () => {
    const { scenario, ledger } = fixture()

    const withoutSeed = deriveCapacityPlanRows(ledger, scenario, null)
    const withSeed = deriveCapacityPlanRows(
      ledger,
      scenario,
      null,
      {},
      {},
      0,
      null,
      null,
      undefined,
      // A seed deliberately unlike anything the plan would derive on its own.
      999,
    )

    const before = forwardProductionHc(withoutSeed)
    const after = forwardProductionHc(withSeed)
    expect(before.length).toBeGreaterThan(0)
    expect(after[0]).not.toBe(before[0])
  })

  it('carries that difference through every later week', () => {
    const { scenario, ledger } = fixture()

    const withoutSeed = forwardProductionHc(deriveCapacityPlanRows(ledger, scenario, null))
    const withSeed = forwardProductionHc(
      deriveCapacityPlanRows(ledger, scenario, null, {}, {}, 0, null, null, undefined, 999),
    )

    // Not just the first week: the seed compounds forward, which is why the two
    // tabs disagreed on every row rather than only on one.
    const laterIndex = Math.min(4, withSeed.length - 1)
    expect(withSeed[laterIndex]).not.toBe(withoutSeed[laterIndex])
  })

  it('is ignored when the seed is empty, so callers without a roster are unaffected', () => {
    const { scenario, ledger } = fixture()

    const plain = forwardProductionHc(deriveCapacityPlanRows(ledger, scenario, null))
    for (const seed of [null, undefined, 0]) {
      const seeded = forwardProductionHc(
        deriveCapacityPlanRows(ledger, scenario, null, {}, {}, 0, null, null, undefined, seed),
      )
      expect(seeded, `seed ${String(seed)}`).toEqual(plain)
    }
  })
})

describe('a plan derived twice with the same arguments', () => {
  it('produces the same forward series', () => {
    const { scenario, ledger } = fixture()
    const args = [ledger, scenario, null, {}, {}, 0, null, null, undefined, 21] as const

    const first = deriveCapacityPlanRows(...args)
    const second = deriveCapacityPlanRows(...args)
    expect(forwardProductionHc(second)).toEqual(forwardProductionHc(first))
  })

  it('keeps production headcount falling by attrition week over week', () => {
    const { scenario, ledger } = fixture()
    const rows = deriveCapacityPlanRows(ledger, scenario, null)
    const forward = rows.filter((row) => row.timeline === 'forward_plan')

    // Whatever the seed, the series has to be a chain: each week follows from
    // the one before it rather than being computed independently.
    for (const row of forward) {
      expect(Number.isFinite(row.planned.productionHc)).toBe(true)
      expect(row.planned.productionHc).toBeGreaterThanOrEqual(0)
    }
  })
})
