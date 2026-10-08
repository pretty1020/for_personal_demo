import { useMemo, useRef, useState, type ReactNode } from 'react'
import * as XLSX from 'xlsx'
import { ScenarioPicker } from '../../components/planner/ScenarioPicker'
import { usePlanner } from '../../context/PlannerContext'
import { fmtNum, fmtPct } from '../../planner/format'
import {
  actualsTemplateRows,
  normalizeImportedActualOverrides,
  summarizeWeeklyLedgerRows,
  type WeeklyLedgerRow,
  type WeeklyLedgerView,
} from '../../planner/weeklyLedger'

type MetricRow = {
  id: string
  label: string
  value: (row: WeeklyLedgerRow) => number | null
  format: (value: number | null | undefined) => string
}

const LEDGER_SECTIONS: Array<{
  id: string
  title: string
  rows: MetricRow[]
}> = [
  {
    id: 'workforce',
    title: 'Workforce',
    rows: [
      { id: 'planned-prod-hc', label: 'Planned production HC', value: (row) => row.planned.productionHc, format: (v) => fmtNum(v, 1) },
      { id: 'actual-prod-hc', label: 'Actual production HC', value: (row) => row.actual?.productionHc ?? null, format: (v) => fmtNum(v, 1) },
      { id: 'planned-staffing', label: 'Planned staffing %', value: (row) => row.planned.staffingPct, format: (v) => fmtPct(v) },
      { id: 'actual-staffing', label: 'Actual staffing %', value: (row) => row.actual?.staffingPct ?? null, format: (v) => fmtPct(v) },
    ],
  },
  {
    id: 'volume',
    title: 'Volume',
    rows: [
      { id: 'planned-volume', label: 'Planned volume', value: (row) => row.planned.callVolume, format: (v) => fmtNum(v, 0) },
      { id: 'actual-volume', label: 'Actual volume', value: (row) => row.actual?.callVolume ?? null, format: (v) => fmtNum(v, 0) },
      {
        id: 'volume-variance',
        label: 'Volume variance (Act - Pl)',
        value: (row) => {
          if (row.actual?.callVolume == null || row.planned.callVolume == null) return null
          return row.actual.callVolume - row.planned.callVolume
        },
        format: (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${fmtNum(v, 0)}`),
      },
    ],
  },
  {
    id: 'fte',
    title: 'FTE',
    rows: [
      { id: 'planned-fte', label: 'Planned production FTE', value: (row) => row.planned.productionFte, format: (v) => fmtNum(v, 1) },
      { id: 'actual-fte', label: 'Actual production FTE', value: (row) => row.actual?.productionFte ?? null, format: (v) => fmtNum(v, 1) },
      {
        id: 'fte-variance',
        label: 'Production FTE variance (Act - Pl)',
        value: (row) => {
          if (row.actual?.productionFte == null || row.planned.productionFte == null) return null
          return row.actual.productionFte - row.planned.productionFte
        },
        format: (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${fmtNum(v, 1)}`),
      },
    ],
  },
  {
    id: 'shrinkage',
    title: 'Shrinkage',
    rows: [
      { id: 'planned-total-shrink', label: 'Planned total shrinkage', value: (row) => row.planned.totalShrinkagePct, format: (v) => fmtPct(v) },
      { id: 'actual-total-shrink', label: 'Actual total shrinkage', value: (row) => row.actual?.totalShrinkagePct ?? null, format: (v) => fmtPct(v) },
      {
        id: 'planned-ooo',
        label: 'Planned out of office shrinkage',
        value: (row) => row.shrinkage.filter((item) => item.group === 'out_of_office').reduce((sum, item) => sum + item.plannedPct, 0),
        format: (v) => fmtPct(v),
      },
      {
        id: 'actual-ooo',
        label: 'Actual out of office shrinkage',
        value: (row) => row.shrinkage.filter((item) => item.group === 'out_of_office').reduce((sum, item) => sum + (item.actualPct ?? 0), 0),
        format: (v) => fmtPct(v),
      },
      {
        id: 'planned-inoffice',
        label: 'Planned in office shrinkage',
        value: (row) => row.shrinkage.filter((item) => item.group === 'in_office').reduce((sum, item) => sum + item.plannedPct, 0),
        format: (v) => fmtPct(v),
      },
      {
        id: 'actual-inoffice',
        label: 'Actual in office shrinkage',
        value: (row) => row.shrinkage.filter((item) => item.group === 'in_office').reduce((sum, item) => sum + (item.actualPct ?? 0), 0),
        format: (v) => fmtPct(v),
      },
    ],
  },
]

