import { describe, expect, it } from 'vitest'
import { buildCapacityFinancialPortfolioTotals } from './capacityFinancialPortfolio'
import { buildSampleWorkspace, SAMPLE_LOB_FINANCE, ALL_SAMPLE_LOBS } from './sampleWorkspace'
import { runSimulation } from './engine'
import { buildWeeklyPlanLedger } from './weeklyLedger'

describe('sample workspace financial realism', () => {
  it('seeds bill rates above salary so Capacity portfolio margin is positive', () => {
    for (const lob of ALL_SAMPLE_LOBS) {
      const finance = SAMPLE_LOB_FINANCE[lob.id]!
      expect(finance.billingRate).toBeGreaterThan(finance.hourlySalaryUsd)
      expect(finance.hourlySalaryUsd).toBeGreaterThan(0)
    }
  })

  it('builds Apex and Telco scenarios with revenue above cost', () => {
    const workspace = buildSampleWorkspace('2026-08-16')
    const deps = {
      getScenarioLedger: (scenarioId: string) => {
        const scenario = workspace.scenarios.find((item) => item.id === scenarioId)!
        return buildWeeklyPlanLedger(scenario, runSimulation(scenario, 'weekly', 52), [])
      },
      getScenarioForecast: () => null,
      getScenarioCapacityPlanOverrides: () => ({}),
    }

    for (const clientName of ['Retail', 'Telco']) {
      const scenarios = workspace.scenarios.filter((scenario) => scenario.plan.client === clientName)
      expect(scenarios.length).toBeGreaterThan(0)
      const totals = buildCapacityFinancialPortfolioTotals(scenarios, deps)
      expect(totals.projectedRevenue).toBeGreaterThan(totals.projectedCost)
      expect(totals.projectedGmPct).not.toBeNull()
      expect(totals.projectedGmPct!).toBeGreaterThan(0.05)
      expect(totals.projectedGmPct!).toBeLessThan(0.45)
    }
  })
})
