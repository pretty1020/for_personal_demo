import { canManageUsers, type AccessLevel } from '../../utils/accessLevel'
import { resolvePlanLob } from '../planIdentity'
import type { PlannerPlanMetadata } from '../types'
import { evaluateExpression, validateExpression } from './safeEval'
import { FORMULA_CATALOG, getFormulaDefinition, type FormulaId } from './formulaCatalog'

export const FORMULA_STORAGE_KEY = 'wfp-formula-registry-v1'

export type FormulaScopeType = 'all' | 'client' | 'lob'

export type FormulaScope = {
  clientName?: string
  lobName?: string
  scenarioId?: string
}

export type FormulaOverride = {
  formulaId: FormulaId
  scopeType: FormulaScopeType
  clientName: string
  lobName: string
  expression: string
  updatedAt: string
  updatedBy?: string
}

export type FormulaStore = {
  overrides: FormulaOverride[]
}

function norm(value: string | undefined | null): string {
  return (value ?? '').trim().toLowerCase()
}

function emptyStore(): FormulaStore {
  return { overrides: [] }
}

let memoryRaw: string | null = null

function readRaw(): string | null {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(FORMULA_STORAGE_KEY)
      if (raw != null) return raw
    }
  } catch {
    /* ignore */
  }
  return memoryRaw
}

function writeRaw(value: string | null): void {
  memoryRaw = value
  try {
    if (typeof localStorage === 'undefined') return
    if (value == null) localStorage.removeItem(FORMULA_STORAGE_KEY)
    else localStorage.setItem(FORMULA_STORAGE_KEY, value)
  } catch {
    /* ignore */
  }
}

export function loadFormulaStore(): FormulaStore {
  try {
    const raw = readRaw()
    if (!raw) return emptyStore()
    const parsed = JSON.parse(raw) as FormulaStore
    if (!parsed || !Array.isArray(parsed.overrides)) return emptyStore()
    const overrides: FormulaOverride[] = parsed.overrides
      .filter((item) => item?.formulaId && typeof item.expression === 'string')
      .map((item) => {
        const scopeType: FormulaScopeType =
          item.scopeType === 'client' || item.scopeType === 'lob' ? item.scopeType : 'all'
        return {
          formulaId: item.formulaId,
          scopeType,
          clientName: String(item.clientName ?? ''),
          lobName: String(item.lobName ?? ''),
          expression: String(item.expression ?? '').trim(),
          updatedAt: item.updatedAt || new Date().toISOString(),
          updatedBy: item.updatedBy,
        }
      })
      .filter((item) => FORMULA_CATALOG.some((def) => def.id === item.formulaId))
    return { overrides }
  } catch {
    return emptyStore()
  }
}

export function saveFormulaStore(store: FormulaStore): void {
  writeRaw(JSON.stringify({ overrides: store.overrides }))
  try {
    window.dispatchEvent(new Event('formula-registry-changed'))
  } catch {
    /* ignore */
  }
}

function overrideMatches(item: FormulaOverride, scope: FormulaScope | undefined): boolean {
  if (item.scopeType === 'all') return true
  if (item.scopeType === 'client') {
    return Boolean(norm(item.clientName) && norm(item.clientName) === norm(scope?.clientName))
  }
  const clientOk = norm(item.clientName) === norm(scope?.clientName)
  const lobOk = norm(item.lobName) === norm(scope?.lobName)
  return clientOk && lobOk && Boolean(norm(item.lobName))
}

function overrideRank(item: FormulaOverride): number {
  if (item.scopeType === 'lob') return 3
  if (item.scopeType === 'client') return 2
  return 1
}

export function resolveFormulaExpression(id: FormulaId, scope?: FormulaScope, store?: FormulaStore): string {
  const definition = getFormulaDefinition(id)
  const fallback = definition?.defaultExpression ?? '0'
  const overrides = (store ?? loadFormulaStore()).overrides.filter((item) => item.formulaId === id)
  const matched = overrides
    .filter((item) => overrideMatches(item, scope))
    .sort((a, b) => overrideRank(b) - overrideRank(a))
  const expression = matched[0]?.expression.trim()
  return expression || fallback
}

export function evaluateFormula(
  id: FormulaId,
  vars: Record<string, number>,
  scope?: FormulaScope,
  fallback?: number,
): number | null {
  const definition = getFormulaDefinition(id)
  if (!definition) return fallback ?? null
  const expression = resolveFormulaExpression(id, scope)
  const result = evaluateExpression(expression, vars)
  if (result == null || !Number.isFinite(result)) return fallback ?? null
  return result
}

export function formulaScopeFromPlan(
  plan?: Pick<PlannerPlanMetadata, 'client' | 'lob' | 'location'> | null,
): FormulaScope {
  if (!plan) return {}
  return { clientName: plan.client, lobName: resolvePlanLob(plan) }
}

export type FormulaSource = FormulaScopeType | 'default'