export function WeeklyPlanLedgerPage() {
  const { activeScenario, scenarios, getScenarioLedger, importActualOverrides } = usePlanner()
  const [viewId, setViewId] = useState(activeScenario?.id ?? '')
  const [view, setView] = useState<WeeklyLedgerView>('weekly')
  const [importMessage, setImportMessage] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>(
    Object.fromEntries(LEDGER_SECTIONS.map((section) => [section.id, true])),
  )
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const scenarioId = viewId || activeScenario?.id || ''
  const ledger = useMemo(() => (scenarioId ? getScenarioLedger(scenarioId) : []), [getScenarioLedger, scenarioId])
  const rows = useMemo(() => summarizeWeeklyLedgerRows(ledger, view).slice(0, 12), [ledger, view])
  const selectedScenario = scenarios.find((scenario) => scenario.id === scenarioId) ?? activeScenario ?? null
  const importedCount = ledger.filter((row) => row.overrideSource === 'import').length
  const allExpanded = LEDGER_SECTIONS.every((section) => expanded[section.id])

  const downloadTemplate = () => {
    const workbook = XLSX.utils.book_new()
    const sheet = XLSX.utils.json_to_sheet(actualsTemplateRows(selectedScenario?.plan.weekStart ?? 'sunday'))
    XLSX.utils.book_append_sheet(workbook, sheet, 'Actual_Overrides')
    XLSX.writeFile(workbook, 'Capacity_Actual_Overrides_Template.xlsx')
  }

  const importFile = async (file: File) => {
    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: 'array' })
    const firstSheet = workbook.SheetNames[0]
    if (!firstSheet) {
      setImportMessage('No worksheet found in the uploaded file.')
      return
    }
    const sheet = workbook.Sheets[firstSheet]
    const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
    const overrides = normalizeImportedActualOverrides(records)
    if (!overrides.length || !scenarioId) {
      setImportMessage('No valid actual overrides were found. Include at least a Week column.')
      return
    }
    importActualOverrides(scenarioId, overrides)
    setImportMessage(`Imported ${overrides.length} actual override row${overrides.length === 1 ? '' : 's'}.`)
  }

  if (!rows.length) {
    return <p className="saas-muted">Select a scenario to inspect the weekly ledger.</p>
  }

  return (
    <div className="space-y-4">
      <div className="cap-view-toolbar">
        <div>
          <p className="saas-muted m-0 text-sm">Ledger now mirrors the Actuals matrix format, with weeks as columns and status shown under each week.</p>
          <p className="saas-muted m-0 text-xs">Historical rows remain Actual. Current and future rows remain Planned unless imported or overridden.</p>
        </div>
        <ScenarioPicker value={scenarioId} onChange={setViewId} help="Scenario whose weekly plan ledger you want to inspect." />
      </div>

      <div className="cap-ledger-summary-grid">
        <div className="saas-card">
          <p className="cap-ledger-summary__label">Historical actual weeks</p>
          <p className="cap-ledger-summary__value">{ledger.filter((row) => row.timeline === 'historical_actual').length}</p>
        </div>
        <div className="saas-card">
          <p className="cap-ledger-summary__label">Forward planned weeks</p>
          <p className="cap-ledger-summary__value">{ledger.filter((row) => row.timeline === 'forward_plan').length}</p>
        </div>
        <div className="saas-card">
          <p className="cap-ledger-summary__label">Imported actual overrides</p>
          <p className="cap-ledger-summary__value">{importedCount}</p>
        </div>
        <div className="saas-card">
          <p className="cap-ledger-summary__label">Shrinkage categories</p>
          <p className="cap-ledger-summary__value">{ledger[0]?.shrinkage.length ?? 0}</p>
        </div>
      </div>

      <div className="cap-ledger-toolbar">
        <div className="saas-tabs" role="tablist" aria-label="Ledger view">
          {(['weekly', 'monthly', 'quarterly'] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={view === option}
              className={`saas-tabs__btn${view === option ? ' saas-tabs__btn--active' : ''}`}
              onClick={() => setView(option)}
            >
              {option[0]!.toUpperCase() + option.slice(1)}
            </button>
          ))}
        </div>

        <div className="cap-ledger-toolbar__actions">
          <button type="button" className="cap-btn-ghost-sm" onClick={() => setExpanded(Object.fromEntries(LEDGER_SECTIONS.map((s) => [s.id, !allExpanded])))}>{allExpanded ? 'Collapse all' : 'Expand all'}</button>
          <button type="button" className="cap-btn-ghost-sm" onClick={downloadTemplate}>Actuals template</button>
          <button type="button" className="saas-btn saas-btn--secondary" onClick={() => fileInputRef.current?.click()}>Import actuals</button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void importFile(file)
              event.currentTarget.value = ''
            }}
          />
        </div>
      </div>

      {importMessage ? <p className="saas-muted m-0 text-sm">{importMessage}</p> : null}

      <div className="pva-ref-wrap">
        <div className="pva-ref-scroll">
          <table className="pva-ref-table">
            <thead>
              <tr>
                <th className="pva-ref-table__metric-col" colSpan={2}>Metric</th>
                {rows.map((row) => (
                  <th key={row.key} className="pva-ref-table__week-col">
                    {row.week}
                  </th>
                ))}
              </tr>
              <tr className="pva-ref-table__weeks-row">
                <th colSpan={2} className="pva-ref-table__weeks-label">Status</th>
                {rows.map((row) => (
                  <th key={`status-${row.key}`} className="pva-ref-table__week-sub">
                    {row.timeline === 'historical_actual' ? 'Actual' : 'Planned'}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {LEDGER_SECTIONS.map((section) => (
                <SectionBlock
                  key={section.id}
                  title={section.title}
                  isOpen={expanded[section.id]}
                  onToggle={() => setExpanded((prev) => ({ ...prev, [section.id]: !prev[section.id] }))}
                  colSpan={rows.length + 2}
                >
                  {expanded[section.id]
                    ? section.rows.map((metric) => (
                        <tr key={metric.id} className="pva-ref-table__data-row">
                          <td className="pva-ref-table__indent" />
                          <td className="pva-ref-table__metric">{metric.label}</td>
                          {rows.map((row) => {
                            const raw = metric.value(row)
                            const tone = ledgerMetricTone(metric.id, raw)
                            return (
                            <td key={`${metric.id}-${row.key}`} className={`pva-ref-table__num pva-ref-table__num--${tone}`}>
                              {metric.format(raw)}
                            </td>
                            )
                          })}
                        </tr>
                      ))
                    : null}
                </SectionBlock>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function ledgerMetricTone(metricId: string, value: number | null): string {
  if (value == null || !Number.isFinite(value) || !metricId.includes('variance')) return 'neutral'
  if (value > 0) return 'variance-pos'
  if (value < 0) return 'variance-neg'
  return 'neutral'
}

function SectionBlock({
  title,
  isOpen,
  onToggle,
  colSpan,
  children,
}: {
  title: string
  isOpen: boolean
  onToggle: () => void
  colSpan: number
  children: ReactNode
}) {
  return (
    <>
      <tr className="pva-ref-table__cat-row">
        <td colSpan={colSpan} className="pva-ref-table__cat-cell">
          <button type="button" className="pva-ref-cat-btn" onClick={onToggle} aria-expanded={isOpen}>
            <span className="pva-ref-cat-btn__chev" aria-hidden>{isOpen ? '▼' : '▶'}</span>
            {title}
          </button>
        </td>
      </tr>
      {children}
    </>
  )
}
