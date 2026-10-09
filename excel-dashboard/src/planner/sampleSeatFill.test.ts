import { describe, expect, it } from 'vitest'
import { sampleSeatWeek } from './sampleSeatFill'

describe('sample seat fill', () => {
  it('keeps the seat count and reduces onsite headcount by one person each week', () => {
    const past = sampleSeatWeek(26, null)
    const first = sampleSeatWeek(26, 0)
    const next = sampleSeatWeek(26, 1)
    const later = sampleSeatWeek(26, 4)
    expect(past?.onsiteHc).toBe(22)
    expect(first?.onsiteHc).toBe(22)
    expect(next?.onsiteHc).toBe(21)
    expect(later?.onsiteHc).toBe(18)
    expect(past?.seatCount).toBe(first?.seatCount)
    expect(next?.seatCount).toBe(first?.seatCount)
    expect(later?.seatCount).toBe(first?.seatCount)
    expect(past?.wahHc).toBe(4)
    expect(next?.wahHc).toBe(4)
    expect(first?.seatCount).toBeLessThan(first?.demand ?? 0)
    expect(later?.seatCount).toBeGreaterThanOrEqual(later?.demand ?? 0)
  })
})