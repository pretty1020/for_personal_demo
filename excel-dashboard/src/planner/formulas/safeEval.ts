const MAX_TOKENS = 200
const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/
const NUMBER = /^(?:\d+\.?\d*|\.\d+)$/

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'id'; value: string }
  | { kind: 'op'; value: '+' | '-' | '*' | '/' | '(' | ')' | ',' }

const FUNCTIONS = new Set(['min', 'max', 'abs'])

function tokenize(source: string): Token[] | null {
  const tokens: Token[] = []
  let i = 0
  const text = source.trim()
  if (!text) return null
  while (i < text.length) {
    const ch = text[i]!
    if (/\s/.test(ch)) {
      i += 1
      continue
    }
    if ('+-*/(),'.includes(ch)) {
      tokens.push({ kind: 'op', value: ch as '+' | '-' | '*' | '/' | '(' | ')' | ',' })
      i += 1
      continue
    }
    if (/[0-9.]/.test(ch)) {
      let raw = ''
      while (i < text.length && /[0-9.]/.test(text[i]!)) {
        raw += text[i]
        i += 1
      }
      if (!NUMBER.test(raw)) return null
      const value = Number(raw)
      if (!Number.isFinite(value)) return null
      tokens.push({ kind: 'num', value })
      continue
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let raw = ''
      while (i < text.length && /[a-zA-Z0-9_]/.test(text[i]!)) {
        raw += text[i]
        i += 1
      }
      if (!IDENT.test(raw)) return null
      tokens.push({ kind: 'id', value: raw })
      continue
    }
    return null
  }
  return tokens.length && tokens.length <= MAX_TOKENS ? tokens : null
}

class Parser {
  private index = 0
  constructor(
    private readonly tokens: Token[],
    private readonly vars: Record<string, number>,
  ) {}

  parse(): number | null {
    const value = this.expr()
    if (value == null || this.index !== this.tokens.length) return null
    return Number.isFinite(value) ? value : null
  }

  private peek(): Token | undefined {
    return this.tokens[this.index]
  }

  private eat(kind: Token['kind'], value?: string): Token | null {
    const token = this.peek()
    if (!token || token.kind !== kind) return null
    if (value != null && token.value !== value) return null
    this.index += 1
    return token
  }

  private expr(): number | null {
    let left = this.term()
    if (left == null) return null
    while (this.peek()?.kind === 'op' && (this.peek()?.value === '+' || this.peek()?.value === '-')) {
      const op = this.eat('op')
      const right = this.term()
      if (!op || right == null) return null
      left = op.value === '+' ? left + right : left - right
    }
    return left
  }

  private term(): number | null {
    let left = this.unary()
    if (left == null) return null
    while (this.peek()?.kind === 'op' && (this.peek()?.value === '*' || this.peek()?.value === '/')) {
      const op = this.eat('op')
      const right = this.unary()
      if (!op || right == null) return null
      if (op.value === '/') {
        if (right === 0) return null
        left = left / right
      } else {
        left = left * right
      }
    }
    return left
  }

  private unary(): number | null {
    if (this.peek()?.kind === 'op' && this.peek()?.value === '+') {
      this.eat('op')
      return this.unary()
    }
    if (this.peek()?.kind === 'op' && this.peek()?.value === '-') {
      this.eat('op')
      const value = this.unary()
      return value == null ? null : -value
    }
    return this.factor()
  }

  private factor(): number | null {
    const num = this.eat('num')
    if (num && num.kind === 'num') return num.value

    const id = this.eat('id')
    if (id && id.kind === 'id') {
      if (this.peek()?.kind === 'op' && this.peek()?.value === '(') {
        return this.call(id.value)
      }
      if (!Object.prototype.hasOwnProperty.call(this.vars, id.value)) return null
      const value = this.vars[id.value]
      return Number.isFinite(value) ? value : null
    }

    if (this.eat('op', '(')) {
      const inner = this.expr()
      if (inner == null || !this.eat('op', ')')) return null
      return inner
    }
    return null
  }

  private call(name: string): number | null {
    if (!FUNCTIONS.has(name) || !this.eat('op', '(')) return null
    const args: number[] = []
    if (!(this.peek()?.kind === 'op' && this.peek()?.value === ')')) {
      while (true) {
        const arg = this.expr()
        if (arg == null) return null
        args.push(arg)
        if (this.eat('op', ',')) continue
        break
      }
    }
    if (!this.eat('op', ')')) return null
    if (name === 'abs') return args.length === 1 ? Math.abs(args[0]!) : null
    if (name === 'min') return args.length >= 1 ? Math.min(...args) : null
    if (name === 'max') return args.length >= 1 ? Math.max(...args) : null
    return null
  }
}

function sampleVarValue(name: string): number {
  const key = name.toLowerCase()
  if (
    key.includes('pct') ||
    key.includes('rate') ||
    key.includes('shrink') ||
    key.includes('occupancy') ||
    key.includes('absentee') ||
    key.includes('efficiency')
  ) {
    return 0.25
  }
  return 10
}

export function sampleVariables(allowedVars: readonly string[]): Record<string, number> {
  return Object.fromEntries(allowedVars.map((name) => [name, sampleVarValue(name)]))
}

export function validateExpression(expression: string, allowedVars: readonly string[]): string | null {
  const tokens = tokenize(expression)
  if (!tokens) return 'Enter a valid formula using numbers, + − × ÷, parentheses, min, max, or abs.'
  const allowed = new Set(allowedVars)
  for (const token of tokens) {
    if (token.kind !== 'id') continue
    if (FUNCTIONS.has(token.value)) continue
    if (!allowed.has(token.value)) return `Unknown variable “${token.value}”.`
  }
  if (evaluateExpression(expression, sampleVariables(allowedVars)) == null) {
    return 'Formula could not be evaluated. Check parentheses and operators.'
  }
  return null
}

export function evaluateExpression(expression: string, vars: Record<string, number>): number | null {
  try {
    const tokens = tokenize(expression)
    if (!tokens) return null
    return new Parser(tokens, vars).parse()
  } catch {
    return null
  }
}
