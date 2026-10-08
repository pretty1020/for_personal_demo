import { useMemo, useState } from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import type { StaffingEnrichedRow } from '../../utils/staffingCapacity/types'
import { effectiveBillingRate } from '../../utils/staffingCapacity/billingModel'

function fmtMoney(n: number | null | undefined, maxFrac = 0): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: maxFrac })
}

function fmtNum(n: number | null | undefined, d = 0): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toLocaleString(undefined, { maximumFractionDigits: d })
}

function fmtRateUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: n < 2 ? 4 : 2 })
}

function shrinkDisplay(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const frac = v > 1 ? v / 100 : v
  return `${fmtNum(frac * 100, 2)}%`
}

function hcShortage(r: StaffingEnrichedRow): number | null {
  if (r.requiredHc == null || r.activeProdHc == null) return null
  return Math.max(r.requiredHc - r.activeProdHc, 0)
}

function rowPctHandledVsFcst(r: StaffingEnrichedRow): number | null {
  const f = r.forecastVolume
  const h = r.actualHandledVolume
  if (f == null || !Number.isFinite(f) || f <= 0 || h == null || !Number.isFinite(h)) return null
  return (h / f) * 100
}

function rowPctOfferedVsFcst(r: StaffingEnrichedRow): number | null {
  const f = r.forecastVolume
  const o = r.actualOfferedVolume
  if (f == null || !Number.isFinite(f) || f <= 0 || o == null || !Number.isFinite(o)) return null
  return (o / f) * 100
}

function rowPctHandledVsOffered(r: StaffingEnrichedRow): number | null {
  const o = r.actualOfferedVolume
  const h = r.actualHandledVolume
  if (o == null || !Number.isFinite(o) || o <= 0 || h == null || !Number.isFinite(h)) return null
  return (h / o) * 100
}

function rowRiskClass(r: StaffingEnrichedRow, leakHi: number): string {
  const leak = r.totalRevenueLeakage ?? 0
  const short = hcShortage(r) ?? 0
  const shr = r.shrinkageVariance ?? 0
  const att = r.attritionVariance ?? 0
  const aht = r.ahtVariance ?? 0
  const hotLeak = leak >= leakHi && leakHi > 0
  const hotGap = short >= 4
  const hotShr = shr > 0.1
  const hotAtt = att > 8
  const hotAht = aht > 120
  if (hotLeak || hotGap || hotShr || hotAtt || hotAht) return 'bg-rose-50/95 ring-1 ring-rose-200/80'
  if (leak >= leakHi * 0.35 || short >= 2 || shr > 0.05 || att > 4 || aht > 60) return 'bg-amber-50/80 ring-1 ring-amber-200/70'
  return ''
}

