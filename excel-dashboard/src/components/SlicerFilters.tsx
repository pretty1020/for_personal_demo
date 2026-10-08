import type { ColumnSchema, SheetSnapshot } from '../types/dashboard'
import type { SlicerRole, SlicerSpec } from '../utils/slicerColumns'
import { SLICER_SPECS } from '../utils/slicerColumns'
import { getSlicerOptionValues } from '../utils/slicerValues'

const MAX_SLICER_CHIPS = 500
const MAX_LABEL_CHARS = 22

function truncateLabel(s: string): string {
  const t = s.trim()
  if (t.length <= MAX_LABEL_CHARS) return t
  return `${t.slice(0, MAX_LABEL_CHARS - 1)}…`
}

type FilterVal = string | string[] | undefined

export interface SlicerFiltersProps {
  /** Tab used to list distinct values & column mapping (usually Datasheet). */
  slicerSnapshot: SheetSnapshot
  /** Resolved column keys on `slicerSnapshot`. */
  effectiveResolved: Partial<Record<SlicerRole, string>>
  /** Same roles, keys on the *currently viewed* sheet — used for table filters. */
  filterColumnKeyByRole: Partial<Record<SlicerRole, string>>
  manualMap: Partial<Record<SlicerRole, string>>
  onManualMap: (role: SlicerRole, columnKey: string | undefined) => void
  getFilterValue: (columnKey: string) => FilterVal
  setFilterValue: (columnKey: string, value: FilterVal) => void
  isMulti: (columnKey: string) => boolean
  /** Optional note (e.g. options come from Datasheet tab). */
  dataSourceHint?: string
}

function columnSelectValue(manualMap: Partial<Record<SlicerRole, string>>, role: SlicerRole): string {
  if (!Object.prototype.hasOwnProperty.call(manualMap, role)) return '__auto__'
  const v = manualMap[role]
  if (v === '') return '__none__'
  return v ?? '__auto__'
}

