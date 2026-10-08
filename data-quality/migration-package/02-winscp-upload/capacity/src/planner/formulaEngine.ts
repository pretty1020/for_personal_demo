/**
 * A small, sandboxed expression language for admin-defined formulas.
 *
 * These expressions come from a person and produce the FTE and revenue numbers the whole
 * plan is built on, so the evaluator is a real parser and interpreter — never `eval` or
 * `new Function`. Nothing it runs can reach a browser global, a DOM node, a network call
 * or the surrounding scope: the only things an expression can name are the variables it
 * is handed and the fixed function list below.
 *
 * The other half of the safety story is that failure is always recoverable. A formula
 * that does not parse is rejected before it can be saved, and one that produces a
 * non-finite result at run time falls back to the built-in calculation rather than
 * writing NaN into someone's plan.
 */

export type FormulaValue = number | boolean

export type FormulaScope = Record<string, number>

export type FormulaNode =
  | { kind: 'number'; value: number }
  | { kind: 'variable'; name: string }
  | { kind: 'unary'; op: '-' | '+' | '!'; operand: FormulaNode }
  | { kind: 'binary'; op: BinaryOp; left: FormulaNode; right: FormulaNode }
  | { kind: 'ternary'; test: FormulaNode; whenTrue: FormulaNode; whenFalse: FormulaNode }
  | { kind: 'call'; name: string; args: FormulaNode[] }

type BinaryOp =
  | '+'
  | '-'
  | '*'
  | '/'
  | '%'
  | '^'
  | '<'
  | '<='
  | '>'
  | '>='
  | '=='
  | '!='
  | '&&'
  | '||'

export class FormulaError extends Error {
  /** Character offset the problem was found at, for pointing at it in the editor. */
  position: number

  constructor(message: string, position: number) {
    super(message)
    this.name = 'FormulaError'
    this.position = position
  }
}

/** Guards against a pasted expression that would take meaningful time to parse. */
const MAX_SOURCE_LENGTH = 2000
const MAX_DEPTH = 40

type FunctionDef = {
  /** null means variadic with at least one argument. */
  arity: number | null
  apply: (args: number[]) => number
}

/**
 * The complete function list. Deliberately small and side-effect free — every entry is a
 * pure numeric operation, so no expression can observe or change anything outside itself.
 */
const FUNCTIONS: Record<string, FunctionDef> = {
  min: { arity: null, apply: (args) => Math.min(...args) },
  max: { arity: null, apply: (args) => Math.max(...args) },
  abs: { arity: 1, apply: ([value]) => Math.abs(value!) },
  round: { arity: 1, apply: ([value]) => Math.round(value!) },
  floor: { arity: 1, apply: ([value]) => Math.floor(value!) },
  ceil: { arity: 1, apply: ([value]) => Math.ceil(value!) },
  sqrt: { arity: 1, apply: ([value]) => Math.sqrt(value!) },
  clamp: { arity: 3, apply: ([value, lo, hi]) => Math.min(Math.max(value!, lo!), hi!) },
  // Division that yields the fallback instead of Infinity when the denominator is zero,
  // which is the single most common mistake in a hand-written capacity formula.
  safediv: { arity: 2, apply: ([a, b]) => (b === 0 ? Number.NaN : a! / b!) },
}

export const FORMULA_FUNCTION_NAMES = Object.keys(FUNCTIONS).sort()

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type Token =
  | { type: 'number'; value: number; pos: number }
  | { type: 'identifier'; value: string; pos: number }
  | { type: 'operator'; value: string; pos: number }
  | { type: 'paren'; value: '(' | ')'; pos: number }
  | { type: 'comma'; pos: number }
  | { type: 'end'; pos: number }

type OperatorToken = Extract<Token, { type: 'operator' }>

