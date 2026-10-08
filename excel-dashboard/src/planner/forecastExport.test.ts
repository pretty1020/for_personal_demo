import { describe, expect, it } from 'vitest'
import { buildForecastExport, forecastRowStatus } from './forecastExport'
import { parseHistoricalUpload } from './forecastDataSource'
import type { ForecastRow } from './forecastChartData'

/**
 * An export that disagrees with the screen it came from is worse than none.
 *
 * The builder is handed the same `ForecastRow[]` the chart draws and the data
 * table renders, so the only things it can get wrong are formatting and
 * omission — which is what these cover. The recurring failure in this codebase
 * has been two code paths computing the same quantity separately, so the one
 * thing the export must never do is recompute.
 */

const NL = String.fromCharCode(13) + String.fromCharCode(10)

function row(over: Partial<ForecastRow> = {}): ForecastRow {
  return {
    key: '2026-01-04',
    label: '4 Jan',
    weekday: 'Sun',
    historical: 1000,
    fitted: 990,
    forecast: null,
    lower: null,
    upper: null,
    holiday: null,
    anomaly: null,
    isFuture: false,
    historicalDays: 7,
    fittedDays: 7,
    forecastDays: 0,
    ...over,
  }
}

const lines = (csv: string) => csv.trim().split(NL)
const header = (csv: string) => lines(csv)[0]!.split(',')

describe('the forecast export', () => {
  it('writes one row per row on screen, and no more', () => {
    const rows = [row(), row({ key: '2026-01-11' }), row({ key: '2026-01-18' })]
    const out = buildForecastExport({ label: 'Volume', unit: 'number', grain: 'weekly', rows })
    expect(out.rows).toBe(3)
    expect(lines(out.csv)).toHaveLength(4)
  })

  it('carries the prediction interval, which the table leaves to the chart', () => {
    const out = buildForecastExport({
      label: 'Volume',
      unit: 'number',
      grain: 'weekly',
      rows: [row({ forecast: 1200, lower: 1100, upper: 1300, isFuture: true, historical: null })],
    })
    expect(header(out.csv)).toContain('forecast_low')
    const cells = lines(out.csv)[1]!.split(',')
    expect(cells).toContain('1100')
    expect(cells).toContain('1300')
  })

  it('leaves a missing value empty rather than writing a zero', () => {
    // A blank cell and a measured zero are different claims; a spreadsheet will
    // average them differently.
    const out = buildForecastExport({
      label: 'Volume',
      unit: 'number',
      grain: 'weekly',
      rows: [row({ historical: null, fitted: null, forecast: 1200, isFuture: true })],
    })
    const cells = lines(out.csv)[1]!.split(',')
    expect(cells[1]).toBe('')
    expect(cells[2]).toBe('')
    expect(cells[3]).toBe('1200')
  })

  it('writes numbers rather than the display text', () => {
    // The table shows "305.5 sec" and "5.0%", neither of which sums or charts.
    const seconds = buildForecastExport({
      label: 'AHT',
      unit: 'seconds',
      grain: 'weekly',
      rows: [row({ historical: 305.46 })],
    })
    expect(lines(seconds.csv)[1]).toContain('305.5')
    // The unit belongs in the header, not glued to every value.
    expect(lines(seconds.csv)[1]).not.toContain('sec')

    const percent = buildForecastExport({
      label: 'Absenteeism',
      unit: 'percent',
      grain: 'weekly',
      rows: [row({ historical: 0.05 })],
    })
    expect(lines(percent.csv)[1]).toContain('0.0500')
    expect(lines(percent.csv)[1]).not.toContain('%')
  })

  it('names the unit in the header, since the values carry no suffix', () => {
    const percent = buildForecastExport({
      label: 'Absenteeism',
      unit: 'percent',
      grain: 'weekly',
      rows: [row()],
    })
    expect(header(percent.csv).join(',')).toContain('rate 0-1')

    const plain = buildForecastExport({
      label: 'Volume',
      unit: 'number',
      grain: 'weekly',
      rows: [row()],
    })
    expect(header(plain.csv)).toContain('historical')
  })

  it('adds a weekday column only where rows are days', () => {
    const daily = buildForecastExport({
      label: 'Volume',
      unit: 'number',
      grain: 'daily',
      rows: [row()],
    })
    expect(header(daily.csv)).toContain('weekday')
    expect(header(daily.csv)[0]).toBe('date')

    const weekly = buildForecastExport({
      label: 'Volume',
      unit: 'number',
      grain: 'weekly',
      rows: [row()],
    })
    expect(header(weekly.csv)).not.toContain('weekday')
    expect(header(weekly.csv)[0]).toBe('week')
  })

  it('reports each row the same way the table does', () => {
    // Both read the same function, so this pins that they still do.
    const rows = [
      row({ isFuture: true }),
      row({ holiday: 'New Year' }),
      row({ anomaly: { date: '2026-01-04', reason: 'spike' } as ForecastRow['anomaly'] }),
      row(),
    ]
    const out = buildForecastExport({ label: 'Volume', unit: 'number', grain: 'weekly', rows })
    const statuses = lines(out.csv)
      .slice(1)
      .map((line) => line.split(',').pop())
    expect(statuses).toEqual(rows.map((r) => forecastRowStatus(r)))
    expect(statuses).toEqual(['Forecast', 'Holiday', 'Anomaly', 'Normal'])
  })

  it('quotes a holiday name containing a comma instead of splitting the row', () => {
    const out = buildForecastExport({
      label: 'Volume',
      unit: 'number',
      grain: 'weekly',
      rows: [row({ holiday: 'Christmas, observed' })],
    })
    expect(out.csv).toContain('"Christmas, observed"')
    expect(lines(out.csv)[1]!.split(',')).toHaveLength(9)
  })

  it('names the file for the driver, the grain and the model', () => {
    const out = buildForecastExport({
      label: 'Attrition HC',
      unit: 'number',
      grain: 'daily',
      rows: [row()],
      modelLabel: 'Holt-Winters',
    })
    expect(out.filename).toBe('attrition-hc-forecast-daily-holt-winters.csv')
  })

  it('still names a file when no model is named', () => {
    const out = buildForecastExport({
      label: 'Volume',
      unit: 'number',
      grain: 'weekly',
      rows: [row()],
    })
    expect(out.filename).toBe('volume-forecast-weekly.csv')
  })

  it('produces a header-only file rather than throwing on no rows', () => {
    const out = buildForecastExport({ label: 'Volume', unit: 'number', grain: 'weekly', rows: [] })
    expect(out.rows).toBe(0)
    expect(lines(out.csv)).toHaveLength(1)
  })
})

