import { useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import {
  CapacityReadOnlyMatrix,
  buildCapacityMatrixDisplayContext,
} from '../../components/planner/CapacityReadOnlyMatrix'
import { ScenarioPicker } from '../../components/planner/ScenarioPicker'
import { usePlanner } from '../../context/PlannerContext'
import { combineCapacityRows, deriveCapacityPlanRows } from '../../planner/capacityPlanDerived'
import {
  actualsTemplateRows,
  normalizeImportedActualOverrides,
  type WeeklyLedgerRow,
} from '../../planner/weeklyLedger'

const FORECAST_HORIZON = 52

function combineLedgerRows(groups: WeeklyLedgerRow[][]): WeeklyLedgerRow[] {
  const byWeek = new Map<string, WeeklyLedgerRow[]>()
  groups.flat().forEach((row) => {
    byWeek.set(row.week, [...(byWeek.get(row.week) ?? []), row])
  })
  return [...byWeek.entries()].map(([week, rows]) => {
    const first = rows[0]!
    const shrinkageById = new Map<string, (typeof first.shrinkage)[number][]>()
    rows.forEach((row) => {
      row.shrinkage.forEach((item) => {
        shrinkageById.set(item.id, [...(shrinkageById.get(item.id) ?? []), item])
      })
    })
    const avg = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1)
    return {
      ...first,
      week,
      planned: rows.reduce(
        (acc, row) => ({
          ...acc,
          callVolume: (acc.callVolume ?? 0) + (row.planned.callVolume ?? 0),
          handledVolume: (acc.handledVolume ?? 0) + (row.planned.handledVolume ?? 0),
        }),
        { ...first.planned },
      ),
      shrinkage: [...shrinkageById.entries()].map(([id, items]) => ({
        id,
        name: items[0]!.name,
        group: items[0]!.group,
        billable: items[0]!.billable,
        plannedPct: avg(items.map((item) => item.plannedPct)),
        actualPct: avg(items.map((item) => item.actualPct ?? 0)),
      })),
    }
  })
}

export function PlannedVsActualPage() {
  const {
    activeScenario,
    scenarios,
    getScenarioLedger,
    getScenarioForecast,
    getScenarioCapacityPlanOverrides,
    importActualOverrides,
  } = usePlanner()
  const [viewId, setViewId] = useState(activeScenario?.id ?? '')
  const [importMessage, setImportMessage] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const scenarioId = viewId || activeScenario?.id || ''
  const selectedScenario = scenarios.find((scenario) => scenario.id === scenarioId) ?? activeScenario ?? null
  const clientScenarios = selectedScenario
    ? scenarios.filter((scenario) => scenario.plan.client === selectedScenario.plan.client)
    : []

  const derivedRows = useMemo(() => {
    if (!selectedScenario) return []
    const rowsForScenario = (id: string) => {
      const scenario = scenarios.find((item) => item.id === id)
      if (!scenario) return []
      return deriveCapacityPlanRows(
        getScenarioLedger(id),
        scenario,
        getScenarioForecast(id, FORECAST_HORIZON),
        getScenarioCapacityPlanOverrides(id),
      )
    }
    if (clientScenarios.length > 1) {
      return combineCapacityRows(clientScenarios.map((scenario) => rowsForScenario(scenario.id)))
    }
    return rowsForScenario(selectedScenario.id)
  }, [
    clientScenarios,
    getScenarioCapacityPlanOverrides,
    getScenarioForecast,
    getScenarioLedger,
    scenarios,
    selectedScenario,
  ])

  const ledgerRows = useMemo(() => {
    if (!selectedScenario) return []
    if (clientScenarios.length > 1) {
      return combineLedgerRows(clientScenarios.map((scenario) => getScenarioLedger(scenario.id)))
    }
    return getScenarioLedger(selectedScenario.id)
  }, [clientScenarios, getScenarioLedger, selectedScenario])

  const forecastPackage = useMemo(() => {
    if (!selectedScenario) return null
    return getScenarioForecast(selectedScenario.id, FORECAST_HORIZON)
  }, [getScenarioForecast, selectedScenario])

  const matrixContext = useMemo(() => {
    if (!selectedScenario || !derivedRows.length) return null
    return buildCapacityMatrixDisplayContext({
      derivedRows,
      ledger: ledgerRows,
      forecast: forecastPackage,
      assumptions: selectedScenario.assumptions,
      view: 'weekly',
    })
  }, [derivedRows, forecastPackage, ledgerRows, selectedScenario])

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

  if (!selectedScenario) {
    return <p className="saas-muted">Select a scenario to view capacity-aligned planned and actual metrics.</p>
  }

  return (
    <div className="space-y-4">
      <div className="cap-view-toolbar saas-card">
        <div>
          <p className="saas-muted m-0 text-sm">
            Scenario View — Capacity shows the selected scenario in the same matrix layout and metrics as the Capacity
            page.
          </p>
          <p className="saas-muted m-0 text-xs">
            Choose a created scenario below. Historical actual weeks and planned weeks follow the scenario dataset.
          </p>
        </div>
        <ScenarioPicker value={scenarioId} onChange={setViewId} help="Scenario to view in Capacity-aligned format." />
      </div>

      <div className="cap-ledger-toolbar cap-ledger-toolbar--capacity saas-card">
        <div>
          <h3 className="m-0 text-base font-bold text-slate-900">Actuals import</h3>
          <p className="saas-muted m-0 text-xs">Upload workbook overrides for production HC, volume, shrinkage, and related actuals.</p>
        </div>
        <div className="cap-ledger-toolbar__actions">
          <button type="button" className="cap-btn-ghost-sm" onClick={downloadTemplate}>
            Actuals template
          </button>
          <button type="button" className="saas-btn saas-btn--secondary" onClick={() => fileInputRef.current?.click()}>
            Import actuals
          </button>
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

      {matrixContext ? (
        <CapacityReadOnlyMatrix
          rows={derivedRows}
          matrixContext={matrixContext}
          title={`Scenario View — Capacity · ${selectedScenario.name}`}
        />
      ) : (
        <p className="saas-muted m-0 text-sm">No capacity rows available for this scenario.</p>
      )}
    </div>
  )
}
