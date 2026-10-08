import { useRef, useState } from 'react'
import {
  capacityForecastTemplateLabel,
  downloadCapacityForecastTemplate,
  parseCapacityForecastFile,
  type CapacityForecastImportMode,
  type CapacityForecastTemplateType,
} from '../../planner/capacityForecastImport'
import { resolveCapacityPlanStartWeek, resolvePlanHorizonWeeks } from '../../planner/capacityWeekUtils'
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
}

export function CapacityDataUploadPanel({ scenario, disabled, existingOverrides, onImport }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(true)
  const [mode, setMode] = useState<CapacityForecastImportMode>('overwrite')
  const [templateType, setTemplateType] = useState<CapacityForecastTemplateType>('volume_aht_occupancy')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const planStartWeek = resolveCapacityPlanStartWeek(scenario.plan)
  const horizonWeeks = resolvePlanHorizonWeeks(planStartWeek, scenario.plan.weekStart)

  const handleFile = async (file: File) => {
    setBusy(true)
    setError('')
    try {
      const result = await parseCapacityForecastFile(file, {
        planStartWeek,
        weekStart: scenario.plan.weekStart,
        mode,
        templateType,
        standardHours: scenario.assumptions.tenured.standardScheduledHoursPerWeek,
        existingOverrides: existingOverrides as Record<string, import('../../planner/capacityPlanOverridePersistence').WeekCapacityPlanOverride>,
      })
      if (!result.success) {
        setError(result.errors.join(' ') || result.message)
        return
      }
      onImport(result)
    } catch {
      setError('Upload failed. Use a downloaded template (.xlsx or .csv).')
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
            Upload weekly values (Week 1–{horizonWeeks}). Volume + AHT + Occupancy auto-calculates Required FTE.
          </p>
          <label className="saas-field">
            <span className="saas-field__label">Template type</span>
            <select
              className="cap-field__input"
              value={templateType}
              onChange={(event) => setTemplateType(event.target.value as CapacityForecastTemplateType)}
              disabled={disabled}
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
              disabled={disabled}
            >
              <option value="overwrite">Overwrite matching weeks</option>
              <option value="append">Append / merge with existing</option>
            </select>
          </label>
          <div className="cap-capacity-sidebar__actions">
            <button
              type="button"
              className="saas-btn saas-btn--secondary"
              disabled={disabled}
              onClick={() => downloadCapacityForecastTemplate(templateType, planStartWeek, horizonWeeks)}
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
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="sr-only"
            // sr-only keeps this in the accessibility tree, so it needs its own name.
            aria-label="Choose a capacity file to upload (Excel or CSV)"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void handleFile(file)
            }}
          />
          {error ? <p className="cap-capacity-upload-error m-0">{error}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
