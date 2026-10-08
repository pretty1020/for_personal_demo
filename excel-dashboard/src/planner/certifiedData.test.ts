import { describe, expect, it } from 'vitest'
import { WORKED_HOURS, hoursAgree } from './certifiedData'

describe('certified worked hours', () => {
  it('certifies a site only when phone and payroll hours are within 1% of workforce hours', () => {
    const bySite = Object.fromEntries(WORKED_HOURS.map((row) => [row.site, hoursAgree(row)]))
    expect(bySite.Manila).toBe(true)
    expect(bySite.Dublin).toBe(true)
    expect(bySite.Hyderabad).toBe(false)
    expect(bySite.Tampa).toBe(false)
  })
})