export function resolveFormulaSource(
  id: FormulaId,
  scope?: FormulaScope,
  store?: FormulaStore,
): { expression: string; source: FormulaSource } {
  const definition = getFormulaDefinition(id)
  const fallback = definition?.defaultExpression ?? '0'
  const matched = (store ?? loadFormulaStore()).overrides
    .filter((item) => item.formulaId === id && overrideMatches(item, scope))
    .sort((a, b) => overrideRank(b) - overrideRank(a))
  const top = matched[0]
  if (!top?.expression.trim()) return { expression: fallback, source: 'default' }
  return { expression: top.expression.trim(), source: top.scopeType }
}

export function resolveInheritedFormulaExpression(
  id: FormulaId,
  scopeType: FormulaScopeType,
  scope?: FormulaScope,
  store?: FormulaStore,
): string {
  const definition = getFormulaDefinition(id)
  const fallback = definition?.defaultExpression ?? '0'
  const clientName = scopeType === 'all' ? '' : (scope?.clientName ?? '')
  const lobName = scopeType === 'lob' ? (scope?.lobName ?? '') : ''
  const matched = (store ?? loadFormulaStore()).overrides
    .filter((item) => item.formulaId === id)
    .filter(
      (item) =>
        !(
          item.scopeType === scopeType &&
          norm(item.clientName) === norm(clientName) &&
          norm(item.lobName) === norm(lobName)
        ),
    )
    .filter((item) => overrideMatches(item, scope))
    .sort((a, b) => overrideRank(b) - overrideRank(a))
  return matched[0]?.expression.trim() || fallback
}

export function evaluateFormulaOrFallback(
  id: FormulaId,
  vars: Record<string, number>,
  fallback: number,
  scope?: FormulaScope,
): number {
  const result = evaluateFormula(id, vars, scope, fallback)
  if (result == null || !Number.isFinite(result)) return fallback
  return result
}

/** Evaluate the catalog/override expression only. Invalid or missing results are 0 — never a substitute formula. */
export function evaluateFormulaExact(
  id: FormulaId,
  vars: Record<string, number>,
  scope?: FormulaScope,
): number {
  const result = evaluateFormula(id, vars, scope)
  if (result == null || !Number.isFinite(result)) return 0
  return result
}

export function isCustomFormula(id: FormulaId, scope?: FormulaScope, store?: FormulaStore): boolean {
  const definition = getFormulaDefinition(id)
  if (!definition) return false
  const expression = resolveFormulaExpression(id, scope, store)
  return expression.trim() !== definition.defaultExpression.trim()
}

export function upsertFormulaOverride(input: {
  formulaId: FormulaId
  scopeType: FormulaScopeType
  clientName?: string
  lobName?: string
  expression: string
  updatedBy?: string
}): FormulaOverride {
  const definition = getFormulaDefinition(input.formulaId)
  if (!definition) throw new Error('Unknown formula.')
  const expression = input.expression.trim()
  const error = validateExpression(expression, definition.variables.map((item) => item.name))
  if (error) throw new Error(error)
  if (input.scopeType === 'client' && !norm(input.clientName)) throw new Error('Select a client.')
  if (input.scopeType === 'lob' && (!norm(input.clientName) || !norm(input.lobName))) {
    throw new Error('Select a client and LOB.')
  }
  const next: FormulaOverride = {
    formulaId: input.formulaId,
    scopeType: input.scopeType,
    clientName: input.scopeType === 'all' ? '' : (input.clientName ?? '').trim(),
    lobName: input.scopeType === 'lob' ? (input.lobName ?? '').trim() : '',
    expression,
    updatedAt: new Date().toISOString(),
    updatedBy: input.updatedBy,
  }
  const store = loadFormulaStore()
  const remaining = store.overrides.filter(
    (item) =>
      !(
        item.formulaId === next.formulaId &&
        item.scopeType === next.scopeType &&
        norm(item.clientName) === norm(next.clientName) &&
        norm(item.lobName) === norm(next.lobName)
      ),
  )
  saveFormulaStore({ overrides: [...remaining, next] })
  return next
}

export function deleteFormulaOverride(
  formulaId: FormulaId,
  scopeType: FormulaScopeType,
  clientName = '',
  lobName = '',
): boolean {
  const store = loadFormulaStore()
  const next = store.overrides.filter(
    (item) =>
      !(
        item.formulaId === formulaId &&
        item.scopeType === scopeType &&
        norm(item.clientName) === norm(clientName) &&
        norm(item.lobName) === norm(lobName)
      ),
  )
  if (next.length === store.overrides.length) return false
  saveFormulaStore({ overrides: next })
  return true
}

export function formulaScopeLabel(item: Pick<FormulaOverride, 'scopeType' | 'clientName' | 'lobName'>): string {
  if (item.scopeType === 'all') return 'All clients'
  if (item.scopeType === 'client') return item.clientName || 'Client'
  return `${item.clientName} · ${item.lobName}`
}

export function assertCanEditFormulas(accessLevel: AccessLevel | null | undefined): void {
  if (!canManageUsers(accessLevel)) {
    throw new Error('Only admins can edit formulas.')
  }
}

export function roundFormula(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
