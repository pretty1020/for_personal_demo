import { Fragment, useMemo, useRef, useState } from 'react'
import { StickyHorizontalScrollbar } from '../StickyHorizontalScrollbar'
import type { DerivedCapacityRow } from '../../planner/capacityPlanDerived'
import {
  aggregateCapacityRows,
  buildCapacityMatrixDisplayContext,
  CAPACITY_GROUP_LABELS,
  CAPACITY_MATRIX_GROUP_ORDER,
  getCapacityMatrixGroups,
  selectCapacityDisplayRows,
  type CapacityMatrixDisplayContext,
  type CapacityMatrixRowDef,
  type CapacityView,
} from '../../planner/capacityMatrixDisplay'
import {
  capacityReadOnlyCellClass,
  capacityStatusClass,
  capacityWeekHeaderClass,
  MAX_FUTURE_WEEKS,
} from '../../planner/capacityMatrixTheme'

function weekStatusLabel(timeline: DerivedCapacityRow['timeline']): 'Actual' | 'Planned' {
  return timeline === 'historical_actual' ? 'Actual' : 'Planned'
}

function metricCellValue(metric: CapacityMatrixRowDef, row: DerivedCapacityRow): number | null {
  if (row.timeline === 'forward_plan' && metric.futureValue) return metric.futureValue(row)
  return metric.value(row)
}

type Props = {
  rows: DerivedCapacityRow[]
  matrixContext: CapacityMatrixDisplayContext
  title?: string
  view?: CapacityView
  showFutureWeeks?: boolean
}

export function CapacityReadOnlyMatrix({
  rows,
  matrixContext,
  title = 'Capacity matrix',
  view = 'weekly',
  showFutureWeeks = true,
}: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    pipeline: true,
  })

  const matrixGroups = useMemo(() => getCapacityMatrixGroups(matrixContext), [matrixContext])

  const displayRows = useMemo(() => {
    const scoped = selectCapacityDisplayRows(rows, { showFutureWeeks })
    return aggregateCapacityRows(scoped, view)
  }, [rows, showFutureWeeks, view])

  /** Mirrored by a floating scrollbar when this matrix runs past the fold. */
  const scrollRef = useRef<HTMLDivElement | null>(null)

  if (!displayRows.length) {
    return <p className="saas-muted m-0 text-sm">No capacity rows to display.</p>
  }

  return (
    <>
      <div className="cap-ledger-table-wrap cap-ledger-table-wrap--capacity" ref={scrollRef}>
      <div className="cap-ledger-toolbar cap-ledger-toolbar--capacity mb-2">
        <div>
          <h3 className="m-0 text-base font-bold text-slate-900">{title}</h3>
          <p className="saas-muted m-0 text-xs">
            Capacity-aligned matrix — starts at plan creation week · next{' '}
            {showFutureWeeks ? MAX_FUTURE_WEEKS : 1} planned weeks.
          </p>
        </div>
        <div className="cap-matrix-legend" aria-label="Matrix cell legend">
          <span className="cap-matrix-legend__item">
            <span className="cap-ledger-matrix__week-status cap-ledger-matrix__week-status--actual">Actual</span>
            <span className="cap-matrix-legend__text">Historical actuals</span>
          </span>
          <span className="cap-matrix-legend__item">
            <span className="cap-ledger-matrix__week-status cap-ledger-matrix__week-status--planned">Planned</span>
            <span className="cap-matrix-legend__text">Scenario plan</span>
          </span>
        </div>
      </div>
      <table className="cap-ledger-matrix cap-ledger-matrix--single">
        <thead>
          <tr>
            <th className="cap-ledger-matrix__metric">Metric</th>
            {displayRows.map((row) => (
              <th key={row.week} className={capacityWeekHeaderClass(row.timeline)}>
                <div className="cap-ledger-matrix__week-stack">
                  <span className="cap-ledger-matrix__week-label">{row.week}</span>
                  <span className={capacityStatusClass(weekStatusLabel(row.timeline))}>
                    {weekStatusLabel(row.timeline)}
                  </span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {CAPACITY_MATRIX_GROUP_ORDER.map((groupId) => {
            const groupRows = matrixGroups[groupId] ?? []
            if (!groupRows.length) return null
            return (
              <Fragment key={groupId}>
                <tr className={`cap-ledger-matrix__group-row cap-ledger-matrix__group-row--${groupId}`}>
                  <th colSpan={displayRows.length + 1} className={`cap-ledger-matrix__group cap-ledger-matrix__group--${groupId}`}>
                    <button
                      type="button"
                      className={`cap-ledger-matrix__group-btn cap-ledger-matrix__group-btn--${groupId}${collapsed[groupId] ? '' : ' is-expanded'}`}
                      onClick={() => setCollapsed((prev) => ({ ...prev, [groupId]: !prev[groupId] }))}
                      aria-expanded={!collapsed[groupId]}
                    >
                      <span className="cap-ledger-matrix__group-chevron" aria-hidden>
                        {collapsed[groupId] ? '▸' : '▾'}
                      </span>
                      <span className="cap-ledger-matrix__group-accent" aria-hidden />
                      <span className="cap-ledger-matrix__group-label">{CAPACITY_GROUP_LABELS[groupId]}</span>
                    </button>
                  </th>
                </tr>
                {!collapsed[groupId]
                  ? groupRows.map((metric) => (
                      <tr
                        key={metric.id}
                        className={`cap-ledger-matrix__data-row cap-ledger-matrix__data-row--group-${groupId} cap-ledger-matrix__data-row--calculated`}
                      >
                        <th className="cap-ledger-matrix__metric-row">
                          <span className="cap-ledger-matrix__metric-label">{metric.label}</span>
                        </th>
                        {displayRows.map((row) => {
                          const raw = metricCellValue(metric, row)
                          const tone = metric.tone?.(raw) ?? 'neutral'
                          return (
                            <td key={`${metric.id}-${row.week}`} className={capacityReadOnlyCellClass(row.timeline, tone)}>
                              {metric.format(raw)}
                            </td>
                          )
                        })}
                      </tr>
                    ))
                  : null}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
      <StickyHorizontalScrollbar targetRef={scrollRef} label="Scroll the capacity matrix" />
    </>
  )
}

export { buildCapacityMatrixDisplayContext }
