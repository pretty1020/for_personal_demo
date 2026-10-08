import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type PaginationState,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table'
import { Fragment, memo, useCallback, useEffect, useMemo, useState } from 'react'
import type { Aggregation, ColumnFilters, ColumnSchema, SheetSnapshot } from '../types/dashboard'
import { SlicerFilters } from './SlicerFilters'
import { describeDatasheetSource, findDatasheetSnapshot } from '../utils/datasheetTab'
import { formatCellForDisplay } from '../utils/inferTypes'
import { rowLooksLikePivotTotal } from '../utils/pivotTotalRows'
import type { SlicerRole } from '../utils/slicerColumns'
import { mergeSlicerColumnKeys } from '../utils/slicerMerge'
import { resolveSlicerColumnKeys, SLICER_SPECS } from '../utils/slicerColumns'
import { mapSourceColumnKeyToTarget } from '../utils/slicerCrossSheet'
import { computeColumnFacets, type ColumnFacet } from '../utils/tableFacets'
import { rowsToCsv, triggerDownloadCsv } from '../utils/exportCsv'

/** Internal stable row id for masking / export (not a spreadsheet column). */
const SRC_ROW = '__srcRow' as const

type AugmentedRow = Record<string, unknown> & { [SRC_ROW]: number }

interface DataPreviewTableProps {
  workbookName: string
  /** Currently selected sheet — table body and filters apply here. */
  snapshot: SheetSnapshot
  /** All parsed sheets (used to find the Datasheet tab for slicer option lists). */
  allSnapshots?: Record<string, SheetSnapshot>
  sheetNames?: string[]
  /** Expose exact-match header filters so other sections (charts) can stay in sync. */
  onSharedFiltersChange?: (filters: ColumnFilters) => void
  /** When false, Pivot rows/values/output block starts collapsed (e.g. DBE consolidated view). Default true. */
  initialShowPivot?: boolean
}

const AGGREGATIONS: Aggregation[] = ['sum', 'average', 'count', 'min', 'max']

function aggregate(values: number[], aggregation: Aggregation): number {
  if (aggregation === 'count') return values.length
  if (values.length === 0) return 0
  switch (aggregation) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0)
    case 'average':
      return values.reduce((a, b) => a + b, 0) / values.length
    case 'min':
      return Math.min(...values)
    case 'max':
      return Math.max(...values)
    default:
      return values.reduce((a, b) => a + b, 0)
  }
}

