import { describe, expect, it } from 'vitest'
import type { InteractiveD3Series } from '../../components/charts/InteractiveD3Chart'

/** Mirror of empty-data guard used by InteractiveD3Chart (kept local for unit coverage). */
function hasAnyData(series: InteractiveD3Series[]): boolean {
  return series.some((item) =>
    item.values.some((value) => value != null && Number.isFinite(value)),
  )
}

describe('InteractiveD3Chart edge cases', () => {
  it('treats empty series as no data', () => {
    expect(hasAnyData([])).toBe(false)
    expect(
      hasAnyData([{ id: 'a', label: 'A', color: '#000', type: 'line', values: [null, null] }]),
    ).toBe(false)
  })

  it('accepts a single finite point', () => {
    expect(
      hasAnyData([{ id: 'a', label: 'A', color: '#000', type: 'line', values: [null, 12, null] }]),
    ).toBe(true)
  })

  it('accepts large series with sparse nulls', () => {
    const values = Array.from({ length: 500 }, (_, i) => (i % 17 === 0 ? null : i))
    expect(hasAnyData([{ id: 'a', label: 'A', color: '#000', type: 'area', values }])).toBe(true)
  })
})
