import { describe, expect, it, vi } from 'vitest'
import type { VolumeForecastRun } from './volumeForecastEngine'
import {
  aggregateWeeklyForecastToMonthly,
  buildForecastDownloadBundle,
  defaultDayOfWeekFactors,
  disaggregateWeeklyForecastToDaily,
  downloadForecastVolumeCsv,
  downloadVolumeForecastSampleCsv,
} from './volumeForecastExport'

vi.mock('../utils/exportCsv', () => ({
  triggerDownloadCsv: vi.fn(),
}))

function sampleRun(overrides?: Partial<VolumeForecastRun>): VolumeForecastRun {
  return {
    history: [
      { week: '2026-03-02', volume: 1000, source: 'ledger' },
      { week: '2026-03-09', volume: 1050, source: 'ledger' },
      { week: '2026-03-16', volume: 1100, source: 'ledger' },
    ],
    models: [
      {
        id: 'ma',
        label: 'Moving Average',
        fitted: [],
        horizon: [1200, 1200],
        mae: 10,
        rmse: 12,
        mapePct: 5,
      },
    ],
    bestModel: {
      id: 'ma',
      label: 'Moving Average',
      fitted: [],
      horizon: [1200, 1200],
      mae: 10,
      rmse: 12,
      mapePct: 5,
    },
    selectedModelId: 'ma',
    forecastByWeek: {
      '2026-04-06': 700,
      '2026-04-13': 701,
    },
    dayOfWeekFactors: [],
    grain: 'ledger',
    message: 'ok',
    ...overrides,
  }
}

describe('volumeForecastExport', () => {
  it('disaggregates weekly forecast to 7 days that sum exactly to the weekly total', () => {
    const factors = defaultDayOfWeekFactors()
    factors[0]!.share = 0.05
    factors[6]!.share = 0.05
    factors[1]!.share = 0.18
    factors[2]!.share = 0.18
    factors[3]!.share = 0.18
    factors[4]!.share = 0.18
    factors[5]!.share = 0.18

    const daily = disaggregateWeeklyForecastToDaily(
      { '2026-04-06': 1000 },
      factors,
      'monday',
      { modelId: 'ma', modelLabel: 'Moving Average' },
    )
    expect(daily).toHaveLength(7)
    expect(daily.every((row) => row.week === '2026-04-06')).toBe(true)
    expect(daily.reduce((sum, row) => sum + row.forecastVolume, 0)).toBe(1000)
    const sat = daily.find((row) => row.day === 'Sat')!
    const mon = daily.find((row) => row.day === 'Mon')!
    expect(sat.forecastVolume).toBeLessThan(mon.forecastVolume)
  })

  it('uses equal 1/7 shares when DOW factors are missing', () => {
    const daily = disaggregateWeeklyForecastToDaily(
      { '2026-04-06': 700 },
      [],
      'monday',
      { modelId: 'ma', modelLabel: 'MA' },
    )
    expect(daily.reduce((sum, row) => sum + row.forecastVolume, 0)).toBe(700)
    expect(daily.every((row) => row.forecastVolume === 100)).toBe(true)
  })

  it('rolls weekly forecast into monthly totals by week-start month', () => {
    const monthly = aggregateWeeklyForecastToMonthly(
      {
        '2026-03-30': 100,
        '2026-04-06': 200,
        '2026-04-13': 300,
      },
      { modelId: 'ma', modelLabel: 'MA' },
    )
    expect(monthly).toEqual([
      expect.objectContaining({ month: '2026-03', forecastVolume: 100, weekCount: 1 }),
      expect.objectContaining({ month: '2026-04', forecastVolume: 500, weekCount: 2 }),
    ])
  })

  it('builds a full download bundle for the selected model', () => {
    const run = sampleRun({
      dayOfWeekFactors: defaultDayOfWeekFactors(),
    })
    const bundle = buildForecastDownloadBundle(run, 'monday')
    expect(bundle.weekly).toHaveLength(2)
    expect(bundle.daily).toHaveLength(14)
    expect(bundle.monthly.length).toBeGreaterThanOrEqual(1)
    expect(bundle.meta.modelId).toBe('ma')
  })

  it('rejects CSV download when there is no forecast', () => {
    const result = downloadForecastVolumeCsv(
      sampleRun({ forecastByWeek: {} }),
      'weekly',
      'monday',
      'Demo',
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/No forecast values/)
  })

  it('downloads a sample history CSV with daily and weekly examples', async () => {
    const { triggerDownloadCsv } = await import('../utils/exportCsv')
    downloadVolumeForecastSampleCsv()
    expect(triggerDownloadCsv).toHaveBeenCalledTimes(1)
    const [csv, fileBase] = vi.mocked(triggerDownloadCsv).mock.calls[0]!
    expect(fileBase).toBe('VolumeForecast_SampleHistory')
    expect(csv).toContain('daily')
    expect(csv).toContain('weekly')
    expect(csv).toContain('Volume')
  })
})
