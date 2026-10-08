import { describe, expect, it } from 'vitest'
import { buildUploadTemplate, describeUploadTemplate } from './forecastUploadTemplate'
import { parseHistoricalUpload } from './forecastDataSource'

/**
 * A template that does not parse is worse than no template.
 *
 * The point of shipping one is that the first upload works, so the test that
 * matters is not what the file looks like but that the app's own parser accepts
 * it — filled in, and unchanged from the download.
 */

const weeks = (count: number, start = '2026-01-04') =>
  Array.from({ length: count }, (_, i) => {
    const date = new Date(`${start}T12:00:00Z`)
    date.setUTCDate(date.getUTCDate() + i * 7)
    return date.toISOString().slice(0, 10)
  })

/** Round-trip the template through the uploader, as a browser File would. */
async function parse(csv: string) {
  const file = new File([csv], 'template.csv', { type: 'text/csv' })
  return parseHistoricalUpload(file)
}

describe('the template file', () => {
  it('uses headers the uploader recognises', () => {
    const { csv } = buildUploadTemplate({ label: 'Volume', unit: 'number', weeks: weeks(12) })
    expect(csv.split('\n')[0]).toBe('week,value')
  })

  it('offers one row per plan week', () => {
    const template = buildUploadTemplate({ label: 'Volume', unit: 'number', weeks: weeks(26) })
    expect(template.rows).toBe(26)
    expect(template.csv.trim().split('\n')).toHaveLength(27)
  })

  it('names the file after the driver', () => {
    expect(buildUploadTemplate({ label: 'Attrition HC', unit: 'number', weeks: weeks(12) }).filename).toBe(
      'attrition-hc-history-template.csv',
    )
  })

  it('still offers a year of weeks when the plan has none', () => {
    const template = buildUploadTemplate({ label: 'Volume', unit: 'number', weeks: [] })
    expect(template.rows).toBe(52)
    // Real dates, one week apart, not placeholders.
    const rows = template.csv.trim().split('\n').slice(1)
    const first = new Date(`${rows[0]!.split(',')[0]}T00:00:00Z`).getTime()
    const second = new Date(`${rows[1]!.split(',')[0]}T00:00:00Z`).getTime()
    expect(second - first).toBe(7 * 24 * 3600 * 1000)
  })

  it('fills in the actuals the plan already holds', () => {
    const list = weeks(12)
    const template = buildUploadTemplate({
      label: 'Volume',
      unit: 'number',
      weeks: list,
      valuesByWeek: new Map(list.slice(0, 5).map((week, i) => [week, 5000 + i * 10])),
    })
    expect(template.prefilled).toBe(5)
    expect(template.csv).toContain(`${list[0]},5000`)
    // And leaves the rest for the planner.
    expect(template.csv).toContain(`${list[11]},`)
  })

  it('writes rates as decimals, which is the thing people get wrong', () => {
    const list = weeks(12)
    const template = buildUploadTemplate({
      label: 'Absenteeism',
      unit: 'percent',
      weeks: list,
      valuesByWeek: new Map([[list[0]!, 0.05]]),
    })
    expect(template.csv).toContain(`${list[0]},0.0500`)
    expect(describeUploadTemplate('percent')).toMatch(/0\.05 for 5%/)
  })

  it('writes handle time in seconds', () => {
    const list = weeks(12)
    const template = buildUploadTemplate({
      label: 'AHT',
      unit: 'seconds',
      weeks: list,
      valuesByWeek: new Map([[list[0]!, 305.44]]),
    })
    expect(template.csv).toContain(`${list[0]},305.4`)
  })
})

describe('the uploader accepts what the template produces', () => {
  it('parses a template filled in by hand', async () => {
    const list = weeks(14)
    const { csv } = buildUploadTemplate({ label: 'Volume', unit: 'number', weeks: list })
    const filled = csv
      .trim()
      .split('\n')
      .map((line, i) => (i === 0 ? line : `${line}${5000 + i * 25}`))
      .join('\n')

    const parsed = await parse(filled)
    expect(parsed.points).toHaveLength(14)
    expect(parsed.interval).toBe('weekly')
    expect(parsed.points[0]!.date).toBe(list[0])
  })

  it('parses a template that came prefilled from the plan', async () => {
    const list = weeks(14)
    const { csv } = buildUploadTemplate({
      label: 'Volume',
      unit: 'number',
      weeks: list,
      valuesByWeek: new Map(list.map((week, i) => [week, 5000 + i * 25])),
    })
    const parsed = await parse(csv)
    expect(parsed.points).toHaveLength(14)
    expect(parsed.points[0]!.value).toBe(5000)
  })

  it('parses a rate template without inflating the rates', async () => {
    const list = weeks(14)
    const { csv } = buildUploadTemplate({
      label: 'Absenteeism',
      unit: 'percent',
      weeks: list,
      valuesByWeek: new Map(list.map((week) => [week, 0.062])),
    })
    const parsed = await parse(csv)
    // 0.062 must survive as 0.062, not become 6.2 or 62.
    expect(parsed.points[0]!.value).toBeCloseTo(0.062, 6)
  })

  it('skips rows the planner has not filled in yet', async () => {
    const list = weeks(20)
    const { csv } = buildUploadTemplate({
      label: 'Volume',
      unit: 'number',
      weeks: list,
      // Only the first twelve filled, the rest left blank.
      valuesByWeek: new Map(list.slice(0, 12).map((week, i) => [week, 4000 + i])),
    })
    const parsed = await parse(csv)
    expect(parsed.points).toHaveLength(12)
  })

  it('offers enough rows to clear the uploader minimum', () => {
    const template = buildUploadTemplate({ label: 'Volume', unit: 'number', weeks: weeks(12) })
    expect(template.rows).toBeGreaterThanOrEqual(10)
  })
})