const TWO_CHAR_OPERATORS = ['<=', '>=', '==', '!=', '&&', '||']
const ONE_CHAR_OPERATORS = ['+', '-', '*', '/', '%', '^', '<', '>', '!', '?', ':']

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let index = 0

  while (index < source.length) {
    const char = source[index]!

    if (/\s/.test(char)) {
      index += 1
      continue
    }

    if (char === '(' || char === ')') {
      tokens.push({ type: 'paren', value: char, pos: index })
      index += 1
      continue
    }

    if (char === ',') {
      tokens.push({ type: 'comma', pos: index })
      index += 1
      continue
    }

    if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(source[index + 1] ?? ''))) {
      const start = index
      while (index < source.length && /[0-9._]/.test(source[index]!)) index += 1
      const raw = source.slice(start, index).replace(/_/g, '')
      const value = Number(raw)
      if (!Number.isFinite(value)) {
        throw new FormulaError(`"${raw}" is not a valid number.`, start)
      }
      tokens.push({ type: 'number', value, pos: start })
      continue
    }

    if (/[A-Za-z_]/.test(char)) {
      const start = index
      while (index < source.length && /[A-Za-z0-9_]/.test(source[index]!)) index += 1
      tokens.push({ type: 'identifier', value: source.slice(start, index), pos: start })
      continue
    }

    const two = source.slice(index, index + 2)
    if (TWO_CHAR_OPERATORS.includes(two)) {
      tokens.push({ type: 'operator', value: two, pos: index })
      index += 2
      continue
    }

    if (ONE_CHAR_OPERATORS.includes(char)) {
      tokens.push({ type: 'operator', value: char, pos: index })
      index += 1
      continue
    }

    // A lone '=' is almost always a typo for '=='; say so rather than "cannot be used".
    if (char === '=') {
      throw new FormulaError('Use == to compare two values.', index)
    }

    throw new FormulaError(`"${char}" cannot be used in a formula.`, index)
  }

  tokens.push({ type: 'end', pos: source.length })
  return tokens
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

class Parser {
  private tokens: Token[]
  private index = 0
  private depth = 0

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  private peek(): Token {
    return this.tokens[this.index]!
  }

  private next(): Token {
    return this.tokens[this.index++]!
  }

  private matchOperator(...values: string[]): OperatorToken | null {
    const token = this.peek()
    if (token.type === 'operator' && values.includes(token.value)) {
      this.index += 1
      return token
    }
    return null
  }

  private enter(): void {
    this.depth += 1
    if (this.depth > MAX_DEPTH) {
      throw new FormulaError('This formula is nested too deeply.', this.peek().pos)
    }
  }

  private exit(): void {
    this.depth -= 1
  }

  parse(): FormulaNode {
    const node = this.parseTernary()
    const token = this.peek()
    if (token.type !== 'end') {
      throw new FormulaError('Unexpected text after the end of the formula.', token.pos)
    }
    return node
  }

  private parseTernary(): FormulaNode {
    this.enter()
    try {
      const test = this.parseBinary(0)
      if (!this.matchOperator('?')) return test

      const whenTrue = this.parseTernary()
      if (!this.matchOperator(':')) {
        throw new FormulaError('A "?" needs a matching ":".', this.peek().pos)
      }
      const whenFalse = this.parseTernary()
      return { kind: 'ternary', test, whenTrue, whenFalse }
    } finally {
      this.exit()
    }
  }

  /** Precedence climbing: lowest binding power first. */
  private static readonly PRECEDENCE: BinaryOp[][] = [
    ['||'],
    ['&&'],
    ['==', '!='],
    ['<', '<=', '>', '>='],
    ['+', '-'],
    ['*', '/', '%'],
  ]

  private parseBinary(level: number): FormulaNode {
    if (level >= Parser.PRECEDENCE.length) return this.parseUnary()

    this.enter()
    try {
      let left = this.parseBinary(level + 1)
      for (;;) {
        const token = this.matchOperator(...Parser.PRECEDENCE[level]!)
        if (!token) return left
        const right = this.parseBinary(level + 1)
        left = { kind: 'binary', op: token.value as BinaryOp, left, right }
      }
    } finally {
      this.exit()
    }
  }

  private parseUnary(): FormulaNode {
    const token = this.matchOperator('-', '+', '!')
    if (token) {
      return { kind: 'unary', op: token.value as '-' | '+' | '!', operand: this.parseUnary() }
    }
    return this.parsePower()
  }

