import { useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import {
  capacityForecastTemplateLabel,
  downloadCapacityForecastTemplate,
  parseCapacityForecastFile,
  type CapacityForecastImportMode,
  type CapacityForecastTemplateType,
} from '../../planner/capacityForecastImport'
import { detectCapacityWorkbookKind } from '../../planner/capacityWorkbookImport'
import { MAX_FUTURE_WEEKS } from '../../planner/capacityMatrixTheme'
import { resolveCapacityPlanStartWeek } from '../../planner/capacityWeekUtils'
import type { PlannerScenario } from '../../planner/types'

const TEMPLATE_TYPES: CapacityForecastTemplateType[] = [
  'forecast_volume',
  'planned_aht',
  'planned_occupancy',
  'required_fte',
  'transactions',
  'volume_aht_occupancy',
]

type Props = {
  scenario: PlannerScenario
  disabled?: boolean
  existingOverrides: Record<string, unknown>
  onImport: (result: Awaited<ReturnType<typeof parseCapacityForecastFile>>) => void
  /** Route Capacity Matrix / full workbook uploads to the Files → Upload template handler. */
  onCapacityWorkbookFile?: (file: File) => void | Promise<void>
}

export function CapacityDataUploadPanel({
  scenario,
  disabled,
  existingOverrides,
  onImport,
  onCapacityWorkbookFile,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(true)
  const [mode, setMode] = useState<CapacityForecastImportMode>('overwrite')
  const [templateType, setTemplateType] = useState<CapacityForecastTemplateType>('volume_aht_occupancy')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [dragOver, setDragOver] = useState(false)

  const planStartWeek = resolveCapacityPlanStartWeek(scenario.plan)

  const handleFile = async (file: File) => {
    const lower = file.name.toLowerCase()
    if (!lower.endsWith('.xlsx') && !lower.endsWith('.xls') && !lower.endsWith('.csv')) {
      setError('Unsupported file type. Download a template and upload .xlsx, .xls, or .csv.')
      setSuccess('')
      return
    }
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      // Matrix / full Capacity_Plan workbooks must use the Upload template path —
      // this panel only understands Week + driver column templates.
      if (onCapacityWorkbookFile && (lower.endsWith('.xlsx') || lower.endsWith('.xls'))) {
        try {
          const buffer = await file.arrayBuffer()
          const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
          // arrayBuffer() can only be consumed once — rebuild the File for the next reader.
          const reusable = new File([buffer], file.name, { type: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
          if (detectCapacityWorkbookKind(workbook)) {
            await onCapacityWorkbookFile(reusable)
            setSuccess('Capacity matrix / workbook detected — applied via Upload template.')
            return
          }
          const result = await parseCapacityForecastFile(reusable, {
            planStartWeek,
            weekStart: scenario.plan.weekStart,
            mode,
            templateType,
            standardHours: scenario.assumptions.tenured.standardScheduledHoursPerWeek,
            existingOverrides: existingOverrides as Record<
              string,
              import('../../planner/capacityPlanOverridePersistence').WeekCapacityPlanOverride
            >,
          })
          if (!result.success) {
            setError(
              result.errors.join(' ') || result.message || 'Upload failed. Check the template columns and try again.',
            )
            return
          }
          onImport(result)
          setSuccess(
            result.message ||
              `Imported ${result.weeksApplied} week${result.weeksApplied === 1 ? '' : 's'} (${result.cellsApplied} cells).`,
          )
          return
        } catch {
          // Fall through to a fresh forecast-template parse below.
        }
      }

      const result = await parseCapacityForecastFile(file, {
        planStartWeek,
        weekStart: scenario.plan.weekStart,
        mode,
        templateType,
        standardHours: scenario.assumptions.tenured.standardScheduledHoursPerWeek,
        existingOverrides: existingOverrides as Record<
          string,
          import('../../planner/capacityPlanOverridePersistence').WeekCapacityPlanOverride
        >,
      })
      if (!result.success) {
        const matrixHint = result.errors.some((item) => /week/i.test(item))
          ? ' If this is a Capacity Matrix download, use Upload template under Files instead.'
          : ''
        setError(
          (result.errors.join(' ') || result.message || 'Upload failed. Check the template columns and try again.') +
            matrixHint,
        )
        return
      }
      onImport(result)
      setSuccess(
        result.message ||
          `Imported ${result.weeksApplied} week${result.weeksApplied === 1 ? '' : 's'} (${result.cellsApplied} cells).`,
      )
    } catch {
      setError('Upload failed. Use a downloaded template (.xlsx or .csv) that matches the selected template type.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="cap-capacity-sidecard">
      <div className="cap-capacity-sidecard__head">
        <div>
          <p className="cap-capacity-sidecard__eyebrow">Data import</p>
          <h3 className="cap-capacity-sidecard__title">Forecast &amp; drivers</h3>
        </div>
        <button
          type="button"
          className={`cap-capacity-sidecard__toggle${open ? ' is-active' : ''}`}
          onClick={() => setOpen((prev) => !prev)}
        >
          {open ? 'Collapse' : 'Expand'}
        </button>
      </div>
      {open ? (
        <div className="cap-capacity-sidebar__form">
          <p className="cap-panel__desc m-0">
            Download the matching template, fill Week 1–{MAX_FUTURE_WEEKS}, then upload. Volume + AHT + Occupancy
            auto-calculates Required FTE.
          </p>
          <label className="saas-field">
            <span className="saas-field__label">Template type</span>
            <select
              className="cap-field__input"
              value={templateType}
              onChange={(event) => {
                setTemplateType(event.target.value as CapacityForecastTemplateType)
                setError('')
                setSuccess('')
              }}
              disabled={disabled || busy}
            >
              {TEMPLATE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {capacityForecastTemplateLabel(type)}
                </option>
              ))}
            </select>
          </label>
          <label className="saas-field">
            <span className="saas-field__label">Import mode</span>
            <select
              className="cap-field__input"
              value={mode}
              onChange={(event) => setMode(event.target.value as CapacityForecastImportMode)}
              disabled={disabled || busy}
            >
              <option value="overwrite">Overwrite matching weeks</option>
              <option value="append">Append / merge with existing</option>
            </select>
          </label>
          <div className="cap-capacity-sidebar__actions">
            <button
              type="button"
              className="saas-btn saas-btn--secondary"
              disabled={disabled || busy}
              onClick={() => downloadCapacityForecastTemplate(templateType, planStartWeek, MAX_FUTURE_WEEKS)}
            >
              Download template
            </button>
            <button
              type="button"
              className="saas-btn"
              disabled={disabled || busy}
              onClick={() => fileInputRef.current?.click()}
            >
              {busy ? 'Uploading…' : 'Upload file'}
            </button>
          </div>
          <div
            className={`cap-capacity-dropzone${dragOver ? ' is-dragover' : ''}${disabled || busy ? ' is-disabled' : ''}`}
            onDragEnter={(event) => {
              event.preventDefault()
              if (!disabled && !busy) setDragOver(true)
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDragOver(false)
              if (disabled || busy) return
              const file = event.dataTransfer.files?.[0]
              if (file) void handleFile(file)
            }}
          >
            <p className="m-0 text-sm font-semibold text-slate-700">Drop template here</p>
            <p className="saas-muted m-0 mt-1 text-xs">.xlsx · .xls · .csv</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void handleFile(file)
            }}
          />
          {error ? (
            <p className="cap-capacity-upload-error m-0" role="alert">
              {error}
            </p>
          ) : null}
          {success ? (
            <p className="cap-capacity-upload-success m-0" role="status">
              {success}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