function SlicerBox(props: {
  spec: SlicerSpec
  role: SlicerRole
  sourceColumnKey: string | undefined
  filterColumnKey: string | undefined
  columnLabel: string
  optionValues: string[]
  valuesTruncated: boolean
  columns: ColumnSchema[]
  usedColumnKeys: Set<string>
  columnSelect: string
  onPickColumn: (role: SlicerRole, key: string | undefined) => void
  getFilterValue: (columnKey: string) => FilterVal
  setFilterValue: (columnKey: string, value: FilterVal) => void
  isMulti: (columnKey: string) => boolean
}) {
  const {
    spec,
    role,
    sourceColumnKey,
    filterColumnKey,
    columnLabel,
    optionValues,
    valuesTruncated,
    columns,
    usedColumnKeys,
    columnSelect,
    onPickColumn,
    getFilterValue,
    setFilterValue,
    isMulti,
  } = props

  const multiKey = filterColumnKey ?? sourceColumnKey ?? ''
  const current =
    filterColumnKey != null && filterColumnKey !== ''
      ? getFilterValue(filterColumnKey)
      : undefined
  const hasFilter =
    current != null &&
    current !== '' &&
    !(Array.isArray(current) && current.length === 0)

  const clear = () => {
    if (filterColumnKey) setFilterValue(filterColumnKey, undefined)
  }

  const handleColumnSelect = (raw: string) => {
    if (raw === '__auto__') {
      onPickColumn(role, undefined)
      return
    }
    if (raw === '__none__') {
      onPickColumn(role, '')
      return
    }
    onPickColumn(role, raw)
  }

  const multiOn = multiKey ? isMulti(multiKey) : false

  const handleSelectChange = (raw: string) => {
    if (!filterColumnKey) return
    if (!raw) {
      setFilterValue(filterColumnKey, undefined)
      return
    }
    setFilterValue(filterColumnKey, raw)
  }

  const handleMultiChange = (selected: string[]) => {
    if (!filterColumnKey) return
    setFilterValue(filterColumnKey, selected.length ? selected : undefined)
  }

  return (
    <div
      className={`slicer-box slicer-box--${spec.layout}`}
      data-slicer={spec.role}
      aria-label={spec.label}
    >
      <div className="slicer-box__head">
        <span className="slicer-box__title">{spec.label}</span>
        <div className="slicer-box__tools">
          <button
            type="button"
            className="slicer-tool slicer-tool--clear"
            title="Clear filter"
            aria-label="Clear filter"
            disabled={!filterColumnKey || !hasFilter}
            onClick={clear}
          >
            ⊗
          </button>
        </div>
      </div>

      <label className="slicer-box__map">
        <span className="slicer-box__map-label">Column</span>
        <select
          className="slicer-box__select"
          value={columnSelect}
          onChange={(e) => handleColumnSelect(e.target.value)}
          aria-label={`Map ${spec.label} to column`}
        >
          <option value="__auto__">Auto-detect</option>
          <option value="__none__">None</option>
          {columns.map((c) => {
            const taken = usedColumnKeys.has(c.key) && c.key !== sourceColumnKey
            return (
              <option key={c.key} value={c.key} disabled={taken}>
                {c.header}
                {taken ? ' (in use)' : ''}
              </option>
            )
          })}
        </select>
      </label>

      {!sourceColumnKey ? (
        <p className="slicer-box__missing">
          Choose <strong>None</strong> to hide this slicer, or map a column — or set{' '}
          <strong>Auto-detect</strong> when headers match Client, Project, DU, Location, Category.
        </p>
      ) : optionValues.length === 0 ? (
        <p className="slicer-box__missing">No non-blank values in this column.</p>
      ) : (
        <>
          {sourceColumnKey && !filterColumnKey ? (
            <p className="slicer-box__cross-sheet">
              No column with the same header on the current sheet — open the Datasheet tab or align
              column names so filters apply here.
            </p>
          ) : null}
          {valuesTruncated ? (
            <p className="slicer-box__cap-hint">
              Showing the first {MAX_SLICER_CHIPS} distinct values (more exist in the sheet).
            </p>
          ) : null}
          {multiOn ? (
            <label className="slicer-box__dropdown">
              <span className="sr-only">{spec.label} filter values</span>
              <select
                className="slicer-box__select"
                multiple
                value={Array.isArray(current) ? current : current ? [String(current)] : []}
                disabled={!filterColumnKey}
                onChange={(e) => {
                  const sel = Array.from(e.target.selectedOptions).map((o) => o.value)
                  handleMultiChange(sel)
                }}
              >
                {optionValues.map((opt) => (
                  <option key={opt} value={opt}>
                    {truncateLabel(opt)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="slicer-box__dropdown">
              <span className="sr-only">{spec.label} filter value</span>
              <select
                className="slicer-box__select"
                value={typeof current === 'string' ? current : ''}
                disabled={!filterColumnKey}
                onChange={(e) => handleSelectChange(e.target.value)}
              >
                <option value="">All</option>
                {optionValues.map((opt) => (
                  <option key={opt} value={opt}>
                    {truncateLabel(opt)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      )}

      {sourceColumnKey ? (
        <p className="slicer-box__col-hint" title={columnLabel}>
          → {truncateLabel(columnLabel)}
        </p>
      ) : null}
    </div>
  )
}

function usedKeysExcept(
  effective: Partial<Record<SlicerRole, string>>,
  exceptRole: SlicerRole,
): Set<string> {
  const s = new Set<string>()
  for (const spec of SLICER_SPECS) {
    if (spec.role === exceptRole) continue
    const k = effective[spec.role]
    if (k) s.add(k)
  }
  return s
}

export function SlicerFilters(props: SlicerFiltersProps) {
  const {
    slicerSnapshot,
    effectiveResolved,
    filterColumnKeyByRole,
    manualMap,
    onManualMap,
    getFilterValue,
    setFilterValue,
    isMulti,
    dataSourceHint,
  } = props

  const boxProps = (role: SlicerRole, spec: SlicerSpec) => {
    const sourceColumnKey = effectiveResolved[role]
    const filterColumnKey = filterColumnKeyByRole[role]
    const col = sourceColumnKey ? slicerSnapshot.columns.find((c) => c.key === sourceColumnKey) : undefined
    const { values, truncated } = sourceColumnKey
      ? getSlicerOptionValues(slicerSnapshot, sourceColumnKey, col, MAX_SLICER_CHIPS)
      : { values: [] as string[], truncated: false }
    const used = usedKeysExcept(effectiveResolved, role)
    const columnSelect = columnSelectValue(manualMap, role)

    return {
      spec,
      role,
      sourceColumnKey,
      filterColumnKey,
      columnLabel: col?.header ?? sourceColumnKey ?? '',
      optionValues: values,
      valuesTruncated: truncated,
      columns: slicerSnapshot.columns,
      usedColumnKeys: used,
      columnSelect,
      onPickColumn: onManualMap,
      getFilterValue,
      setFilterValue,
      isMulti,
    }
  }

  const clientSpec = SLICER_SPECS.find((s) => s.role === 'client')!
  const projectSpec = SLICER_SPECS.find((s) => s.role === 'project')!
  const duSpec = SLICER_SPECS.find((s) => s.role === 'du')!
  const locSpec = SLICER_SPECS.find((s) => s.role === 'location')!
  const catSpec = SLICER_SPECS.find((s) => s.role === 'category1')!

  return (
    <section className="slicer-strip" aria-label="Slicer filters">
      {dataSourceHint ? (
        <p className="slicer-strip__hint">{dataSourceHint}</p>
      ) : null}
      <div className="slicer-strip__row1">
        <div className="slicer-strip__cell slicer-strip__cell--client">
          <SlicerBox {...boxProps('client', clientSpec)} />
        </div>
        <div className="slicer-strip__cell">
          <SlicerBox {...boxProps('du', duSpec)} />
        </div>
        <div className="slicer-strip__cell">
          <SlicerBox {...boxProps('location', locSpec)} />
        </div>
        <div className="slicer-strip__cell">
          <SlicerBox {...boxProps('category1', catSpec)} />
        </div>
      </div>
      <div className="slicer-strip__row2">
        <div className="slicer-strip__cell slicer-strip__cell--project">
          <SlicerBox {...boxProps('project', projectSpec)} />
        </div>
      </div>
    </section>
  )
}