  /** Right-associative, so 2^3^2 is 2^(3^2) as in a spreadsheet. */
  private parsePower(): FormulaNode {
    const base = this.parsePrimary()
    if (this.matchOperator('^')) {
      return { kind: 'binary', op: '^', left: base, right: this.parseUnary() }
    }
    return base
  }

  private parsePrimary(): FormulaNode {
    const token = this.next()

    if (token.type === 'number') return { kind: 'number', value: token.value }

    if (token.type === 'paren' && token.value === '(') {
      this.enter()
      try {
        const inner = this.parseTernary()
        const closing = this.next()
        if (closing.type !== 'paren' || closing.value !== ')') {
          throw new FormulaError('Missing a closing bracket.', closing.pos)
        }
        return inner
      } finally {
        this.exit()
      }
    }

    if (token.type === 'identifier') {
      const nextToken = this.peek()
      if (nextToken.type === 'paren' && nextToken.value === '(') {
        this.index += 1
        const args: FormulaNode[] = []
        const atClosingParen = () => {
          const token = this.peek()
          return token.type === 'paren' && token.value === ')'
        }
        if (!atClosingParen()) {
          for (;;) {
            args.push(this.parseTernary())
            if (this.peek().type === 'comma') {
              this.index += 1
              continue
            }
            break
          }
        }
        const closing = this.next()
        if (closing.type !== 'paren' || closing.value !== ')') {
          throw new FormulaError(`Missing a closing bracket after ${token.value}(.`, closing.pos)
        }
        return { kind: 'call', name: token.value.toLowerCase(), args }
      }
      return { kind: 'variable', name: token.value }
    }

    throw new FormulaError('The formula is incomplete.', token.pos)
  }
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export type CompiledFormula = {
  source: string
  ast: FormulaNode
  /** Variable names the expression reads, for showing what it depends on. */
  variables: string[]
}

/** Parses and returns a reusable form. Throws FormulaError when the text is not valid. */
export function compileFormula(source: string): CompiledFormula {
  const text = source.trim()
  if (!text) throw new FormulaError('Enter a formula.', 0)
  if (text.length > MAX_SOURCE_LENGTH) {
    throw new FormulaError(`A formula cannot be longer than ${MAX_SOURCE_LENGTH} characters.`, 0)
  }

  const ast = new Parser(tokenize(text)).parse()
  return { source: text, ast, variables: collectVariables(ast) }
}

function collectVariables(node: FormulaNode, found = new Set<string>()): string[] {
  switch (node.kind) {
    case 'variable':
      found.add(node.name)
      break
    case 'unary':
      collectVariables(node.operand, found)
      break
    case 'binary':
      collectVariables(node.left, found)
      collectVariables(node.right, found)
      break
    case 'ternary':
      collectVariables(node.test, found)
      collectVariables(node.whenTrue, found)
      collectVariables(node.whenFalse, found)
      break
    case 'call':
      for (const arg of node.args) collectVariables(arg, found)
      break
    default:
      break
  }
  return [...found].sort()
}

export type FormulaCheck =
  | { ok: true; compiled: CompiledFormula }
  | { ok: false; message: string; position: number }

/**
 * Compile and confirm the expression only reads variables that will actually exist.
 *
 * Checking names up front is what turns a typo into a message at save time rather than a
 * silently wrong number in every plan — an unknown variable would otherwise evaluate to
 * nothing and quietly poison the result.
 */
export function checkFormula(source: string, allowedVariables: readonly string[]): FormulaCheck {
  let compiled: CompiledFormula
  try {
    compiled = compileFormula(source)
  } catch (error) {
    if (error instanceof FormulaError) {
      return { ok: false, message: error.message, position: error.position }
    }
    return { ok: false, message: 'That formula could not be read.', position: 0 }
  }

  const allowed = new Set(allowedVariables)
  const unknown = compiled.variables.filter((name) => !allowed.has(name))
  if (unknown.length) {
    return {
      ok: false,
      message: `Unknown ${unknown.length === 1 ? 'value' : 'values'}: ${unknown.join(', ')}. Pick from the list of available values.`,
      position: 0,
    }
  }

  const unknownCalls = collectCalls(compiled.ast).filter((name) => !(name in FUNCTIONS))
  if (unknownCalls.length) {
    return {
      ok: false,
      message: `Unknown ${unknownCalls.length === 1 ? 'function' : 'functions'}: ${unknownCalls.join(', ')}. Available: ${FORMULA_FUNCTION_NAMES.join(', ')}.`,
      position: 0,
    }
  }

  return { ok: true, compiled }
}

function collectCalls(node: FormulaNode, found = new Set<string>()): string[] {
  switch (node.kind) {
    case 'call':
      found.add(node.name)
      for (const arg of node.args) collectCalls(arg, found)
      break
    case 'unary':
      collectCalls(node.operand, found)
      break
    case 'binary':
      collectCalls(node.left, found)
      collectCalls(node.right, found)
      break
    case 'ternary':
      collectCalls(node.test, found)
      collectCalls(node.whenTrue, found)
      collectCalls(node.whenFalse, found)
      break
    default:
      break
  }
  return [...found]
}

function toNumber(value: FormulaValue): number {
  return typeof value === 'boolean' ? (value ? 1 : 0) : value
}

function toBoolean(value: FormulaValue): boolean {
  return typeof value === 'boolean' ? value : value !== 0
}

function evaluateNode(node: FormulaNode, scope: FormulaScope): FormulaValue {
  switch (node.kind) {
    case 'number':
      return node.value

    case 'variable': {
      const value = scope[node.name]
      // An absent variable is a missing input, not a zero: returning 0 here would report
      // a confidently wrong number instead of falling back to the built-in calculation.
      return value === undefined ? Number.NaN : value
    }

    case 'unary': {
      const operand = evaluateNode(node.operand, scope)
      if (node.op === '!') return !toBoolean(operand)
      const numeric = toNumber(operand)
      return node.op === '-' ? -numeric : numeric
    }

    case 'ternary':
      return toBoolean(evaluateNode(node.test, scope))
        ? evaluateNode(node.whenTrue, scope)
        : evaluateNode(node.whenFalse, scope)

    case 'binary': {
      if (node.op === '&&') {
        return toBoolean(evaluateNode(node.left, scope))
          ? toBoolean(evaluateNode(node.right, scope))
          : false
      }
      if (node.op === '||') {
        return toBoolean(evaluateNode(node.left, scope))
          ? true
          : toBoolean(evaluateNode(node.right, scope))
      }

      const left = toNumber(evaluateNode(node.left, scope))
      const right = toNumber(evaluateNode(node.right, scope))

      switch (node.op) {
        case '+':
          return left + right
        case '-':
          return left - right
        case '*':
          return left * right
        case '/':
          return right === 0 ? Number.NaN : left / right
        case '%':
          return right === 0 ? Number.NaN : left % right
        case '^':
          return left ** right
        case '<':
          return left < right
        case '<=':
          return left <= right
        case '>':
          return left > right
        case '>=':
          return left >= right
        case '==':
          return left === right
        case '!=':
          return left !== right
        default:
          return Number.NaN
      }
    }

    case 'call': {
      const def = FUNCTIONS[node.name]
      if (!def) return Number.NaN
      if (def.arity !== null && node.args.length !== def.arity) return Number.NaN
      if (def.arity === null && node.args.length === 0) return Number.NaN
      const args = node.args.map((arg) => toNumber(evaluateNode(arg, scope)))
      if (args.some((value) => !Number.isFinite(value))) return Number.NaN
      return def.apply(args)
    }

    default:
      return Number.NaN
  }
}

/**
 * Run a compiled formula. Returns null rather than throwing when the result is not a
 * usable number, which is the signal for the caller to use the built-in calculation.
 */
export function evaluateFormula(
  compiled: CompiledFormula,
  scope: FormulaScope,
): number | null {
  try {
    const value = toNumber(evaluateNode(compiled.ast, scope))
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}