function DataPreviewTableInner(props: DataPreviewTableProps) {
  const {
    workbookName,
    snapshot,
    allSnapshots,
    sheetNames,
    onSharedFiltersChange,
    initialShowPivot = true,
  } = props

  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [hiddenRows, setHiddenRows] = useState<Set<number>>(() => new Set())
  const [filterableColumns, setFilterableColumns] = useState<Set<string>>(() => new Set())
  const [showPivot, setShowPivot] = useState(initialShowPivot)
  const [pivotRows, setPivotRows] = useState<string[]>([])
  const [pivotValue, setPivotValue] = useState('')
  const [pivotAggregation, setPivotAggregation] = useState<Aggregation>('sum')
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 1,
  })
  const [layoutOpen, setLayoutOpen] = useState(false)
  /** Per-role column overrides: absent = auto; '' = none; string = column key. */
  const [slicerManual, setSlicerManual] = useState<Partial<Record<SlicerRole, string>>>({})

  const facets = useMemo(() => computeColumnFacets(snapshot), [snapshot])

  /** Datasheet (or first “Datasheet*” tab) supplies slicer distinct values & column detection. */
  const slicerSource = useMemo(() => {
    if (allSnapshots && sheetNames && sheetNames.length > 0) {
      return findDatasheetSnapshot(allSnapshots, sheetNames) ?? snapshot
    }
    return snapshot
  }, [allSnapshots, sheetNames, snapshot])

  const autoSlicerKeys = useMemo(() => resolveSlicerColumnKeys(slicerSource), [slicerSource])
  const effectiveOnSource = useMemo(
    () => mergeSlicerColumnKeys(autoSlicerKeys, slicerManual),
    [autoSlicerKeys, slicerManual],
  )

  /** Slicer roles mapped to column keys on the *viewed* sheet (for TanStack filters). */
  const filterColumnKeyByRole = useMemo(() => {
    const out: Partial<Record<SlicerRole, string>> = {}
    for (const spec of SLICER_SPECS) {
      const sk = effectiveOnSource[spec.role]
      if (!sk) continue
      const tk = mapSourceColumnKeyToTarget(sk, slicerSource, snapshot)
      if (tk) out[spec.role] = tk
    }
    return out
  }, [effectiveOnSource, slicerSource, snapshot])

  const slicerColumnKeySet = useMemo(
    () => new Set(Object.values(filterColumnKeyByRole).filter(Boolean) as string[]),
    [filterColumnKeyByRole],
  )

  const augmentedRows = useMemo<AugmentedRow[]>(
    () => snapshot.rows.map((r, i) => ({ ...r, [SRC_ROW]: i })),
    [snapshot.rows],
  )

  const tableRows = useMemo(
    () => augmentedRows.filter((r) => !hiddenRows.has(r[SRC_ROW])),
    [augmentedRows, hiddenRows],
  )

  const sourceRowCount = snapshot.rows.length
  const visibleAfterRowMask = tableRows.length
  const hiddenRowCount = hiddenRows.size
  const nonNumericColumns = useMemo(
    () => snapshot.columns.filter((c) => c.type !== 'number'),
    [snapshot.columns],
  )
  const numericColumns = useMemo(
    () => snapshot.columns.filter((c) => c.type === 'number'),
    [snapshot.columns],
  )

  useEffect(() => {
    setSorting([])
    setGlobalFilter('')
    setColumnFilters([])
    setColumnVisibility({})
    setHiddenRows(new Set())
    setFilterableColumns(new Set(snapshot.columns.map((c) => c.key)))
    setPagination({
      pageIndex: 0,
      pageSize: Math.min(200, Math.max(snapshot.rows.length || 1, 1)),
    })
    setLayoutOpen(false)
    setShowPivot(initialShowPivot)
    setPivotRows(nonNumericColumns.slice(0, 1).map((c) => c.key))
    setPivotValue(numericColumns[0]?.key ?? '')
    setPivotAggregation('sum')
  }, [
    snapshot.name,
    snapshot.rows.length,
    snapshot.columns,
    nonNumericColumns,
    numericColumns,
    initialShowPivot,
  ])

  /** After row mask or sheet changes, clamp page size / index to the visible row count */
  useEffect(() => {
    const maxRows = Math.max(visibleAfterRowMask, 1)
    setPagination((p) => {
      const nextSize = p.pageSize > maxRows ? maxRows : p.pageSize
      const ps = Math.max(nextSize, 1)
      const pageCount = Math.max(1, Math.ceil(maxRows / ps))
      const nextIndex = Math.min(p.pageIndex, pageCount - 1)
      return { pageSize: ps, pageIndex: Math.max(0, nextIndex) }
    })
  }, [visibleAfterRowMask])

  useEffect(() => {
    if (!onSharedFiltersChange) return
    const next: ColumnFilters = {}
    for (const f of columnFilters) {
      if (!f?.id) continue
      const v = f.value
      if (Array.isArray(v)) {
        if (v.length) next[f.id] = v
      } else if (typeof v === 'string') {
        const t = v.trim()
        if (t) next[f.id] = t
      }
    }
    onSharedFiltersChange(next)
  }, [columnFilters, onSharedFiltersChange])

  const getSlicerFilterValue = useCallback(
    (columnKey: string) => {
      const f = columnFilters.find((x) => x.id === columnKey)
      return f?.value as string | string[] | undefined
    },
    [columnFilters],
  )

  const setSlicerFilterValue = useCallback((columnKey: string, value: unknown) => {
    setColumnFilters((prev) => {
      const rest = prev.filter((x) => x.id !== columnKey)
      if (value === undefined || value === '') return rest
      if (Array.isArray(value) && value.length === 0) return rest
      return [...rest, { id: columnKey, value }]
    })
  }, [])

  const slicerIsMulti = useCallback(() => false, [])

  const onSlicerManualMap = useCallback(
    (role: SlicerRole, columnKey: string | undefined) => {
      setSlicerManual((prev) => {
        const prevMerged = mergeSlicerColumnKeys(autoSlicerKeys, prev)
        const beforeSource = prevMerged[role]
        const beforeTable =
          beforeSource && mapSourceColumnKeyToTarget(beforeSource, slicerSource, snapshot)
        const next = { ...prev }
        if (columnKey === undefined) delete next[role]
        else next[role] = columnKey
        const afterMerged = mergeSlicerColumnKeys(autoSlicerKeys, next)
        const afterSource = afterMerged[role]
        const afterTable =
          afterSource && mapSourceColumnKeyToTarget(afterSource, slicerSource, snapshot)
        if (beforeTable && beforeTable !== afterTable) {
          queueMicrotask(() => {
            setColumnFilters((cf) => cf.filter((f) => f.id !== beforeTable))
          })
        }
        return next
      })
    },
    [autoSlicerKeys, slicerSource, snapshot],
  )

  const hideRow = useCallback((sourceIndex: number) => {
    setHiddenRows((prev) => {
      const next = new Set(prev)
      next.add(sourceIndex)
      return next
    })
  }, [])

  const unhideAllRows = useCallback(() => {
    setHiddenRows(new Set())
  }, [])

  const toggleFilterableColumn = useCallback((key: string, checked: boolean) => {
    setFilterableColumns((prev) => {
      const next = new Set(prev)
      if (checked) {
        next.add(key)
      } else {
        next.delete(key)
        setColumnFilters((cf) => cf.filter((f) => f.id !== key))
      }
      return next
    })
  }, [])

  const columns = useMemo(() => {
    const defs: ColumnDef<AugmentedRow, unknown>[] = snapshot.columns.map((c) => {
      const facet = facets[c.key] as ColumnFacet
      if (c.type === 'date' && facet.mode === 'daterange') {
        return {
          id: c.key,
          accessorKey: c.key,
          header: c.header,
          cell: (ctx) => (
            <span className="cell-text">{formatCellForDisplay(ctx.getValue(), c)}</span>
          ),
          sortingFn: 'alphanumeric',
          filterFn: (row, columnId, filterValue) => {
            const fv = filterValue as { from?: string; to?: string } | undefined
            if (!fv || (!fv.from && !fv.to)) return true
            const raw = row.getValue(columnId)
            const d = raw instanceof Date && !Number.isNaN(raw.getTime()) ? raw : null
            if (!d) return false
            const t = d.getTime()
            if (fv.from) {
              const fromT = new Date(`${fv.from}T00:00:00`).getTime()
              if (t < fromT) return false
            }
            if (fv.to) {
              const toT = new Date(`${fv.to}T23:59:59.999`).getTime()
              if (t > toT) return false
            }
            return true
          },
        }
      }
      return {
        id: c.key,
        accessorKey: c.key,
        header: c.header,
        cell: (ctx) => (
          <span className="cell-text">{formatCellForDisplay(ctx.getValue(), c)}</span>
        ),
        sortingFn: c.type === 'number' ? 'basic' : 'alphanumeric',
        filterFn: (row, columnId, filterValue) => {
          const display = formatCellForDisplay(row.getValue(columnId), c)
          if (Array.isArray(filterValue)) {
            if (filterValue.length === 0) return true
            return filterValue.includes(display)
          }
          if (facet.mode === 'select') {
            if (filterValue == null || filterValue === '') return true
            return display === String(filterValue)
          }
          const q = String(filterValue ?? '').trim().toLowerCase()
          if (!q) return true
          return display.toLowerCase().includes(q)
        },
      }
    })
    return [
      {
        id: '__rowIndex',
        header: '#',
        cell: (ctx) => {
          const src = ctx.row.original[SRC_ROW]
          return (
            <span className="row-index-wrap">
              <span className="row-index">{src + 1}</span>
              <button
                type="button"
                className="row-hide-btn"
                title="Hide this row"
                aria-label={`Hide row ${src + 1} from the table`}
                onClick={(e) => {
                  e.stopPropagation()
                  hideRow(src)
                }}
              >
                −
              </button>
            </span>
          )
        },
        enableSorting: false,
        enableHiding: true,
        size: 72,
      } satisfies ColumnDef<AugmentedRow, unknown>,
      ...defs,
    ]
  }, [snapshot.columns, facets, hideRow])

  const table = useReactTable({
    data: tableRows,
    columns,
    getRowId: (row) => String(row[SRC_ROW]),
    state: {
      sorting,
      globalFilter,
      columnFilters,
      columnVisibility,
      pagination,
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    globalFilterFn: (row, _cid, fv) => {
      const q = String(fv ?? '').toLowerCase().trim()
      if (!q) return true
      const obj = row.original
      return snapshot.columns.some((col) =>
        formatCellForDisplay(obj[col.key], col).toLowerCase().includes(q),
      )
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })

  const filteredCount = table.getFilteredRowModel().rows.length
  const hasActiveFilters =
    globalFilter.trim() !== '' ||
    columnFilters.some((f) => {
      const v = f.value
      if (v == null || v === '') return false
      if (Array.isArray(v)) return v.length > 0
      if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
        const r = v as { from?: string; to?: string }
        return Boolean(r.from || r.to)
      }
      return true
    })
  const isPivotLike = useMemo(() => {
    const firstCol = snapshot.columns[0]
    if (!firstCol) return false
    const header = firstCol.header.toLowerCase()
    if (header.includes('row labels') || header.includes('values')) return true
    const probe = snapshot.rows.slice(0, 20)
    const hits = probe.filter((r) => {
      const v = String(r[firstCol.key] ?? '').toLowerCase()
      return v.includes('values') || v.includes('grand total') || v.includes('total')
    }).length
    return hits >= 2
  }, [snapshot.columns, snapshot.rows])
  const filteredSourceRows = table.getFilteredRowModel().rows.map((r) => r.original)
  const pivotRowOptions = nonNumericColumns
  const canBuildPivot =
    pivotRows.length > 0 &&
    (pivotAggregation === 'count' || Boolean(pivotValue)) &&
    filteredSourceRows.length > 0
  const pivotResult = useMemo(() => {
    if (!canBuildPivot) {
      return { rows: [] as Array<Record<string, string | number>>, metricLabel: '' }
    }
    const metricColumn = snapshot.columns.find((c) => c.key === pivotValue)
    const metricLabel =
      pivotAggregation === 'count'
        ? 'Count'
        : `${pivotAggregation[0].toUpperCase()}${pivotAggregation.slice(1)} ${metricColumn?.header ?? ''}`.trim()

    const groups = new Map<string, { labels: string[]; values: number[] }>()
    for (const row of filteredSourceRows) {
      const labels = pivotRows.map((k) => {
        const col = snapshot.columns.find((x) => x.key === k) as ColumnSchema | undefined
        return formatCellForDisplay(row[k], col) || '(blank)'
      })
      const groupKey = labels.join(' || ')
      if (!groups.has(groupKey)) {
        groups.set(groupKey, { labels, values: [] })
      }
      const bucket = groups.get(groupKey)!
      if (pivotAggregation === 'count') {
        bucket.values.push(1)
      } else {
        const raw = row[pivotValue]
        if (typeof raw === 'number' && Number.isFinite(raw)) {
          bucket.values.push(raw)
        } else if (raw !== null && raw !== undefined && raw !== '') {
          const coerced = Number(String(raw).replace(/,/g, ''))
          if (Number.isFinite(coerced)) bucket.values.push(coerced)
        }
      }
    }

    const rows = [...groups.values()]
      .map((g) => {
        const out: Record<string, string | number> = {}
        pivotRows.forEach((k, idx) => {
          out[k] = g.labels[idx]
        })
        out.__metric = aggregate(g.values, pivotAggregation)
        return out
      })
      .sort((a, b) => {
        for (const k of pivotRows) {
          const left = String(a[k] ?? '')
          const right = String(b[k] ?? '')
          const cmp = left.localeCompare(right, undefined, { numeric: true })
          if (cmp !== 0) return cmp
        }
        return 0
      })

    return { rows, metricLabel }
  }, [canBuildPivot, filteredSourceRows, pivotAggregation, pivotRows, pivotValue, snapshot.columns])

  const exportCsv = () => {
    const rows = table
      .getFilteredRowModel()
      .rows.map((r) => {
        const { [SRC_ROW]: _i, ...rest } = r.original as AugmentedRow
        return rest as Record<string, unknown>
      })
    const mini: SheetSnapshot = { ...snapshot, rows }
    const csv = rowsToCsv(mini)
    const base = `${workbookName.replace(/\.[^.]+$/, '')}_${snapshot.name}`.replace(
      /\s+/g,
      '_',
    )
    triggerDownloadCsv(csv, base)
  }

  const clearColumnFilters = () => {
    setColumnFilters([])
    setGlobalFilter('')
  }
  const togglePivotRowField = (key: string, checked: boolean) => {
    setPivotRows((prev) => {
      if (checked) return [...new Set([...prev, key])]
      return prev.filter((k) => k !== key)
    })
  }

  const pagePresets = useMemo(() => {
    const presets = [100, 250, 500, 1000, 2500, 5000, 10_000]
    const set = new Set<number>()
    const cap = visibleAfterRowMask
    for (const p of presets) {
      if (p <= cap) set.add(p)
    }
    if (cap > 0) set.add(cap)
    if (set.size === 0 && cap > 0) set.add(cap)
    return [...set].sort((a, b) => a - b)
  }, [visibleAfterRowMask])

  const pageSelectValue =
    visibleAfterRowMask > 0 && pagination.pageSize >= visibleAfterRowMask
      ? 'all'
      : String(pagination.pageSize)

  if (snapshot.columns.length === 0) {
    return (
      <section className="card empty-card" aria-label="Data preview">
        <h2 className="card-title">Data preview</h2>
        <p className="empty-text">This sheet has no columns to display.</p>
      </section>
    )
  }

  return (
    <section
      className="card card--table card--pivot data-table-panel data-table-panel--excel-pink"
      aria-label="Data preview"
    >
      <div className="card-header table-toolbar table-toolbar--clean">
        <div>
          <h2 className="card-title">Data table</h2>
          <p className="card-desc card-desc--tight">
            {sourceRowCount.toLocaleString()} rows · {snapshot.columns.length} columns (empty
            rows/columns removed at import) · sort, filter, hide · CSV = current view.
          </p>
          {isPivotLike ? (
            <p className="pivot-hint pivot-hint--quiet">
              Pivot-style sheet — filters and totals supported.
            </p>
          ) : null}
        </div>
        <div className="table-actions">
          <label className="field field--inline">
            <span className="sr-only">Search table</span>
            <input
              className="input"
              placeholder="Search all columns…"
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn-secondary"
            disabled={!hasActiveFilters}
            onClick={clearColumnFilters}
          >
            Clear filters
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={hiddenRowCount === 0}
            onClick={unhideAllRows}
            title="Show every row you hid with the minus control"
          >
            Show hidden rows ({hiddenRowCount})
          </button>
          <div className="dropdown">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setLayoutOpen((v) => !v)}
              aria-expanded={layoutOpen}
            >
              Columns &amp; filters
            </button>
            {layoutOpen ? (
              <div className="dropdown-panel dropdown-panel--wide" role="menu">
                <p className="dropdown-section-title">Visible columns</p>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={table.getColumn('__rowIndex')?.getIsVisible() ?? true}
                    onChange={(e) => table.getColumn('__rowIndex')?.toggleVisibility(e.target.checked)}
                  />
                  <span>Row # / hide controls</span>
                </label>
                {snapshot.columns.map((c) => (
                  <label key={c.key} className="check-row">
                    <input
                      type="checkbox"
                      checked={table.getColumn(c.key)?.getIsVisible() ?? true}
                      onChange={(e) =>
                        table.getColumn(c.key)?.toggleVisibility(e.target.checked)
                      }
                    />
                    <span>{c.header}</span>
                  </label>
                ))}
                <p className="dropdown-section-title">Filter row (which headers are filterable)</p>
                <p className="dropdown-section-hint">
                  Date columns use From / To (like a pivot date filter). Uncheck a column to remove
                  its filter row (data still shows).
                </p>
                {snapshot.columns.map((c) => (
                  <label key={`f-${c.key}`} className="check-row">
                    <input
                      type="checkbox"
                      checked={filterableColumns.has(c.key)}
                      onChange={(e) => toggleFilterableColumn(c.key, e.target.checked)}
                    />
                    <span>{c.header}</span>
                  </label>
                ))}
              </div>
            ) : null}
          </div>
          <button type="button" className="btn-primary" onClick={exportCsv}>
            Export CSV
          </button>
        </div>
      </div>

      <SlicerFilters
        slicerSnapshot={slicerSource}
        effectiveResolved={effectiveOnSource}
        filterColumnKeyByRole={filterColumnKeyByRole}
        manualMap={slicerManual}
        onManualMap={onSlicerManualMap}
        getFilterValue={getSlicerFilterValue}
        setFilterValue={setSlicerFilterValue}
        isMulti={slicerIsMulti}
        dataSourceHint={
          slicerSource.name !== snapshot.name
            ? describeDatasheetSource(slicerSource.name, snapshot.name)
            : undefined
        }
      />

      <div className="table-meta-strip">
        <span>
          <strong>{filteredCount.toLocaleString()}</strong> rows after column filters
        </span>
        <span className="muted-inline">
          · <strong>{visibleAfterRowMask.toLocaleString()}</strong> in view after row mask
        </span>
        {hiddenRowCount > 0 ? (
          <span className="muted-inline">· {hiddenRowCount} row(s) hidden</span>
        ) : null}
        <span className="muted-inline">
          · {sourceRowCount.toLocaleString()} total in sheet
        </span>
      </div>
      <div className="pivot-toolbar">
        <p className="pivot-toolbar__title">Pivot</p>
        <button
          type="button"
          className="btn-secondary btn-pivot-toggle"
          onClick={() => setShowPivot((v) => !v)}
          aria-expanded={showPivot}
        >
          {showPivot ? 'Hide pivot fields & output' : 'Show pivot fields & output'}
        </button>
      </div>
      {showPivot ? (
        <>
          <section className="pivot-controls" aria-label="Pivot field controls">
            <div className="pivot-controls__grid">
              <div className="pivot-field">
                <p className="pivot-label">Rows</p>
                <div className="pivot-checklist">
                  {pivotRowOptions.length === 0 ? (
                    <p className="pivot-empty">No text/date columns found.</p>
                  ) : (
                    pivotRowOptions.map((c) => (
                      <label key={c.key} className="pivot-check">
                        <input
                          type="checkbox"
                          checked={pivotRows.includes(c.key)}
                          onChange={(e) => togglePivotRowField(c.key, e.target.checked)}
                        />
                        <span>{c.header}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>
              <label className="field pivot-field">
                <span className="pivot-label">Values</span>
                <select
                  className="select"
                  value={pivotValue}
                  onChange={(e) => setPivotValue(e.target.value)}
                  disabled={pivotAggregation === 'count'}
                >
                  <option value="">Select numeric column…</option>
                  {numericColumns.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.header}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field pivot-field">
                <span className="pivot-label">Aggregation</span>
                <select
                  className="select"
                  value={pivotAggregation}
                  onChange={(e) => setPivotAggregation(e.target.value as Aggregation)}
                >
                  {AGGREGATIONS.map((agg) => (
                    <option key={agg} value={agg}>
                      {agg[0].toUpperCase()}
                      {agg.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>
          <section className="pivot-result">
            {!canBuildPivot ? (
              <p className="pivot-empty">
                Pick at least one Row field and a Value field (unless using Count) to build a pivot.
              </p>
            ) : (
              <div className="table-wrap pivot-table-wrap">
                <table className="data-table pivot-table">
                  <thead>
                    <tr>
                      {pivotRows.map((k) => (
                        <th key={k}>{snapshot.columns.find((c) => c.key === k)?.header ?? k}</th>
                      ))}
                      <th>{pivotResult.metricLabel}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pivotResult.rows.map((r, idx) => {
                      const pivotTotal = rowLooksLikePivotTotal(
                        r as Record<string, unknown>,
                        snapshot.columns,
                      )
                      return (
                        <tr
                          key={`${idx}-${pivotRows.map((k) => r[k]).join('|')}`}
                          className={pivotTotal ? 'data-table-row--total' : undefined}
                        >
                          {pivotRows.map((k) => (
                            <td key={`${idx}-${k}`}>{String(r[k] ?? '')}</td>
                          ))}
                          <td>
                            {typeof r.__metric === 'number'
                              ? r.__metric.toLocaleString()
                              : r.__metric}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}

      <div className="table-wrap">
        <table className="data-table data-table--pivot">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <Fragment key={hg.id}>
                <tr>
                  {hg.headers.map((h) => (
                    <th key={h.id} scope="col">
                      {h.isPlaceholder ? null : (
                        <button
                          type="button"
                          className={`th-btn ${h.column.getCanSort() ? '' : 'th-btn--static'}`}
                          onClick={h.column.getToggleSortingHandler()}
                          disabled={!h.column.getCanSort()}
                        >
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {h.column.getIsSorted() === 'asc' ? ' ↑' : null}
                          {h.column.getIsSorted() === 'desc' ? ' ↓' : null}
                        </button>
                      )}
                    </th>
                  ))}
                </tr>
                <tr className="filter-row">
                  {hg.headers.map((h) => {
                    if (h.column.id === '__rowIndex') {
                      return (
                        <th key={`${h.id}-filter`} scope="col" className="filter-cell filter-cell--row-index">
                          <span className="row-index-hint">Row / hide</span>
                        </th>
                      )
                    }
                    if (h.isPlaceholder || !snapshot.columns.some((x) => x.key === h.column.id)) {
                      return <th key={`${h.id}-f`} className="filter-cell" scope="col" />
                    }
                    const colKey = h.column.id
                    const facet = facets[colKey]
                    const filterable = filterableColumns.has(colKey)
                    const schemaCol = snapshot.columns.find((x) => x.key === colKey)
                    const fromSlicer = slicerColumnKeySet.has(colKey)
                    const rawFv = h.column.getFilterValue() as
                      | string
                      | string[]
                      | { from?: string; to?: string }
                      | undefined
                    const val =
                      typeof rawFv === 'string'
                        ? rawFv
                        : Array.isArray(rawFv)
                          ? rawFv.join(', ')
                          : ''
                    const rangeVal =
                      typeof rawFv === 'object' &&
                      rawFv !== null &&
                      !Array.isArray(rawFv)
                        ? (rawFv as { from?: string; to?: string })
                        : { from: undefined as string | undefined, to: undefined as string | undefined }

                    return (
                      <th key={`${h.id}-filter`} scope="col" className="filter-cell">
                        {fromSlicer ? (
                          <span className="filter-slicer-hint" title="Controlled by slicers above">
                            Slicer
                          </span>
                        ) : filterable ? (
                          facet?.mode === 'daterange' ? (
                            <div className="filter-daterange">
                              <input
                                className="filter-input filter-input--date"
                                type="date"
                                aria-label={`${String(h.column.columnDef.header)} from`}
                                value={rangeVal.from ?? ''}
                                onChange={(e) => {
                                  const next = { ...rangeVal, from: e.target.value || undefined }
                                  h.column.setFilterValue(
                                    next.from || next.to ? next : undefined,
                                  )
                                }}
                              />
                              <input
                                className="filter-input filter-input--date"
                                type="date"
                                aria-label={`${String(h.column.columnDef.header)} to`}
                                value={rangeVal.to ?? ''}
                                onChange={(e) => {
                                  const next = { ...rangeVal, to: e.target.value || undefined }
                                  h.column.setFilterValue(
                                    next.from || next.to ? next : undefined,
                                  )
                                }}
                              />
                            </div>
                          ) : facet?.mode === 'select' ? (
                            <select
                              className="filter-select"
                              value={val}
                              aria-label={`Filter ${h.column.columnDef.header as string}`}
                              onChange={(e) =>
                                h.column.setFilterValue(e.target.value === '' ? undefined : e.target.value)
                              }
                            >
                              <option value="">All</option>
                              {facet.values.map((opt) => (
                                <option key={opt} value={opt}>
                                  {opt.length > 48 ? `${opt.slice(0, 45)}…` : opt}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              className="filter-input"
                              type="text"
                              placeholder={
                                schemaCol?.type === 'number' ? 'Contains #…' : 'Filter…'
                              }
                              value={val}
                              aria-label={`Filter ${h.column.columnDef.header as string}`}
                              onChange={(e) =>
                                h.column.setFilterValue(
                                  e.target.value === '' ? undefined : e.target.value,
                                )
                              }
                            />
                          )
                        ) : (
                          <span className="filter-disabled" title="Enable in Columns & filters">
                            —
                          </span>
                        )}
                      </th>
                    )
                  })}
                </tr>
              </Fragment>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => {
              const totalRow = rowLooksLikePivotTotal(
                row.original as Record<string, unknown>,
                snapshot.columns,
              )
              return (
                <tr
                  key={row.id}
                  className={totalRow ? 'data-table-row--total' : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="pager">
        <button
          type="button"
          className="btn-ghost"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
        >
          Previous
        </button>
        <span className="pager-meta">
          Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount() || 1}
        </span>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
        >
          Next
        </button>
        <label className="field field--compact">
          <span className="field-label-muted">Rows / page</span>
          <select
            className="select select--sm"
            value={pageSelectValue}
            onChange={(e) => {
              const raw = e.target.value
              if (raw === 'all') {
                table.setPageSize(Math.max(visibleAfterRowMask, 1))
                return
              }
              table.setPageSize(Number(raw))
            }}
          >
            {pagePresets.map((n) => (
              <option key={n} value={String(n)}>
                {n.toLocaleString()}
              </option>
            ))}
            <option value="all">
              All rows ({visibleAfterRowMask.toLocaleString()})
            </option>
          </select>
        </label>
      </div>
    </section>
  )
}

export const DataPreviewTable = memo(DataPreviewTableInner)
