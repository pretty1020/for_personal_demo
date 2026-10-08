import { describe, expect, it } from 'vitest'
import { cleanSeries, parseSeriesCsv, sampleSeries, scoreSeries, toCleanedCsv, toCsv, type Method, type ScoredPoint } from './anomalyDetection'

describe('anomaly detection', () => {
  it('treats a quiet Saturday as normal and flags a broken weekday', () => {
    const scored = scoreSeries(sampleSeries('daily'), 'daily', 3.5)
    const saturday = scored.find((point) => point.date === '2026-10-03')
    const spike = scored.find((point) => point.date === '2026-09-16')
    const outage = scored.find((point) => point.date === '2026-09-29')
    expect(saturday?.anomaly).toBe(false)
    expect(spike?.anomaly).toBe(true)
    expect(spike?.score).toBeGreaterThan(0)
    expect(outage?.anomaly).toBe(true)
    expect(outage?.score).toBeLessThan(0)
  })

  it('flags a weekly spike and a monthly break, not the seasonal December', () => {
    const weekly = scoreSeries(sampleSeries('weekly'), 'weekly', 3.5)
    expect(weekly.find((point) => point.date === '2026-07-12')?.anomaly).toBe(true)
    expect(weekly.find((point) => point.date === '2026-06-07')?.anomaly).toBe(false)
    const monthly = scoreSeries(sampleSeries('monthly'), 'monthly', 3.5)
    expect(monthly.find((point) => point.date === '2025-03-01')?.anomaly).toBe(true)
    expect(monthly.find((point) => point.date === '2025-12-01')?.anomaly).toBe(false)
    expect(monthly.find((point) => point.date === '2024-12-01')?.anomaly).toBe(false)
  })

  it('keeps the weekend pattern under every method', () => {
    const methods: Method[] = ['rhythm', 'zscore', 'iqr', 'moving']
    methods.forEach((method) => {
      const scored = scoreSeries(sampleSeries('daily'), 'daily', 3.5, method)
      expect(scored.find((point) => point.date === '2026-10-03')?.anomaly, method).toBe(false)
      expect(scored.find((point) => point.date === '2026-09-16')?.anomaly, method).toBe(true)
      expect(scored.find((point) => point.date === '2026-09-29')?.anomaly, method).toBe(true)
      const monthly = scoreSeries(sampleSeries('monthly'), 'monthly', 3.5, method)
      expect(monthly.find((point) => point.date === '2025-03-01')?.anomaly, method).toBe(true)
      expect(monthly.find((point) => point.date === '2025-12-01')?.anomaly, method).toBe(false)
    })
  })

  it('applies a tag when it builds the cleaned series', () => {
    const scored = scoreSeries(sampleSeries('daily'), 'daily', 3.5)
    const outage = scored.find((point) => point.date === '2026-09-29')!
    const cleaned = cleanSeries(scored, { '2026-09-16': 'exclude', '2026-09-29': 'impute' })
    expect(cleaned.find((row) => row.date === '2026-09-16')).toBeUndefined()
    expect(cleaned.find((row) => row.date === '2026-09-29')).toMatchObject({
      value: outage.expected,
      original: outage.value,
      action: 'impute',
    })
    const kept = cleanSeries(scored, { '2026-09-16': 'valid' })
    expect(kept.find((row) => row.date === '2026-09-16')?.value).toBe(9800)
    expect(toCleanedCsv(kept).split('\n')[0]).toBe('date,value,original,action')
  })

  it('bridges an interpolated point between its neighbors', () => {
    const scored: ScoredPoint[] = [
      point('2026-01-01', 100, false),
      point('2026-01-02', 800, true),
      point('2026-01-03', 140, false),
    ]
    const cleaned = cleanSeries(scored, { '2026-01-02': 'interpolate' })
    expect(cleaned.map((row) => row.value)).toEqual([100, 120, 140])
    expect(cleanSeries(scored, { '2026-01-02': 'invalid' })[1]?.value).toBe(100)
  })

  it('reads a date and value template', () => {
    const sample = sampleSeries('daily').slice(0, 3)
    const parsed = parseSeriesCsv(toCsv(sample))
    expect(parsed.error).toBeNull()
    expect(parsed.points).toEqual(sample)
  })
})

function point(date: string, value: number, anomaly: boolean): ScoredPoint {
  return { date, value, expected: 100, low: 80, high: 120, score: anomaly ? 9 : 0, anomaly, reason: '' }
}