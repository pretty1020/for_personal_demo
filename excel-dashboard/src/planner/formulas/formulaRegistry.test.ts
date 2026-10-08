import { afterEach, describe, expect, it } from 'vitest'
import {
  deleteFormulaOverride,
  evaluateFormulaExact,
  evaluateFormulaOrFallback,
  loadFormulaStore,
  resolveFormulaExpression,
  saveFormulaStore,
  upsertFormulaOverride,
} from './formulaRegistry'

describe('formulaRegistry', () => {
  afterEach(() => {
    saveFormulaStore({ overrides: [] })
  })

  it('resolves LOB over client over all over default', () => {
    upsertFormulaOverride({
      formulaId: 'capacity.paidFte',
      scopeType: 'all',
      expression: 'requiredProductionFte / (1 - shrinkage) * 1',
    })
    upsertFormulaOverride({
      formulaId: 'capacity.paidFte',
      scopeType: 'client',
      clientName: 'Apex Retail',
      expression: 'requiredProductionFte / (1 - shrinkage) * 2',
    })
    upsertFormulaOverride({
      formulaId: 'capacity.paidFte',
      scopeType: 'lob',
      clientName: 'Apex Retail',
      lobName: 'ABC',
      expression: 'requiredProductionFte / (1 - shrinkage) * 3',
    })

    const apexAbc = { clientName: 'Apex Retail', lobName: 'ABC' }
    const apexEfg = { clientName: 'Apex Retail', lobName: 'EFG' }
    const other = { clientName: 'Other', lobName: 'ABC' }

    expect(resolveFormulaExpression('capacity.paidFte', apexAbc)).toContain('* 3')
    expect(resolveFormulaExpression('capacity.paidFte', apexEfg)).toContain('* 2')
    expect(resolveFormulaExpression('capacity.paidFte', other)).toContain('* 1')
  })

  it('falls back when a custom formula is invalid at eval time', () => {
    saveFormulaStore({
      overrides: [
        {
          formulaId: 'capacity.paidFte',
          scopeType: 'all',
          clientName: '',
          lobName: '',
          expression: 'requiredProductionFte / 0',
          updatedAt: new Date().toISOString(),
        },
      ],
    })
    expect(loadFormulaStore().overrides).toHaveLength(1)
    expect(
      evaluateFormulaOrFallback(
        'capacity.paidFte',
        { requiredProductionFte: 10, shrinkage: 0.25 },
        13.333,
      ),
    ).toBeCloseTo(13.333, 3)
  })

  it('evaluateFormulaExact returns 0 instead of a substitute formula', () => {
    expect(evaluateFormulaExact('revproj.grossMargin', { totalRevenue: 100, totalCost: 40 })).toBe(60)
    saveFormulaStore({
      overrides: [
        {
          formulaId: 'revproj.grossMargin',
          scopeType: 'all',
          clientName: '',
          lobName: '',
          expression: 'totalRevenue / 0',
          updatedAt: new Date().toISOString(),
        },
      ],
    })
    expect(evaluateFormulaExact('revproj.grossMargin', { totalRevenue: 100, totalCost: 40 })).toBe(0)
  })

  it('deletes an override', () => {
    upsertFormulaOverride({
      formulaId: 'revproj.grossMargin',
      scopeType: 'all',
      expression: 'totalRevenue - totalCost * 1',
    })
    expect(deleteFormulaOverride('revproj.grossMargin', 'all')).toBe(true)
    expect(resolveFormulaExpression('revproj.grossMargin')).toBe('totalRevenue - totalCost')
  })
})
