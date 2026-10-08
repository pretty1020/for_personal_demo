import { describe, expect, it } from 'vitest'
import { inferInterval, parseFlexibleDate } from './forecastDataSource'

/**
 * Date parsing for uploaded history.
 *
 * Getting this wrong silently reorders or drops a whole series, and the result
 * still looks like a plausible forecast — so the ambiguous cases are pinned down
 * here rather than left to the platform's Date parser.
 */

describe('parseFlexibleDate', () => {
  it('reads ISO dates', () => {
    expect(parseFlexibleDate('2026-03-09')).toBe('2026-03-09')
    expect(parseFlexibleDate('2026-3-9')).toBe('2026-03-09')
    expect(parseFlexibleDate('2026-03-09T14:30:00Z')).toBe('2026-03-09')
  })

  it('treats slash and dash dates as month-first', () => {
    expect(parseFlexibleDate('03/09/2026')).toBe('2026-03-09')
    expect(parseFlexibleDate('3-9-2026')).toBe('2026-03-09')
  })

  it('resolves ambiguity when the first part cannot be a month', () => {
    // 25 cannot be a month, so this must be 25 March.
    expect(parseFlexibleDate('25/03/2026')).toBe('2026-03-25')
  })

  it('expands two-digit years', () => {
    expect(parseFlexibleDate('03/09/26')).toBe('2026-03-09')
    expect(parseFlexibleDate('03/09/99')).toBe('1999-03-09')
  })

  it('reads month names', () => {
    expect(parseFlexibleDate('Mar 9, 2026')).toBe('2026-03-09')
    expect(parseFlexibleDate('9 Mar 2026')).toBe('2026-03-09')
  })

  it('accepts Date objects, as xlsx returns for date cells', () => {
    expect(parseFlexibleDate(new Date(2026, 2, 9))).toBe('2026-03-09')
  })

  it('rejects impossible dates rather than rolling them over', () => {
    // Plain `new Date(2026, 1, 31)` would silently become 3 March.
    expect(parseFlexibleDate('02/31/2026')).toBeNull()
    expect(parseFlexibleDate('13/45/2026')).toBeNull()
  })

  it('rejects junk and empties', () => {
    expect(parseFlexibleDate('')).toBeNull()
    expect(parseFlexibleDate(null)).toBeNull()
    expect(parseFlexibleDate(undefined)).toBeNull()
    expect(parseFlexibleDate('total')).toBeNull()
    expect(parseFlexibleDate('n/a')).toBeNull()
  })

  it('does not mistake a plain count for a date', () => {
    // A bare 1200 in a date column is bad data, not an Excel serial.
    expect(parseFlexibleDate(1200)).toBeNull()
  })
})

describe('inferInterval', () => {
  const build = (count: number, stepDays: number) => {
    const start = new Date(2026, 0, 4)
    return Array.from({ length: count }, (_, i) => {
      const day = new Date(start)
      day.setDate(day.getDate() + i * stepDays)
      return { date: day.toISOString().slice(0, 10), value: 1 }
    })
  }

  it('detects daily, weekly and monthly spacing', () => {
    expect(inferInterval(build(30, 1))).toBe('daily')
    expect(inferInterval(build(12, 7))).toBe('weekly')
    expect(inferInterval(build(8, 30))).toBe('monthly')
  })

  it('is robust to a few missing days', () => {
    const points = build(30, 1).filter((_, index) => index % 9 !== 0)
    expect(inferInterval(points)).toBe('daily')
  })

  it('defaults to daily when there is too little to judge', () => {
    expect(inferInterval([{ date: '2026-01-04', value: 1 }])).toBe('daily')
  })
})
