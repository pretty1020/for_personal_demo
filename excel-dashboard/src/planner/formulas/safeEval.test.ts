import { describe, expect, it } from 'vitest'
import { evaluateExpression, validateExpression } from './safeEval'

describe('safeEval', () => {
  it('evaluates arithmetic and functions', () => {
    expect(evaluateExpression('2 + 3 * 4', {})).toBe(14)
    expect(evaluateExpression('(2 + 3) * 4', {})).toBe(20)
    expect(evaluateExpression('max(1, 8, 3)', {})).toBe(8)
    expect(evaluateExpression('min(1, 8, 3)', {})).toBe(1)
    expect(evaluateExpression('abs(-5)', {})).toBe(5)
  })

  it('uses named variables', () => {
    expect(evaluateExpression('requiredProductionFte / (1 - shrinkage)', {
      requiredProductionFte: 10,
      shrinkage: 0.25,
    })).toBeCloseTo(13.3333, 3)
  })

  it('rejects division by zero and unknown vars', () => {
    expect(evaluateExpression('1 / 0', {})).toBeNull()
    expect(evaluateExpression('foo + 1', {})).toBeNull()
    expect(evaluateExpression('alert(1)', {})).toBeNull()
  })

  it('validates default paid FTE formula', () => {
    expect(
      validateExpression('requiredProductionFte / (1 - shrinkage)', ['requiredProductionFte', 'shrinkage']),
    ).toBeNull()
  })

  it('rejects unknown identifiers', () => {
    expect(validateExpression('volume * secret', ['volume'])).toMatch(/Unknown variable/)
  })
})