function globalFilterFn(row: { original: StaffingEnrichedRow }, _cid: string, q: string): boolean {
  if (!q.trim()) return true
  const s = q.trim().toLowerCase()
  const r = row.original
  const hay = [
    r.client,
    r.lob,
    r.projectCode,
    r.weekStartDate,
    r.week,
    r.billingType,
    r.billingModel,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return hay.includes(s)
}

const columnHelper = createColumnHelper<StaffingEnrichedRow>()

export function StaffingCapacityPlanDataTable({ rows }: { rows: StaffingEnrichedRow[] }) {
  const [globalFilter, setGlobalFilter] = useState('')
  const [clientFilter, setClientFilter] = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const [lobFilter, setLobFilter] = useState('')

  const leakThreshold = useMemo(() => {
    const leaks = rows.map((r) => r.totalRevenueLeakage ?? 0).filter((v) => Number.isFinite(v) && v > 0)
    if (!leaks.length) return 75_000
    leaks.sort((a, b) => a - b)
    const idx = Math.min(leaks.length - 1, Math.floor(leaks.length * 0.85))
    return Math.max(leaks[idx] ?? 0, 25_000)
  }, [rows])

  const clients = useMemo(() => {
    const s = new Set<string>()
    for (const r of rows) if (r.client) s.add(r.client)
    return [...s].sort()
  }, [rows])

  const sites = useMemo(() => {
    const s = new Set<string>()
    for (const r of rows) {
      if (clientFilter && r.client !== clientFilter) continue
      if (r.location) s.add(r.location)
    }
    return [...s].sort()
  }, [rows, clientFilter])

  const lobs = useMemo(() => {
    const s = new Set<string>()
    for (const r of rows) {
      if (clientFilter && r.client !== clientFilter) continue
      if (siteFilter && r.location !== siteFilter) continue
      if (r.lob) s.add(r.lob)
    }
    return [...s].sort()
  }, [rows, clientFilter, siteFilter])

  const preFiltered = useMemo(() => {
    if (!clientFilter && !siteFilter && !lobFilter) return rows
    return rows.filter(
      (r) =>
        (!clientFilter || r.client === clientFilter) &&
        (!siteFilter || r.location === siteFilter) &&
        (!lobFilter || r.lob === lobFilter),
    )
  }, [rows, clientFilter, siteFilter, lobFilter])

  const columns = useMemo(
    () => [
      columnHelper.accessor((r) => r.weekStartDate || r.week, {
        id: 'week',
        header: 'Week start date',
        cell: (c) => c.getValue(),
      }),
      columnHelper.accessor('client', { header: 'Client', cell: (c) => c.getValue() }),
      columnHelper.accessor('lob', { header: 'LOB', cell: (c) => c.getValue() }),
      columnHelper.accessor('requiredHc', {
        header: 'Required HC',
        cell: (c) => fmtNum(c.getValue()),
        sortingFn: 'basic',
      }),
      columnHelper.accessor('activeProdHc', {
        header: 'Production HC',
        cell: (c) => fmtNum(c.getValue()),
        sortingFn: 'basic',
      }),
      columnHelper.accessor('trainingHc', {
        header: 'Training HC',
        cell: (c) => fmtNum(c.getValue()),
        sortingFn: 'basic',
      }),
      columnHelper.accessor('supportHc', {
        header: 'Support HC',
        cell: (c) => fmtNum(c.getValue()),
        sortingFn: 'basic',
      }),
      columnHelper.accessor('activeProdFte', {
        header: 'Active prod. FTE',
        cell: (c) => fmtNum(c.getValue(), 2),
        sortingFn: 'basic',
      }),
      columnHelper.accessor('availableFtePlanned', {
        id: 'availFtePl',
        header: 'Available FTE (planned)',
        cell: (c) => fmtNum(c.getValue(), 2),
        sortingFn: 'basic',
      }),
      columnHelper.accessor('availableFteActual', {
        id: 'availFteAct',
        header: 'Available FTE (actual)',
        cell: (c) => fmtNum(c.getValue(), 2),
        sortingFn: 'basic',
      }),
      columnHelper.accessor('plannedPaidProductionHours', {
        header: 'Planned paid prod. hrs',
        cell: (c) => fmtNum(c.getValue(), 1),
        sortingFn: 'basic',
      }),
      columnHelper.accessor('actualPaidProductionHours', {
        header: 'Actual paid prod. hrs',
        cell: (c) => fmtNum(c.getValue(), 1),
        sortingFn: 'basic',
      }),
      columnHelper.accessor('plannedNewHireClassHc', {
        header: 'Planned NH class (HC)',
        cell: (c) => fmtNum(c.getValue(), 0),
        sortingFn: 'basic',
      }),
      columnHelper.accessor('plannedNewHireTrainingHours', {
        header: 'Planned NH train. hrs',
        cell: (c) => fmtNum(c.getValue(), 1),
        sortingFn: 'basic',
      }),
      columnHelper.accessor('actualTrainingHours', {
        header: 'Actual training hrs',
        cell: (c) => fmtNum(c.getValue(), 1),
        sortingFn: 'basic',
      }),
      columnHelper.accessor((r) => effectiveBillingRate(r), {
        id: 'rate',
        header: 'Rate (USD)',
        cell: (c) => fmtRateUsd(c.getValue()),
        sortingFn: 'basic',
      }),
      columnHelper.accessor('billingType', { header: 'Billing type', cell: (c) => c.getValue() || '—' }),
      columnHelper.accessor('billingModel', {
        header: 'Billing model',
        cell: (c) => String(c.getValue() ?? '—'),
      }),
      columnHelper.accessor('hcOu', {
        header: 'HC gap (Act − Req)',
        cell: (c) => {
          const v = c.getValue()
          const cls =
            v != null && v < 0 ? 'text-rose-700 font-semibold' : v != null && v > 0 ? 'text-emerald-700 font-semibold' : 'text-slate-800'
          return <span className={cls}>{fmtNum(v)}</span>
        },
        sortingFn: 'basic',
      }),
      columnHelper.accessor('forecastVolume', {
        header: 'Forecast volume',
        cell: (c) => fmtNum(c.getValue()),
        sortingFn: 'basic',
      }),
      columnHelper.accessor('actualOfferedVolume', {
        id: 'actualOfferedVolume',
        header: 'Offered volume',
        cell: (c) => fmtNum(c.getValue()),
        sortingFn: 'basic',
      }),
      columnHelper.accessor('actualHandledVolume', {
        header: 'Actual handled',
        cell: (c) => fmtNum(c.getValue()),
        sortingFn: 'basic',
      }),
      columnHelper.accessor((r) => rowPctOfferedVsFcst(r), {
        id: 'otf',
        header: 'OTF %',
        cell: (c) => (c.getValue() == null ? '—' : `${fmtNum(c.getValue(), 1)}%`),
        sortingFn: 'basic',
      }),
      columnHelper.accessor((r) => rowPctHandledVsFcst(r), {
        id: 'htf',
        header: 'HTF %',
        cell: (c) => (c.getValue() == null ? '—' : `${fmtNum(c.getValue(), 1)}%`),
        sortingFn: 'basic',
      }),
      columnHelper.accessor((r) => rowPctHandledVsOffered(r), {
        id: 'hto',
        header: 'HTO %',
        cell: (c) => (c.getValue() == null ? '—' : `${fmtNum(c.getValue(), 1)}%`),
        sortingFn: 'basic',
      }),
      columnHelper.accessor('volumeGap', {
        header: 'Volume gap',
        cell: (c) => fmtNum(c.getValue()),
        sortingFn: 'basic',
      }),
      columnHelper.accessor('offeredVsForecastGap', {
        header: 'Offered − Fcst',
        cell: (c) => fmtNum(c.getValue()),
        sortingFn: 'basic',
      }),
      columnHelper.accessor('handledVsForecastGap', {
        header: 'Handled − Fcst',
        cell: (c) => fmtNum(c.getValue()),
        sortingFn: 'basic',
      }),
      columnHelper.accessor('plannedShrinkPct', {
        header: 'Planned shrink',
        cell: (c) => shrinkDisplay(c.getValue()),
      }),
      columnHelper.accessor('actualShrinkPct', {
        header: 'Actual shrink',
        cell: (c) => shrinkDisplay(c.getValue()),
      }),
      columnHelper.accessor('plannedInOfficeShrinkPct', {
        header: 'Planned in-office shrink',
        cell: (c) => shrinkDisplay(c.getValue()),
      }),
      columnHelper.accessor('actualInOfficeShrinkPct', {
        header: 'Actual in-office shrink',
        cell: (c) => shrinkDisplay(c.getValue()),
      }),
      columnHelper.accessor('plannedOutOfficeShrinkPct', {
        header: 'Planned out-of-office shrink',
        cell: (c) => shrinkDisplay(c.getValue()),
      }),
      columnHelper.accessor('actualOutOfficeShrinkPct', {
        header: 'Actual out-of-office shrink',
        cell: (c) => shrinkDisplay(c.getValue()),
      }),
      columnHelper.accessor('plannedAttrition', {
        header: 'Planned attrition',
        cell: (c) => fmtNum(c.getValue(), 2),
        sortingFn: 'basic',
      }),
      columnHelper.accessor('actualAttrition', {
        header: 'Actual attrition',
        cell: (c) => fmtNum(c.getValue(), 2),
        sortingFn: 'basic',
      }),
      columnHelper.accessor('plannedTrainingAttrition', {
        header: 'Planned training attrition',
        cell: (c) => fmtNum(c.getValue(), 2),
        sortingFn: 'basic',
      }),
      columnHelper.accessor('actualTrainingAttrition', {
        header: 'Actual training attrition',
        cell: (c) => fmtNum(c.getValue(), 2),
        sortingFn: 'basic',
      }),
      columnHelper.accessor('plannedAht', {
        header: 'Planned AHT (sec)',
        cell: (c) => fmtNum(c.getValue(), 0),
        sortingFn: 'basic',
      }),
      columnHelper.accessor('cappedAht', {
        header: 'Capped AHT (sec)',
        cell: (c) => fmtNum(c.getValue(), 0),
        sortingFn: 'basic',
      }),
      columnHelper.accessor('actualAht', {
        header: 'Actual AHT (sec)',
        cell: (c) => fmtNum(c.getValue(), 0),
        sortingFn: 'basic',
      }),
      columnHelper.accessor('shrinkageVariance', {
        header: 'Shrink var (pts)',
        cell: (c) => {
          const v = c.getValue()
          return v == null ? '—' : `${fmtNum(v * 100, 2)}`
        },
        sortingFn: 'basic',
      }),
      columnHelper.accessor('attritionVariance', {
        header: 'Attr var',
        cell: (c) => fmtNum(c.getValue(), 2),
        sortingFn: 'basic',
      }),
      columnHelper.accessor('ahtVariance', {
        header: 'AHT var (sec)',
        cell: (c) => fmtNum(c.getValue(), 0),
        sortingFn: 'basic',
      }),
      columnHelper.accessor('hcLeakage', {
        header: 'HC leakage',
        cell: (c) => fmtMoney(c.getValue()),
        sortingFn: 'basic',
      }),
      columnHelper.accessor('volumeLeakage', {
        header: 'Volume leakage',
        cell: (c) => fmtMoney(c.getValue()),
        sortingFn: 'basic',
      }),
      columnHelper.accessor('shrinkageLeakage', {
        header: 'Shrinkage leakage',
        cell: (c) => fmtMoney(c.getValue()),
        sortingFn: 'basic',
      }),
      columnHelper.accessor('attritionLeakage', {
        header: 'Attrition leakage',
        cell: (c) => fmtMoney(c.getValue()),
        sortingFn: 'basic',
      }),
      columnHelper.accessor('ahtLeakage', {
        header: 'AHT leakage',
        cell: (c) => fmtMoney(c.getValue()),
        sortingFn: 'basic',
      }),
      columnHelper.accessor('totalRevenueLeakage', {
        header: 'Total revenue leakage',
        cell: (c) => fmtMoney(c.getValue()),
        sortingFn: 'basic',
      }),
    ],
    [],
  )

  const table = useReactTable({
    data: preFiltered,
    columns,
    state: { globalFilter },
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 25 } },
    getRowId: (row, i) => `${row.weekStartDate}-${row.projectCode}-${row.client}-${row.lob}-${i}`,
  })


  return (
    <div className={`${MV_TABLE_CARD} overflow-hidden`}>
      <div className="border-b border-violet-100 bg-gradient-to-r from-violet-50/90 via-white to-orange-50/40 px-5 py-4">
        <h3 className="m-0 text-base font-bold text-violet-950">Staffing &amp; leakage detail</h3>
        <p className="mt-1 text-sm text-slate-600">
          Search, sort, and paginate row-level metrics. Client / LOB filters apply before search.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="flex min-w-[160px] flex-col gap-1 text-xs font-semibold text-slate-600">
            Search
            <input
              type="search"
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder="Client, LOB, week start…"
              className="rounded-lg border border-violet-200/90 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-fuchsia-400 focus:ring-2 focus:ring-fuchsia-200/60"
            />
          </label>
          <label className="flex min-w-[140px] flex-col gap-1 text-xs font-semibold text-slate-600">
            Client
            <select
              value={clientFilter}
              onChange={(e) => {
                setClientFilter(e.target.value)
                setSiteFilter('')
                setLobFilter('')
              }}
              className="rounded-lg border border-violet-200/90 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-fuchsia-400 focus:ring-2 focus:ring-fuchsia-200/60"
            >
              <option value="">All</option>
              {clients.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-[140px] flex-col gap-1 text-xs font-semibold text-slate-600">
            Site
            <select
              value={sites.includes(siteFilter) ? siteFilter : ''}
              onChange={(e) => {
                setSiteFilter(e.target.value)
                setLobFilter('')
              }}
              className="rounded-lg border border-violet-200/90 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-fuchsia-400 focus:ring-2 focus:ring-fuchsia-200/60"
            >
              <option value="">All</option>
              {sites.map((site) => (
                <option key={site} value={site}>
                  {site}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-[140px] flex-col gap-1 text-xs font-semibold text-slate-600">
            LOB
            <select
              value={lobFilter}
              onChange={(e) => setLobFilter(e.target.value)}
              className="rounded-lg border border-violet-200/90 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-fuchsia-400 focus:ring-2 focus:ring-fuchsia-200/60"
            >
              <option value="">All</option>
              {lobs.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

        </div>
      </div>
      <div className="max-h-[min(72vh,780px)] overflow-auto">
        <table className="w-full min-w-[2200px] border-collapse text-left text-xs">
          <thead className="sticky top-0 z-20 border-b border-violet-200 bg-gradient-to-b from-violet-100 to-violet-50/98 shadow-sm">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id} className="whitespace-nowrap px-2.5 py-2.5 text-[10px] font-bold uppercase tracking-wide text-violet-900">
                    {h.isPlaceholder ? null : (
                      <button
                        type="button"
                        className={
                          h.column.getCanSort()
                            ? 'inline-flex cursor-pointer select-none items-center gap-1 rounded-md border border-transparent px-1 py-0.5 text-left hover:border-violet-200 hover:bg-white/80'
                            : undefined
                        }
                        onClick={h.column.getToggleSortingHandler()}
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {h.column.getIsSorted() === 'asc' ? ' ↑' : h.column.getIsSorted() === 'desc' ? ' ↓' : null}
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {table.getRowModel().rows.map((row, idx) => {
              const risk = rowRiskClass(row.original, leakThreshold)
              const zebra = idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'
              return (
                <tr key={row.id} className={`${zebra} hover:bg-violet-50/50 ${risk}`.trim()}>
                  {row.getVisibleCells().map((cell) => {
                    const textCol = ['week', 'client', 'lob', 'billingType', 'billingModel'].includes(cell.column.id)
                    return (
                      <td
                        key={cell.id}
                        className={`whitespace-nowrap px-2.5 py-2 ${textCol ? 'text-left font-medium text-slate-900' : 'text-right tabular-nums text-slate-800'}`}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-violet-100 bg-slate-50/40 px-4 py-3 text-xs text-slate-600">
        <span>
          Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount() || 1} · {table.getFilteredRowModel().rows.length} row(s) in view
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 font-semibold">
            Rows
            <select
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-800"
              value={table.getState().pagination.pageSize}
              onChange={(e) => table.setPageSize(Number(e.target.value))}
            >
              {[10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className={BTN_TINY} onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
            Prev
          </button>
          <button type="button" className={BTN_TINY} onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
            Next
          </button>
        </div>
      </div>
    </div>
  )
}

const MV_TABLE_CARD =
  'cap-data-table-wrap rounded-2xl border border-violet-200/80 bg-white/95 shadow-md ring-1 ring-orange-200/20'

const BTN_TINY =
  'rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-40'
