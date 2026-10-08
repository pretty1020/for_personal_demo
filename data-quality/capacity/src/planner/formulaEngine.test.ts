import { describe, expect, it } from 'vitest'
import {
  FORMULA_FUNCTION_NAMES,
  checkFormula,
  compileFormula,
  evaluateFormula,
  FormulaError,
} from './formulaEngine'

const VARS = ['volume', 'aht', 'occupancy', 'shrinkage', 'hours', 'fte']

function run(source: string, scope: Record<string, number> = {}): number | null {
  return evaluateFormula(compileFormula(source), scope)
}

describe('arithmetic', () => {
  it('follows normal operator precedence', () => {
    expect(run('2 + 3 * 4')).toBe(14)
    expect(run('(2 + 3) * 4')).toBe(20)
    expect(run('10 - 4 - 3')).toBe(3)
    expect(run('100 / 5 / 2')).toBe(10)
  })

  it('treats ^ as right-associative, the way a spreadsheet does', () => {
    expect(run('2 ^ 3 ^ 2')).toBe(512)
    expect(run('(2 ^ 3) ^ 2')).toBe(64)
  })

  it('applies unary minus', () => {
    expect(run('-5 + 2')).toBe(-3)
    expect(run('-(3 * 2)')).toBe(-6)
    expect(run('--4')).toBe(4)
  })

  it('reads decimals and underscore separators', () => {
    expect(run('0.5 * 8')).toBe(4)
    expect(run('.25 * 4')).toBe(1)
    expect(run('1_000 * 2')).toBe(2000)
  })
})

describe('variables', () => {
  it('reads values from the scope', () => {
    expect(run('volume * aht / 3600', { volume: 1000, aht: 300 })).toBeCloseTo(83.333, 3)
  })

  it('computes a realistic required-FTE expression', () => {
    const scope = { volume: 10000, aht: 300, hours: 40, occupancy: 0.85, shrinkage: 0.3 }
    const result = run('volume * aht / 3600 / hours / occupancy / (1 - shrinkage)', scope)
    expect(result).toBeCloseTo(35.014, 2)
  })

  /**
   * A missing input must not read as zero. Zero is a real, plausible number, so treating
   * an absent variable as zero would produce a confidently wrong plan instead of handing
   * control back to the built-in calculation.
   */
  it('returns null when a variable is missing rather than assuming zero', () => {
    expect(run('volume * 2', {})).toBeNull()
    expect(run('volume * 2', { volume: 0 })).toBe(0)
  })
})

describe('comparisons and conditionals', () => {
  it('evaluates a ternary', () => {
    expect(run('fte > 10 ? 100 : 200', { fte: 20 })).toBe(100)
    expect(run('fte > 10 ? 100 : 200', { fte: 5 })).toBe(200)
  })

  it('nests ternaries', () => {
    const formula = 'fte < 10 ? 1 : fte < 20 ? 2 : 3'
    expect(run(formula, { fte: 5 })).toBe(1)
    expect(run(formula, { fte: 15 })).toBe(2)
    expect(run(formula, { fte: 25 })).toBe(3)
  })

  it('supports and / or / not', () => {
    expect(run('fte > 1 && fte < 10 ? 1 : 0', { fte: 5 })).toBe(1)
    expect(run('fte > 1 && fte < 10 ? 1 : 0', { fte: 50 })).toBe(0)
    expect(run('fte < 1 || fte > 10 ? 1 : 0', { fte: 50 })).toBe(1)
    expect(run('!(fte > 10) ? 1 : 0', { fte: 5 })).toBe(1)
  })

  it('compares with == and !=', () => {
    expect(run('fte == 5 ? 1 : 0', { fte: 5 })).toBe(1)
    expect(run('fte != 5 ? 1 : 0', { fte: 5 })).toBe(0)
  })
})

describe('functions', () => {
  it('evaluates each documented function', () => {
    expect(run('min(3, 1, 2)')).toBe(1)
    expect(run('max(3, 1, 2)')).toBe(3)
    expect(run('abs(-7)')).toBe(7)
    expect(run('round(2.6)')).toBe(3)
    expect(run('floor(2.9)')).toBe(2)
    expect(run('ceil(2.1)')).toBe(3)
    expect(run('sqrt(16)')).toBe(4)
    expect(run('clamp(15, 0, 10)')).toBe(10)
    expect(run('clamp(-5, 0, 10)')).toBe(0)
  })

  it('exposes the function list for the editor', () => {
    expect(FORMULA_FUNCTION_NAMES).toContain('clamp')
    expect(FORMULA_FUNCTION_NAMES).toContain('safediv')
  })

  it('rejects a call with the wrong number of arguments', () => {
    expect(run('abs(1, 2)')).toBeNull()
    expect(run('clamp(1, 2)')).toBeNull()
  })

  it('is case-insensitive about function names', () => {
    expect(run('MIN(4, 2)')).toBe(2)
    expect(run('Round(2.6)')).toBe(3)
  })
})

