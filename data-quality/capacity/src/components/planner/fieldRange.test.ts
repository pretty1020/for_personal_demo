import { describe, expect, it } from 'vitest'
import { parsePercentInput } from '../../planner/capacityImportWeek'
import { clampWithNotice, withPercentLabel } from './fieldRange'

describe('parsePercentInput', () => {
  it('reads entries on a strict 0-100 scale', () => {
    expect(parsePercentInput('85')).toBeCloseTo(0.85)
    expect(parsePercentInput('12.5')).toBeCloseTo(0.125)
    expect(parsePercentInput('100')).toBeCloseTo(1)
    expect(parsePercentInput('0')).toBe(0)
  })

  it('treats sub-1 entries as fractions of a percent, not as rates', () => {
    // The previous heuristic flipped scales at 1, so 0.5 became 50%.
    expect(parsePercentInput('0.5')).toBeCloseTo(0.005)
    expect(parsePercentInput('0.25')).toBeCloseTo(0.0025)
  })

  it('returns null for blank and non-numeric input', () => {
    expect(parsePercentInput('')).toBeNull()
    expect(parsePercentInput('   ')).toBeNull()
    expect(parsePercentInput('.')).toBeNull()
    expect(parsePercentInput('-')).toBeNull()
    expect(parsePercentInput('abc')).toBeNull()
  })

  it('does not clamp, so callers can report out-of-range entries', () => {
    expect(parsePercentInput('150')).toBeCloseTo(1.5)
    expect(parsePercentInput('-20')).toBeCloseTo(-0.2)
  })
})

describe('clampWithNotice', () => {
  it('passes an in-range value through without a notice', () => {
    expect(clampWithNotice(0.3, 0, 0.6, true)).toEqual({ value: 0.3, notice: null })
  })

  it('pulls an over-max percent to the limit and names both numbers', () => {
    const result = clampWithNotice(0.8, 0, 0.5, true)
    expect(result.value).toBe(0.5)
    expect(result.notice).toBe('80% is above the maximum of 50%. Set to 50%.')
  })

  it('pulls an under-min percent to the limit', () => {
    const result = clampWithNotice(-0.2, 0, 0.5, true)
    expect(result.value).toBe(0)
    expect(result.notice).toBe('-20% is below the minimum of 0%. Set to 0%.')
  })

  it('describes plain numbers without a percent sign', () => {
    const result = clampWithNotice(99, 1, 52, false)
    expect(result.value).toBe(52)
    expect(result.notice).toBe('99 is above the maximum of 52. Set to 52.')
  })

  it('leaves an open-ended bound alone', () => {
    expect(clampWithNotice(500, undefined, undefined, false)).toEqual({
      value: 500,
      notice: null,
    })
  })
})

describe('withPercentLabel', () => {
  it('marks percent fields', () => {
    expect(withPercentLabel('Training attrition', true)).toBe('Training attrition (%)')
  })

  it('leaves non-percent fields alone', () => {
    expect(withPercentLabel('Training weeks', false)).toBe('Training weeks')
  })

  it('does not double up when the caller already said percent', () => {
    expect(withPercentLabel('Default shrinkage %', true)).toBe('Default shrinkage %')
  })
})
