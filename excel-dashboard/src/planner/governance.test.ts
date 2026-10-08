import { describe, expect, it } from 'vitest'
import { GOV_SITES, kpiTone, latestReading, needsRecovery } from './governance'

describe('governance scorecard', () => {
  it('sends a second red week to recovery and leaves a single miss as a review', () => {
    const pune = GOV_SITES.find((site) => site.id === 'pune')!
    const tampa = GOV_SITES.find((site) => site.id === 'tampa')!
    const manila = GOV_SITES.find((site) => site.id === 'manila')!
    expect(needsRecovery(pune, 'staffing')).toBe(true)
    expect(kpiTone(latestReading(pune), 'staffing')).toBe('fail')
    expect(needsRecovery(tampa, 'staffing')).toBe(false)
    expect(kpiTone(latestReading(tampa), 'staffing')).toBe('fail')
    expect(needsRecovery(manila, 'forecast')).toBe(false)
    expect(kpiTone(latestReading(manila), 'forecast')).toBe('pass')
  })
})