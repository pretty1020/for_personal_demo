import { describe, expect, it } from 'vitest'
import {
  aggregateDailyToWeekly,
  computeDayOfWeekFactors,
  historyPointsToWeekly,
  parseVolumeHistoryCsv,
  runVolumeForecast,
} from './volumeForecastEngine'
import { pickBestForecastModel, runVolumeForecastModels } from './volumeForecastModels'

describe('volume forecast models', () => {
  it('scores multiple models including Holt-Winters / ARIMA-like / Prophet-like when history is long enough', () => {
    const y = Array.from({ length: 20 }, (_, i) => 1000 + i * 12 + (i % 7 === 0 || i % 7 === 6 ? -180 : 40))
    const models = runVolumeForecastModels(y, 4)
    const ids = new Set(models.map((m) => m.id))
    expect(ids.has('ma')).toBe(true)
    expect(ids.has('trend')).toBe(true)
    expect(ids.has('holt_winters')).toBe(true)
    expect(ids.has('arima')).toBe(true)
    expect(ids.has('prophet')).toBe(true)
    expect(pickBestForecastModel(models)?.id).toBeTruthy()
  })

  it('picks the lowest MAPE as best fit', () => {
    const best = pickBestForecastModel([
      { id: 'a', label: 'A', fitted: [], horizon: [], mae: 10, rmse: 12, mapePct: 18 },
      { id: 'b', label: 'B', fitted: [], horizon: [], mae: 8, rmse: 9, mapePct: 7 },
      { id: 'c', label: 'C', fitted: [], horizon: [], mae: 9, rmse: 11, mapePct: 9 },
    ])
    expect(best?.id).toBe('b')
  })
})

describe('day-of-week and aggregation', () => {
  it('detects weekend lows from daily history', () => {
    const daily = []
    // Two weeks: weekdays ~100, Sat/Sun ~30
    for (let day = 0; day < 14; day++) {
      const d = new Date(Date.UTC(2026, 3, 6 + day, 12)) // Apr 6 2026 = Monday
      const iso = d.toISOString().slice(0, 10)
      const jsDay = new Date(`${iso}T12:00:00`).getDay()
      daily.push({ date: iso, volume: jsDay === 0 || jsDay === 6 ? 30 : 100 })
    }
    const factors = computeDayOfWeekFactors(daily)
    const sat = factors.find((f) => f.label === 'Sat')!
    const mon = factors.find((f) => f.label === 'Mon')!
    expect(sat.avgVolume).toBeLessThan(mon.avgVolume)
  })

  it('aggregates daily rows to weekly Offered Volume', () => {
    const weekly = aggregateDailyToWeekly(
      [
        { date: '2026-04-06', volume: 100 },
        { date: '2026-04-07', volume: 100 },
        { date: '2026-04-08', volume: 100 },
        { date: '2026-04-13', volume: 50 },
      ],
      'monday',
    )
    expect(weekly.length).toBeGreaterThanOrEqual(2)
    expect(weekly[0]!.volume).toBe(300)
  })

  it('parses CSV and converts monthly grain to weekly points', () => {
    const csv = `Month,Volume\n2026-04,4000\n2026-05,4200\n`
    const parsed = parseVolumeHistoryCsv(csv, 'monthly')
    expect(parsed.error).toBe('')
    const { weekly } = historyPointsToWeekly(parsed.points, 'monthly', 'monday')
    expect(weekly.length).toBeGreaterThan(0)
    expect(weekly.reduce((s, w) => s + w.volume, 0)).toBeGreaterThan(7000)
  })
})

describe('runVolumeForecast', () => {
  it('builds future-week Forecast Volume from Offered Volume history', () => {
    const history = Array.from({ length: 8 }, (_, i) => ({
      week: `2026-0${i + 1}-0${(i % 2) + 1}`,
      volume: 900 + i * 25,
      source: 'ledger' as const,
    })).map((row, i) => ({
      ...row,
      week: `2026-02-${String(2 + i * 7).padStart(2, '0')}`,
    }))
    const futureWeeks = ['2026-04-06', '2026-04-13', '2026-04-20']
    const run = runVolumeForecast({ history, futureWeeks })
    expect(run.models.length).toBeGreaterThan(0)
    expect(run.bestModel).toBeTruthy()
    expect(Object.keys(run.forecastByWeek)).toEqual(futureWeeks)
    expect(run.forecastByWeek['2026-04-06']).toBeGreaterThan(0)
  })
})