describe('what the export is not', () => {
  /**
   * Worth stating, because it is the obvious assumption to make about a CSV of
   * plan weeks and values, and it is wrong. The unit is named in the header —
   * `historical (rate 0-1)` — and the uploader looks for a bare `value` column,
   * so an exported file does not feed back in. The upload template is the file
   * for that, and this test exists so nobody rediscovers the difference by
   * having an upload fail.
   */
  it('is not an upload format, and does not pretend to be', async () => {
    const rows = Array.from({ length: 14 }, (_, i) => {
      const date = new Date(Date.UTC(2026, 0, 4))
      date.setUTCDate(date.getUTCDate() + i * 7)
      return row({ key: date.toISOString().slice(0, 10), historical: 0.05 })
    })
    const { csv } = buildForecastExport({
      label: 'Absenteeism',
      unit: 'percent',
      grain: 'weekly',
      rows,
    })
    await expect(
      parseHistoricalUpload(new File([csv], 'export.csv', { type: 'text/csv' })),
    ).rejects.toThrow(/value column/i)
  })

  it('still writes rates as the decimals the template asks for', () => {
    // So a figure means the same thing on the way out as on the way in, even
    // though the file itself is not the vehicle.
    const out = buildForecastExport({
      label: 'Absenteeism',
      unit: 'percent',
      grain: 'weekly',
      rows: [row({ historical: 0.05 })],
    })
    expect(lines(out.csv)[1]!.split(',')[1]).toBe('0.0500')
  })
})
