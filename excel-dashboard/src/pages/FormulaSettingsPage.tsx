import { useCallback, useMemo, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { ModulePageHeader } from '../components/shell/ModulePageHeader'
import { UnsavedChangesDialog } from '../components/UnsavedChangesDialog'
import { useDemoSession } from '../context/DemoSessionContext'
import { usePlanner } from '../context/PlannerContext'
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard'
import { flushWorkspaceSync } from '../data/workspaceSync'
import { loadClientRegistry } from '../planner/clientRegistry'
import {
  FORMULA_CATALOG,
  FORMULA_GROUP_LABELS,
  getFormulaDefinition,
  type FormulaId,
  type FormulaPageGroup,
} from '../planner/formulas/formulaCatalog'
import {
  assertCanEditFormulas,
  deleteFormulaOverride,
  loadFormulaStore,
  resolveFormulaExpression,
  resolveFormulaSource,
  resolveInheritedFormulaExpression,
  upsertFormulaOverride,
  type FormulaScope,
  type FormulaScopeType,
  type FormulaSource,
} from '../planner/formulas/formulaRegistry'
import { evaluateExpression, sampleVariables, validateExpression } from '../planner/formulas/safeEval'
import { resolvePlanLob, resolvePlanLocation } from '../planner/planIdentity'

const GROUPS: FormulaPageGroup[] = ['revenue', 'capacity', 'financial', 'planning']

const SOURCE_LABEL: Record<FormulaSource, string> = {
  default: 'Built-in default',
  all: 'All-clients override',
  client: 'Client override',
  lob: 'LOB override',
}

const SCOPE_OPTIONS: { value: FormulaScopeType; label: string; hint: string }[] = [
  { value: 'all', label: 'All clients', hint: 'Applies everywhere unless a client or LOB override exists.' },
  { value: 'client', label: 'One client', hint: 'Overrides the all-clients formula for this client.' },
  { value: 'lob', label: 'Client + LOB', hint: 'Most specific. Used only for this line of business.' },
]

const OPERATOR_CHIPS = [
  { token: '+', label: 'Add' },
  { token: '-', label: 'Subtract' },
  { token: '*', label: 'Multiply' },
  { token: '/', label: 'Divide' },
  { token: '(', label: 'Open group' },
  { token: ')', label: 'Close group' },
  { token: 'min(', label: 'Minimum' },
  { token: 'max(', label: 'Maximum' },
  { token: 'abs(', label: 'Absolute' },
] as const

function snapshotDrafts(drafts: Record<FormulaId, string>): string {
  return JSON.stringify(drafts)
}

function draftsForScope(scope: FormulaScope): Record<FormulaId, string> {
  const next = {} as Record<FormulaId, string>
  for (const definition of FORMULA_CATALOG) {
    next[definition.id] = resolveFormulaExpression(definition.id, scope)
  }
  return next
}

function formatPreview(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—'
  if (Math.abs(value) >= 100) return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return String(Math.round(value * 10000) / 10000)
}

function isCustomDraft(id: FormulaId, expression: string): boolean {
  const definition = getFormulaDefinition(id)
  return Boolean(definition && expression.trim() !== definition.defaultExpression.trim())
}

export function FormulaSettingsPage() {
  const { canEditFormulas, user } = useDemoSession()
  const { allScenarios } = usePlanner()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [scopeType, setScopeType] = useState<FormulaScopeType>('all')
  const [clientName, setClientName] = useState('')
  const [siteName, setSiteName] = useState('')
  const [lobName, setLobName] = useState('')
  const [selectedId, setSelectedId] = useState<FormulaId>(FORMULA_CATALOG[0]!.id)
  const [drafts, setDrafts] = useState<Record<FormulaId, string>>(() => draftsForScope({}))
  const [savedSnapshot, setSavedSnapshot] = useState(() => snapshotDrafts(draftsForScope({})))
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const clients = useMemo(() => {
    const names = new Set<string>()
    loadClientRegistry().forEach((item) => {
      if (item.name.trim()) names.add(item.name.trim())
    })
    allScenarios.forEach((scenario) => {
      if (scenario.plan.client.trim()) names.add(scenario.plan.client.trim())
    })
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [allScenarios])

  const sitesForClient = useMemo(() => {
    if (!clientName) return []
    const names = new Set<string>()
    allScenarios.forEach((scenario) => {
      if (scenario.plan.client.trim().toLowerCase() !== clientName.trim().toLowerCase()) return
      const site = resolvePlanLocation(scenario.plan)
      if (site) names.add(site)
    })
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [allScenarios, clientName])

  const lobsForClient = useMemo(() => {
    if (!clientName) return []
    const names = new Set<string>()
    allScenarios.forEach((scenario) => {
      if (scenario.plan.client.trim().toLowerCase() !== clientName.trim().toLowerCase()) return
      if (siteName && resolvePlanLocation(scenario.plan) !== siteName) return
      const lob = resolvePlanLob(scenario.plan)
      if (lob) names.add(lob)
    })
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [allScenarios, clientName, siteName])

  const scope = useMemo<FormulaScope>(() => {
    if (scopeType === 'all') return {}
    if (scopeType === 'client') return { clientName }
    return { clientName, lobName }
  }, [clientName, lobName, scopeType])

  const loadScope = useCallback((nextScope: FormulaScope) => {
    const next = draftsForScope(nextScope)
    setDrafts(next)
    setSavedSnapshot(snapshotDrafts(next))
    setMessage('')
    setError('')
  }, [])

  const dirty = snapshotDrafts(drafts) !== savedSnapshot
  const customCount = FORMULA_CATALOG.filter((item) => isCustomDraft(item.id, drafts[item.id] ?? '')).length
  const { isBlocked: navigationBlocked, proceed: proceedNavigation, cancel: cancelNavigation } =
    useUnsavedChangesGuard({ when: dirty })

  if (!canEditFormulas) {
    return <Navigate to="/workspace" replace />
  }

  const definition = FORMULA_CATALOG.find((item) => item.id === selectedId) ?? FORMULA_CATALOG[0]!
  const expression = drafts[definition.id] ?? definition.defaultExpression
  const allowedVars = definition.variables.map((item) => item.name)
  const sampleVars = sampleVariables(allowedVars)
  const validationError = validateExpression(expression, allowedVars)
  const preview = validationError ? null : evaluateExpression(expression, sampleVars)
  const source = resolveFormulaSource(definition.id, scope)
  const selectedIsCustom = isCustomDraft(definition.id, expression)
  let savedDrafts: Record<FormulaId, string> | null = null
  try {
    savedDrafts = JSON.parse(savedSnapshot) as Record<FormulaId, string>
  } catch {
    savedDrafts = null
  }
  const selectedUnsaved = savedDrafts
    ? (drafts[definition.id] ?? '') !== (savedDrafts[definition.id] ?? '')
    : dirty
  const sourceAtSave = loadFormulaStore().overrides.find(
    (item) =>
      item.formulaId === definition.id &&
      item.scopeType === scopeType &&
      item.clientName.trim().toLowerCase() === (scopeType === 'all' ? '' : clientName.trim().toLowerCase()) &&
      item.lobName.trim().toLowerCase() === (scopeType === 'lob' ? lobName.trim().toLowerCase() : ''),
  )
  const activeScopeHint = SCOPE_OPTIONS.find((item) => item.value === scopeType)?.hint ?? ''

  const changeScopeType = (next: FormulaScopeType) => {
    setScopeType(next)
    if (next === 'all') {
      setClientName('')
      setSiteName('')
      setLobName('')
      loadScope({})
      return
    }
    const nextClient = clientName || clients[0] || ''
    setClientName(nextClient)
    if (next === 'client') {
      setLobName('')
      loadScope({ clientName: nextClient })
      return
    }
    const nextLobs = allScenarios
      .filter((scenario) => scenario.plan.client.trim().toLowerCase() === nextClient.trim().toLowerCase())
      .filter((scenario) => !siteName || resolvePlanLocation(scenario.plan) === siteName)
      .map((scenario) => resolvePlanLob(scenario.plan))
      .filter(Boolean)
    const nextLob = lobName && nextLobs.includes(lobName) ? lobName : nextLobs[0] || ''
    setLobName(nextLob)
    loadScope({ clientName: nextClient, lobName: nextLob })
  }

  const changeClient = (nextClient: string) => {
    setClientName(nextClient)
    setSiteName('')
    if (scopeType === 'client') {
      loadScope({ clientName: nextClient })
      return
    }
    const nextLobs = allScenarios
      .filter((scenario) => scenario.plan.client.trim().toLowerCase() === nextClient.trim().toLowerCase())
      .map((scenario) => resolvePlanLob(scenario.plan))
      .filter(Boolean)
    const nextLob = nextLobs[0] || ''
    setLobName(nextLob)
    loadScope({ clientName: nextClient, lobName: nextLob })
  }

  const changeSite = (nextSite: string) => {
    setSiteName(nextSite)
    if (scopeType !== 'lob') return
    const nextLobs = allScenarios
      .filter((scenario) => scenario.plan.client.trim().toLowerCase() === clientName.trim().toLowerCase())
      .filter((scenario) => !nextSite || resolvePlanLocation(scenario.plan) === nextSite)
      .map((scenario) => resolvePlanLob(scenario.plan))
      .filter(Boolean)
    const nextLob = nextLobs.includes(lobName) ? lobName : nextLobs[0] || ''
    setLobName(nextLob)
    loadScope({ clientName, lobName: nextLob })
  }

  const changeLob = (nextLob: string) => {
    setLobName(nextLob)
    loadScope({ clientName, lobName: nextLob })
  }

  const setExpression = (value: string) => {
    setDrafts((prev) => ({ ...prev, [definition.id]: value }))
    setMessage('')
    setError('')
  }

  const insertToken = (token: string) => {
    const field = textareaRef.current
    const start = field?.selectionStart ?? expression.length
    const end = field?.selectionEnd ?? expression.length
    const next = `${expression.slice(0, start)}${token}${expression.slice(end)}`
    setExpression(next)
    requestAnimationFrame(() => {
      const node = textareaRef.current
      if (!node) return
      node.focus()
      const cursor = start + token.length
      node.setSelectionRange(cursor, cursor)
    })
  }

  const resetSelected = () => {
    setExpression(definition.defaultExpression)
  }

  const saveSetup = (): boolean => {
    setError('')
    try {
      assertCanEditFormulas(user?.accessLevel)
      if (scopeType === 'client' && !clientName.trim()) {
        setError('Select a client.')
        return false
      }
      if (scopeType === 'lob' && (!clientName.trim() || !lobName.trim())) {
        setError('Select a client and LOB.')
        return false
      }
      for (const item of FORMULA_CATALOG) {
        const nextExpression = (drafts[item.id] ?? item.defaultExpression).trim()
        const invalid = validateExpression(
          nextExpression,
          item.variables.map((variable) => variable.name),
        )
        if (invalid) {
          setSelectedId(item.id)
          setError(`${item.label}: ${invalid}`)
          return false
        }
        if (nextExpression === resolveInheritedFormulaExpression(item.id, scopeType, scope)) {
          deleteFormulaOverride(item.id, scopeType, clientName, lobName)
        } else {
          upsertFormulaOverride({
            formulaId: item.id,
            scopeType,
            clientName,
            lobName,
            expression: nextExpression,
            updatedBy: user?.email,
          })
        }
      }
      const next = draftsForScope(scope)
      setDrafts(next)
      setSavedSnapshot(snapshotDrafts(next))
      setMessage(
        `Saved formulas for ${
          scopeType === 'all'
            ? 'all clients'
            : scopeType === 'client'
              ? clientName
              : `${clientName} · ${lobName}`
        }.`,
      )
      void flushWorkspaceSync()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save formulas.')
      return false
    }
  }

  return (
    <div className="formula-settings">
      <ModulePageHeader
        title="Formula settings"
        description="More specific scopes override broader ones."
        actions={
          <Link to="/users" className="formula-settings__header-link">
            User management →
          </Link>
        }
      />

      {message ? <p className="user-mgmt__flash">{message}</p> : null}
      {error ? <p className="user-mgmt__flash user-mgmt__flash--error">{error}</p> : null}

      <details className="formula-settings__guide">
        <summary>User guide and definition of terms</summary>
        <div className="formula-settings__guide-body">
          <section>
            <h3>How to use this page</h3>
            <ol>
              <li>Pick a scope: all clients, one client, or one client + LOB. More specific scopes win.</li>
              <li>Select a calculation. The expression is the only math used for that result.</li>
              <li>Insert variables and operators, then Save. Live preview uses sample numbers, not live plan data.</li>
              <li>
                Reset to default restores the built-in expression for the selected formula in this scope.
              </li>
            </ol>
            <p>
              Revenue Projection can enable more than one bill rate method on a line. Total Revenue is the sum of
              each enabled method’s formula. A rate of 0 contributes 0. The engine never substitutes hourly, monthly,
              per-minute, or per-transaction math for one another, and it never invents hours or volume when those
              inputs are missing. Financial Overview weekly revenue and cost use the same identities, scaled to one
              week, so weeks in a calendar month sum to that month on Revenue Projection.
            </p>
          </section>
          <section>
            <h3>Weekly vs monthly (same hours, same rate)</h3>
            <dl>
              <div>
                <dt>Convert to hours</dt>
                <dd>
                  Hourly rate example $24 always bills hours, never a raw FTE count. Production Hours and FTE
                  billing: billed hours = Production FTE × productive hours, so 19 FTE bills more than 7 FTE.
                  Transactional hourly: billed hours = volume × (AHT ÷ 3600). Revenue = billed hours × $24.
                </dd>
              </div>
              <div>
                <dt>Weekly productive hours</dt>
                <dd>
                  Formula <code>financial.weeklyProductiveHours</code>: 5 network days × login hours × (1 −
                  absenteeism% − in-office shrinkage%). Monthly uses calendar network days (Mon–Fri) instead of 5.
                </dd>
              </div>
              <div>
                <dt>Which month a week belongs to</dt>
                <dd>
                  Count the 7 calendar days of the planning week. The month with more days owns the week. Week of 30
                  Aug (2 days in August, 5 in September) is September. Week of 29 Nov (2 days in November, 5 in
                  December) is December. Extra hours, ± $ factors, discount, and monthly rates for that week use that
                  month’s Revenue Projection column.
                </dd>
              </div>
              <div>
                <dt>Weeks in month</dt>
                <dd>
                  Formula <code>financial.weeksInMonth</code>: network days ÷ 5. Example: 22 network days → 4.4 weeks.
                  Monthly dollar amounts (extra hours, ± $ factors, discount, monthly labor / FTE, monthly bill rate)
                  are divided by this so the weeks add back to the month.
                </dd>
              </div>
              <div>
                <dt>Alignment</dt>
                <dd>
                  FTE hourly: weekly × (network days ÷ 5) = monthly Revenue Projection. Capacity hourly: if that
                  month’s weekly volumes add to monthly capacity, weekly revenues add to monthly Total Revenue. Cost
                  uses the same weekly productive hours (or monthly labor ÷ weeks).
                </dd>
              </div>
            </dl>
          </section>
          <section>
            <h3>Bill rate methods</h3>
            <dl>
              <div>
                <dt>Hourly bill rate</dt>
                <dd>
                  Production Hours and FTE: Production FTE × hourly rate × productive hours (19 FTE bills more than
                  7 FTE). Transactional: Capacity × (AHT ÷ 3600) × hourly rate. Extra hours × hourly rate. Overview
                  weeks use 5 network days so they sum to the month.
                </dd>
              </div>
              <div>
                <dt>Per month bill rate</dt>
                <dd>Entered FTE (FTE billing) or required FTE (capacity path) × monthly rate.</dd>
              </div>
              <div>
                <dt>Per minute bill rate</dt>
                <dd>
                  Capacity × (AHT ÷ 60) × per-minute rate, or FTE × productive hours × 60 × per-minute rate. Missing
                  capacity/AHT or productive hours is 0.
                </dd>
              </div>
              <div>
                <dt>Per chat, per sale or per transaction</dt>
                <dd>
                  Capacity / transactions × unit rate. AHT and hours are not used. This is the unit-price method for
                  chats, sales, tickets, or similar events.
                </dd>
              </div>
            </dl>
          </section>
          <section>
            <h3>Definition of terms</h3>
            <dl>
              <div>
                <dt>Billing type</dt>
                <dd>
                  How the contract is structured: Production Hours, Transactional, or FTE. It selects which drivers
                  (hours vs volume vs heads) feed the bill-rate formulas.
                </dd>
              </div>
              <div>
                <dt>Capacity / transactions</dt>
                <dd>Monthly volume of offered work or billed units (calls, chats, emails, sales, tickets).</dd>
              </div>
              <div>
                <dt>AHT</dt>
                <dd>Average handle time in seconds. Used by hourly and per-minute methods, not by per-transaction.</dd>
              </div>
              <div>
                <dt>Login hours</dt>
                <dd>Paid / logged hours in a network day, before absenteeism and in-office shrinkage.</dd>
              </div>
              <div>
                <dt>Network days</dt>
                <dd>Working days in the calendar month used to build productive hours.</dd>
              </div>
              <div>
                <dt>Absenteeism %</dt>
                <dd>Out-of-office unavailability as a percent of scheduled time.</dd>
              </div>
              <div>
                <dt>In office shrinkage %</dt>
                <dd>Auxiliary time while logged in that is not productive handle time.</dd>
              </div>
              <div>
                <dt>Productive hours</dt>
                <dd>
                  Network days × login hours × (1 − absenteeism − in-office shrinkage). Monthly Revenue Projection uses
                  calendar network days. Financial Overview uses the same formula with 5 network days (
                  <code>financial.weeklyProductiveHours</code>).
                </dd>
              </div>
              <div>
                <dt>Occupancy %</dt>
                <dd>Share of productive hours spent on handle time. Used for required FTE, not for per-transaction revenue.</dd>
              </div>
              <div>
                <dt>Required FTE</dt>
                <dd>Handle hours ÷ productive hours post occupancy. Used by the monthly bill path on capacity billing.</dd>
              </div>
              <div>
                <dt>Extra hours</dt>
                <dd>
                  Additional billed hours at the primary method’s time-based rate. Not converted into chats, sales, or
                  transactions.
                </dd>
              </div>
              <div>
                <dt>Discount or less to revenue</dt>
                <dd>Amount subtracted from Total Revenue after billed methods, extra hours, and ± revenue factors.</dd>
              </div>
              <div>
                <dt>Revenue factor (± %)</dt>
                <dd>
                  Optional named percent factors are summed, then applied to billed revenue. +10 adds 10%; −5
                  removes 5%. Each factor can have a custom name on the Client · LOB.
                </dd>
              </div>
              <div>
                <dt>Revenue adjustment (± $)</dt>
                <dd>
                  Optional named dollar factors are summed after the percent factors. Positive adds; negative
                  subtracts. Give each factor a custom name when you add it.
                </dd>
              </div>
              <div>
                <dt>Cost details for GM</dt>
                <dd>
                  Optional Client · LOB labor and overhead. Blank means $0 cost. Monthly labor / FTE overrides hourly
                  salary when provided. Gross margin = revenue − cost.
                </dd>
              </div>
              <div>
                <dt>Revenue leakage</dt>
                <dd>
                  Overview “Where revenue is being lost” prices actual vs planned gaps at the LOB bill rate: staff
                  shortfall, non-billable shrinkage overrun, extra AHT, extra attrition, and volume shortfall. Each
                  driver is a Financial Overview formula admins can change.
                </dd>
              </div>
              <div>
                <dt>Scope</dt>
                <dd>
                  Where an override applies. LOB beats client, client beats all-clients, all-clients beats the built-in
                  default.
                </dd>
              </div>
            </dl>
          </section>
        </div>
      </details>

      <section className="formula-settings__scope-card" aria-label="Formula scope">
        <div className="formula-settings__scope-copy">
          <p className="formula-settings__kicker">1. Where this applies</p>
          <h3 className="formula-settings__card-title">Formula scope</h3>
          <p className="formula-settings__hint">{activeScopeHint}</p>
        </div>
        <div className="formula-settings__scope-controls">
          <div className="formula-settings__scope-pills" role="tablist" aria-label="Formula scope">
            {SCOPE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={scopeType === option.value}
                className={`formula-settings__scope-pill${scopeType === option.value ? ' is-active' : ''}`}
                onClick={() => changeScopeType(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          {scopeType !== 'all' ? (
            <div className="formula-settings__scope-fields">
              <label className="formula-settings__field">
                <span>Client</span>
                <select
                  className="cap-field__input"
                  value={clientName}
                  onChange={(event) => changeClient(event.target.value)}
                >
                  {clients.length === 0 ? <option value="">No clients yet</option> : null}
                  {clients.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="formula-settings__field">
                <span>Site</span>
                <select
                  className="cap-field__input"
                  value={sitesForClient.includes(siteName) ? siteName : ''}
                  onChange={(event) => changeSite(event.target.value)}
                >
                  <option value="">All sites</option>
                  {sitesForClient.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              {scopeType === 'lob' ? (
                <label className="formula-settings__field">
                  <span>LOB</span>
                  <select
                    className="cap-field__input"
                    value={lobName}
                    onChange={(event) => changeLob(event.target.value)}
                  >
                    {lobsForClient.length === 0 ? <option value="">No LOBs for this client</option> : null}
                    {lobsForClient.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
          ) : null}
          <p className="formula-settings__hint formula-settings__hint--order">
            Used in this order: LOB → client → all clients → built-in default.
          </p>
        </div>
      </section>

      <div className="formula-settings__workspace">
        <nav className="formula-settings__nav" aria-label="Calculations">
          <div className="formula-settings__nav-head">
            <p className="formula-settings__kicker">2. Select a formula</p>
            <h3 className="formula-settings__card-title">Calculations</h3>
            <p className="formula-settings__hint">
              {customCount === 0
                ? 'Click a row to edit it. All formulas currently use the built-in default.'
                : `${customCount} custom formula${customCount === 1 ? '' : 's'} in this scope.`}
            </p>
          </div>
          <label className="formula-settings__mobile-picker">
            <span>Now editing</span>
            <select
              className="cap-field__input"
              value={definition.id}
              onChange={(event) => setSelectedId(event.target.value as FormulaId)}
            >
              {GROUPS.map((group) => (
                <optgroup key={group} label={FORMULA_GROUP_LABELS[group]}>
                  {FORMULA_CATALOG.filter((item) => item.group === group).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                      {isCustomDraft(item.id, drafts[item.id] ?? '') ? ' (custom)' : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          {GROUPS.map((group) => (
            <div key={group} className="formula-settings__group">
              <p className="formula-settings__group-label">{FORMULA_GROUP_LABELS[group]}</p>
              <ul className="formula-settings__items">
                {FORMULA_CATALOG.filter((item) => item.group === group).map((item) => {
                  const active = item.id === definition.id
                  const custom = isCustomDraft(item.id, drafts[item.id] ?? '')
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={`formula-settings__item${active ? ' is-active' : ''}${custom ? ' is-custom' : ''}`}
                        aria-current={active ? 'true' : undefined}
                        onClick={() => setSelectedId(item.id)}
                      >
                        <span className="formula-settings__item-label">{item.label}</span>
                        {custom ? <span className="formula-settings__badge">Custom</span> : null}
                        <span className="formula-settings__item-chevron" aria-hidden>
                          ›
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>

        <section className="formula-settings__editor" aria-label={`Edit ${definition.label}`}>
          <header className="formula-settings__editor-head">
            <div>
              <p className="formula-settings__kicker">3. Edit expression</p>
              <h3 className="formula-settings__card-title">{definition.label}</h3>
              <p className="formula-settings__hint">{definition.description}</p>
            </div>
            <div className="formula-settings__editor-actions">
              <span className={`formula-settings__status${selectedIsCustom ? ' is-custom' : ''}`}>
                {selectedUnsaved ? 'Unsaved edits · ' : ''}
                {SOURCE_LABEL[source.source]}
              </span>
              <button type="button" className="saas-btn saas-btn--secondary" onClick={resetSelected}>
                Reset to default
              </button>
            </div>
          </header>

          {sourceAtSave ? (
            <p className="formula-settings__saved-meta">
              Saved for this scope {new Date(sourceAtSave.updatedAt).toLocaleString()}
              {sourceAtSave.updatedBy ? ` by ${sourceAtSave.updatedBy}` : ''}.
            </p>
          ) : null}

          <div className="formula-settings__insert">
            <p className="formula-settings__insert-label">Click a variable to insert it</p>
            <div className="formula-settings__chips">
              {definition.variables.map((item) => (
                <button
                  key={item.name}
                  type="button"
                  className="formula-settings__chip formula-settings__chip--var"
                  onClick={() => insertToken(item.name)}
                >
                  <code>{item.name}</code>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
            <p className="formula-settings__insert-label">Operators</p>
            <div className="formula-settings__chips">
              {OPERATOR_CHIPS.map((item) => (
                <button
                  key={item.token}
                  type="button"
                  className="formula-settings__chip formula-settings__chip--op"
                  title={item.label}
                  onClick={() => insertToken(item.token)}
                >
                  {item.token}
                </button>
              ))}
            </div>
          </div>

          <label className="formula-settings__field formula-settings__field--block">
            <span>Expression</span>
            <textarea
              ref={textareaRef}
              className={`cap-field__input formula-settings__textarea${validationError ? ' is-invalid' : ''}`}
              rows={5}
              spellCheck={false}
              value={expression}
              onChange={(event) => setExpression(event.target.value)}
              aria-invalid={Boolean(validationError)}
            />
          </label>

          {validationError ? (
            <p className="user-mgmt__flash user-mgmt__flash--error">{validationError}</p>
          ) : (
            <div className="formula-settings__preview">
              <div className="formula-settings__preview-result">
                <p className="formula-settings__insert-label">Live preview</p>
                <p className="formula-settings__preview-value">{formatPreview(preview)}</p>
                <p className="formula-settings__hint">Uses sample values so you can check the formula before saving.</p>
              </div>
              <table className="formula-settings__preview-table">
                <caption>Sample inputs</caption>
                <tbody>
                  {definition.variables.map((item) => (
                    <tr key={item.name}>
                      <th scope="row">
                        <code>{item.name}</code>
                        <span>{item.label}</span>
                      </th>
                      <td>{formatPreview(sampleVars[item.name] ?? null)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="formula-settings__default">
            <p className="formula-settings__insert-label">Built-in default</p>
            <code>{definition.defaultExpression}</code>
          </div>
        </section>
      </div>

      <div className="cap-revproj__save-bar">
        <button type="button" className="saas-btn" onClick={saveSetup} disabled={!dirty}>
          Save Setup
        </button>
        {dirty ? (
          <span className="saas-muted text-sm">Unsaved formula changes for this scope</span>
        ) : (
          <span className="saas-muted text-sm">All formulas in this scope are saved</span>
        )}
      </div>

      {navigationBlocked ? (
        <UnsavedChangesDialog
          title="Save Setup?"
          message="You have unsaved formula changes. Save Setup before leaving this page?"
          saveLabel="Save Setup"
          onSave={() => {
            if (saveSetup()) proceedNavigation()
          }}
          onDiscard={proceedNavigation}
          onCancel={cancelNavigation}
        />
      ) : null}
    </div>
  )
}