describe('division by zero', () => {
  it('returns null instead of Infinity', () => {
    expect(run('10 / 0')).toBeNull()
    expect(run('10 % 0')).toBeNull()
  })

  it('returns null when a zero denominator appears mid-expression', () => {
    expect(run('volume / occupancy', { volume: 100, occupancy: 0 })).toBeNull()
  })

  it('safediv makes the intent explicit', () => {
    expect(run('safediv(10, 2)')).toBe(5)
    expect(run('safediv(10, 0)')).toBeNull()
  })
})

describe('rejecting bad input', () => {
  it('refuses an empty formula', () => {
    expect(() => compileFormula('   ')).toThrow(FormulaError)
  })

  it('refuses unbalanced brackets', () => {
    expect(() => compileFormula('(1 + 2')).toThrow(FormulaError)
    expect(() => compileFormula('1 + 2)')).toThrow(FormulaError)
  })

  it('refuses a dangling operator', () => {
    expect(() => compileFormula('1 +')).toThrow(FormulaError)
    expect(() => compileFormula('* 2')).toThrow(FormulaError)
  })

  it('explains a single = instead of failing vaguely', () => {
    expect(() => compileFormula('fte = 5')).toThrow(/Use == to compare/)
  })

  it('refuses a ? with no :', () => {
    expect(() => compileFormula('fte > 1 ? 5')).toThrow(FormulaError)
  })

  it('refuses very long input', () => {
    expect(() => compileFormula('1+'.repeat(1200) + '1')).toThrow(/longer than/)
  })

  it('refuses deeply nested input rather than exhausting the stack', () => {
    const deep = '('.repeat(200) + '1' + ')'.repeat(200)
    expect(() => compileFormula(deep)).toThrow(/nested too deeply/)
  })
})

/**
 * The sandbox is the reason this evaluator exists instead of `new Function`. These inputs
 * are the ones that would matter if an admin account were ever misused.
 */
describe('sandbox', () => {
  const escapes = [
    'constructor',
    'this',
    'globalThis',
    'window',
    'process',
    'require("fs")',
    'fetch("/x")',
    '__proto__',
    'alert(1)',
    'document.cookie',
    'eval("1+1")',
    '[].constructor',
    'toString',
  ]

  it('cannot reach anything outside the formula', () => {
    for (const source of escapes) {
      const checked = checkFormula(source, VARS)
      expect(checked.ok, `${source} should not be accepted`).toBe(false)
    }
  })

  it('treats a stray identifier as an unknown value, never as a global', () => {
    // It parses as a plain variable name, and with nothing in scope it yields nothing.
    expect(run('globalThis', {})).toBeNull()
  })

  it('does not let a property lookup through the tokenizer', () => {
    expect(() => compileFormula('a.b')).toThrow(FormulaError)
  })

  it('rejects string literals, so nothing can be smuggled in as text', () => {
    expect(() => compileFormula('"abc"')).toThrow(FormulaError)
    expect(() => compileFormula("'abc'")).toThrow(FormulaError)
  })

  it('does not mutate the scope it is given', () => {
    const scope = { fte: 5 }
    run('fte * 2', scope)
    expect(scope).toEqual({ fte: 5 })
  })
})

describe('checkFormula', () => {
  it('accepts a formula that only uses known values', () => {
    const checked = checkFormula('volume * aht / 3600', VARS)
    expect(checked.ok).toBe(true)
  })

  it('names the unknown value instead of failing silently', () => {
    const checked = checkFormula('volume * ahtt', VARS)
    expect(checked.ok).toBe(false)
    if (!checked.ok) expect(checked.message).toContain('ahtt')
  })

  it('names an unknown function and lists what is available', () => {
    const checked = checkFormula('median(volume)', VARS)
    expect(checked.ok).toBe(false)
    if (!checked.ok) {
      expect(checked.message).toContain('median')
      expect(checked.message).toContain('clamp')
    }
  })

  it('reports which values a formula depends on', () => {
    const checked = checkFormula('volume * aht / occupancy', VARS)
    expect(checked.ok).toBe(true)
    if (checked.ok) expect(checked.compiled.variables).toEqual(['aht', 'occupancy', 'volume'])
  })

  it('reports the position of a syntax error for the editor', () => {
    const checked = checkFormula('volume * * 2', VARS)
    expect(checked.ok).toBe(false)
    if (!checked.ok) expect(checked.position).toBeGreaterThan(0)
  })
})
