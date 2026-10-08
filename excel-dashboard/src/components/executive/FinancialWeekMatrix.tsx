import { useMemo, useState, type ReactNode } from 'react'
import type { ExecutiveUnifiedRow } from '../../types/dashboard'
import {
  buildFinancialWeekMatrix,
  FINANCIAL_MATRIX_ROWS,
  FINANCIAL_MATRIX_SECTIONS,
  formatFinancialCell,
  financialMatrixTone,
} from '../../utils/financialWeekMatrix'

type Props = {
  rows: ExecutiveUnifiedRow[]
}

export function FinancialWeekMatrix({ rows }: Props) {
  const matrix = useMemo(() => buildFinancialWeekMatrix(rows), [rows])
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(FINANCIAL_MATRIX_SECTIONS.map((s) => [s.id, false])),
  )

  if (!matrix.weeks.length) {
    return <p className="saas-muted text-sm">No weekly financial data in the current filter.</p>
  }

  const allExpanded = FINANCIAL_MATRIX_SECTIONS.every((s) => expanded[s.id])

  return (
    <div className="pva-ref-wrap cap-fin-matrix">
      <div className="pva-ref-toolbar">
        <span>Financial week matrix</span>
        <button
          type="button"
          className="pva-ref-expand-btn"
          onClick={() => {
            const next = !allExpanded
            setExpanded(Object.fromEntries(FINANCIAL_MATRIX_SECTIONS.map((s) => [s.id, next])))
          }}
        >
          {allExpanded ? 'Collapse all' : 'Expand all'}
        </button>
      </div>
      <div className="pva-ref-scroll">
        <table className="pva-ref-table">
          <thead>
            <tr>
              <th className="pva-ref-table__metric-col" colSpan={2}>
                Metric
              </th>
              {matrix.weekLabels.map((label, i) => (
                <th key={matrix.weeks[i]} className="pva-ref-table__week-col">
                  {label}
                </th>
              ))}
            </tr>
            <tr className="pva-ref-table__weeks-row">
              <th colSpan={2} className="pva-ref-table__weeks-label">
                Weeks →
              </th>
              {matrix.weeks.map((w, i) => (
                <th key={`sub-${w}`} className="pva-ref-table__week-sub">
                  W{i + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FINANCIAL_MATRIX_SECTIONS.map((section) => {
              const sectionRows = FINANCIAL_MATRIX_ROWS.filter((r) => r.sectionId === section.id)
              const isOpen = expanded[section.id]
              return (
                <SectionBlock
                  key={section.id}
                  title={section.title}
                  isOpen={isOpen}
                  colSpan={matrix.weeks.length + 2}
                  onToggle={() => setExpanded((e) => ({ ...e, [section.id]: !e[section.id] }))}
                >
                  {isOpen
                    ? sectionRows.map((row) => (
                        <tr key={row.id} className="pva-ref-table__data-row">
                          <td className="pva-ref-table__indent" />
                          <td className="pva-ref-table__metric">{row.label}</td>
                          {(matrix.values[row.id] ?? []).map((value, wi) => {
                            const tone = financialMatrixTone(row.id, value)
                            return (
                              <td key={`${row.id}-${wi}`} className={`pva-ref-table__num pva-ref-table__num--${tone}`}>
                                {formatFinancialCell(row.id, value)}
                              </td>
                            )
                          })}
                        </tr>
                      ))
                    : null}
                </SectionBlock>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
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
            <span className="pva-ref-cat-btn__chev" aria-hidden>
              {isOpen ? '▼' : '▶'}
            </span>
            {title}
          </button>
        </td>
      </tr>
      {children}
    </>
  )
}
