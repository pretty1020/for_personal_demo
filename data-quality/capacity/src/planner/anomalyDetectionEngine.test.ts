import { describe, expect, it } from 'vitest'
import {
  applyAnomalyActions,
  buildForecastReadiness,
  buildSampleSeriesCsv,
  buildSampleSeriesRows,
  buildSeriesPoints,
  buildUploadTemplateCsv,
  parseSeriesCsvText,
  runAnomalyDetection,
  runQualityChecks,
  type DetectedAnomaly,
  type SeriesPoint,
} from './anomalyDetectionEngine'

function makeSeries(values: number[], start = '2026-01-05'): SeriesPoint[] {
  const startDate = new Date(`${start}T12:00:00`)
  return values.map((value, index) => {
    const d = new Date(startDate)
    d.setDate(startDate.getDate() + index * 7)
    const iso = d.toISOString().slice(0, 10)
    return { timestamp: iso, value, originalValue: value }
  })
}

describe('anomalyDetectionEngine', () => {
  it('parses CSV and builds weekly points', () => {
    const csv = `Week,Volume\n2026-01-05,100\n2026-01-12,110\n2026-01-19,105\n`
    const parsed = parseSeriesCsvText(csv)
    expect(parsed.error).toBe('')
    const built = buildSeriesPoints(parsed.rows, 'Week', 'Volume', 'weekly')
    expect(built.points).toHaveLength(3)
    expect(built.points[1]!.value).toBe(110)
  })

  it('detects a spike with MAD', () => {
    const points = makeSeries([100, 102, 101, 99, 100, 98, 500, 101, 100, 99])
    const anomalies = runAnomalyDetection(points, {
      method: 'mad',
      sensitivity: 0.7,
      frequency: 'weekly',
    })
    expect(anomalies.some((anomaly) => anomaly.type === 'spike' || anomaly.type === 'outlier')).toBe(true)
    expect(anomalies.some((anomaly) => anomaly.value === 500)).toBe(true)
  })

  it('flags insufficient points and flatlines as blocking', () => {
    const short = runQualityChecks(makeSeries([10, 11, 12]), 'weekly')
    expect(short.some((issue) => issue.code === 'INSUFFICIENT_POINTS' && issue.severity === 'blocking')).toBe(
      true,
    )
    const flat = runQualityChecks(makeSeries(Array.from({ length: 12 }, () => 50)), 'weekly')
    expect(flat.some((issue) => issue.code === 'FLATLINE' && issue.severity === 'blocking')).toBe(true)
  })

  it('applies exclude and interpolate actions', () => {
    const points = makeSeries([100, 200, 100])
    const anomalies: DetectedAnomaly[] = [
      {
        id: 'a1',
        timestamp: points[1]!.timestamp,
        value: 200,
        type: 'spike',
        severity: 'high',
        score: 4,
        method: 'zscore',
        action: 'interpolate',
      },
    ]
    const cleaned = applyAnomalyActions(points, anomalies)
    expect(cleaned[1]!.value).toBe(100)
  })

  it('builds blocking readiness when critical anomalies are unresolved', () => {
    const points = makeSeries(Array.from({ length: 12 }, (_, i) => 100 + i))
    const anomalies: DetectedAnomaly[] = [
      {
        id: 'c1',
        timestamp: points[5]!.timestamp,
        value: points[5]!.value,
        type: 'spike',
        severity: 'critical',
        score: 5,
        method: 'mad',
        action: 'keep',
      },
    ]
    const issues = runQualityChecks(points, 'weekly')
    const readiness = buildForecastReadiness(points, anomalies, issues, {
      seriesLabel: 'Test',
      frequency: 'weekly',
    })
    expect(readiness.status).toBe('blocking')
    expect(readiness.unresolvedCriticalAnomalies).toBe(1)
  })

  it('builds upload templates and sample series for each frequency', () => {
    for (const frequency of ['daily', 'weekly', 'monthly'] as const) {
      const template = buildUploadTemplateCsv(frequency)
      expect(template.split(/\r?\n/).length).toBeGreaterThan(2)
      const sample = buildSampleSeriesRows(frequency)
      expect(sample.rows.length).toBeGreaterThan(5)
      expect(sample.columns).toContain('Volume')
      const csv = buildSampleSeriesCsv(frequency)
      expect(csv).toContain('Volume')
    }
  })
})
