import { memo, useMemo, useState } from 'react'
import { getPivotRowPresentation, looksPivotLikeSheet } from '../utils/pivotRowStyle'

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toLocaleString()
  return String(v)
}

/** Keeps sheet switching snappy; full rows remain in the data table below. */
const MAX_RAW_ROWS_TO_RENDER = 4_000

interface RawMatrixTableProps {
  rawMatrix: (unknown | null)[][]
  sheetName: string
}

function RawMatrixTableInner(props: RawMatrixTableProps) {
  const { rawMatrix, sheetName } = props
  const [collapsedStarts, setCollapsedStarts] = useState<Set<number>>(() => new Set())

  const pivotLike = useMemo(() => looksPivotLikeSheet(rawMatrix), [rawMatrix])

  const { header, body, rowsOut, truncatedFromTotal } = useMemo(() => {
    if (!rawMatrix.length) {
      return {
        header: [] as unknown[],
        body: [] as (unknown | null)[][],
        rowsOut: [] as Array<{ row: (unknown | null)[]; bi: number; hidden: boolean }>,
        truncatedFromTotal: 0,
      }
    }
    const head = rawMatrix[0] ?? []
    const fullBody = rawMatrix.slice(1)
    const totalLen = fullBody.length
    let bod = fullBody
    let truncatedFromTotal = 0
    if (totalLen > MAX_RAW_ROWS_TO_RENDER) {
      bod = fullBody.slice(0, MAX_RAW_ROWS_TO_RENDER)
      truncatedFromTotal = totalLen
    }

    const pl = looksPivotLikeSheet(rawMatrix)
    let hideUntil = -1
    const out = bod.map((row, bi) => {
      if (hideUntil >= 0 && bi <= hideUntil) return { row, bi, hidden: true as const }
      const first = String(row[0] ?? '').trim()
      const isGroupStart = pl && first !== '' && bi + 1 < bod.length
      let skip = 0
      if (isGroupStart && collapsedStarts.has(bi)) {
        for (let j = bi + 1; j < bod.length; j++) {
          const fj = String(bod[j]?.[0] ?? '').trim()
          if (fj !== '') break
          skip++
        }
        if (skip > 0) hideUntil = bi + skip
      } else {
        hideUntil = -1
      }
      return { row, bi, hidden: false as const }
    })
    return { header: head, body: bod, rowsOut: out, truncatedFromTotal }
  }, [rawMatrix, collapsedStarts])

  const toggleGroup = (startBodyIndex: number) => {
    setCollapsedStarts((prev) => {
      const next = new Set(prev)
      if (next.has(startBodyIndex)) next.delete(startBodyIndex)
      else next.add(startBodyIndex)
      return next
    })
  }

  if (!rawMatrix.length) {
    return (
      <p className="rounded-xl border border-white/10 bg-slate-900/40 px-4 py-8 text-center text-sm text-slate-400">
        This worksheet is empty.
      </p>
    )
  }

  const colCount = header.length
  const totalDataRows = Math.max(0, rawMatrix.length - 1)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
        <span className="rounded-full bg-violet-500/20 px-3 py-1 font-medium text-violet-200">
          {pivotLike ? 'Pivot-style layout detected' : 'Grid view'}
        </span>
        <span>
          Sheet: <strong className="text-slate-200">{sheetName}</strong> · {totalDataRows.toLocaleString()}{' '}
          data rows
        </span>
        {truncatedFromTotal > MAX_RAW_ROWS_TO_RENDER ? (
          <span className="rounded-lg bg-amber-500/15 px-2 py-0.5 text-amber-200/95">
            Showing first {MAX_RAW_ROWS_TO_RENDER.toLocaleString()} rows here — use the data table for all
            rows.
          </span>
        ) : null}
      </div>
      <div className="max-h-[70vh] overflow-auto rounded-2xl border border-white/10 bg-slate-950/60 shadow-inner shadow-black/40">
        <table className="w-full min-w-max border-collapse text-left text-sm text-slate-200">
          <thead className="sticky top-0 z-20 bg-gradient-to-b from-slate-800 to-slate-900 shadow-md">
            <tr>
              {pivotLike ? (
                <th className="w-10 border-b border-white/10 px-1 py-2 text-center text-xs font-normal text-slate-500">
                  {/* expand */}
                </th>
              ) : null}
              {header.map((cell, i) => (
                <th
                  key={i}
                  className="border-b border-white/10 px-3 py-2.5 font-sans text-xs font-semibold uppercase tracking-wide text-violet-200/95"
                >
                  {formatCell(cell)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowsOut.map(({ row, bi, hidden }) => {
              if (hidden) return null
              const pres = getPivotRowPresentation(row, bi)
              const first = String(row[0] ?? '').trim()
              const canToggle =
                pivotLike &&
                first !== '' &&
                bi + 1 < body.length &&
                String(body[bi + 1]?.[0] ?? '').trim() === ''
              return (
                <tr
                  key={bi}
                  className={`border-b border-white/5 transition-colors hover:bg-violet-500/10 ${
                    bi % 2 === 1 ? 'bg-slate-900/50' : 'bg-slate-950/30'
                  } ${pres.bold ? 'bg-violet-900/25 font-semibold text-white' : ''}`}
                >
                  {pivotLike ? (
                    <td className="border-r border-white/5 px-1 py-1.5 text-center">
                      {canToggle ? (
                        <button
                          type="button"
                          className="rounded-md p-1 text-violet-300 hover:bg-white/10"
                          title="Collapse or expand following blank-header rows"
                          onClick={() => toggleGroup(bi)}
                          aria-expanded={!collapsedStarts.has(bi)}
                        >
                          {collapsedStarts.has(bi) ? '▶' : '▼'}
                        </button>
                      ) : (
                        <span className="text-slate-600">·</span>
                      )}
                    </td>
                  ) : null}
                  {Array.from({ length: colCount }).map((_, ci) => {
                    const cell = row[ci] ?? null
                    const pad = ci === 0 ? pres.indentPx : 0
                    return (
                      <td
                        key={ci}
                        style={{ paddingLeft: pad ? pad + 12 : undefined }}
                        className="max-w-[420px] whitespace-nowrap border-r border-white/5 px-3 py-1.5 font-mono text-[13px] text-slate-200 last:border-r-0"
                      >
                        <span className="inline-block overflow-hidden text-ellipsis align-middle">
                          {formatCell(cell)}
                        </span>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500/90">
        SheetJS flatten pivot visuals here; use the data table below for typed filters and charts.
      </p>
    </div>
  )
}

export const RawMatrixTable = memo(RawMatrixTableInner)
