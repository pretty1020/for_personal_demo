import { Fragment } from 'react'
import { DbeSoftDecimalInput } from './DbeSoftDecimalInput'
import {
  DBE_COST_MODES,
  DBE_REVENUE_ADJUSTMENT_EFFECTS,
  DBE_REVENUE_ADJUSTMENT_MODES,
  computeDbeMonth,
  createCostBreakdownItem,
  createCostItem,
  createRevenueAdjustment,
  DEFAULT_DBE_COST_ITEMS,
  dbeRemarkKey,
  formatFiscalMonthLabel,
  getDbeRowRemark,
  type DbeComputeOptions,
  type DbeCostItem,
  type DbeLobLine,
  type DbeRevenueAdjustment,
} from '../../planner/dbe/dbePersistence'

const currency = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

type Props = {
  line: DbeLobLine
  months: string[]
  resolveOptions: (month: string) => DbeComputeOptions | undefined
  onCostItemChange: (lineId: string, itemId: string, month: string, raw: string) => void
  onCostBreakdownChange: (lineId: string, itemId: string, subId: string, month: string, raw: string) => void
  onRowRemarkChange: (lineId: string, rowKey: string, text: string) => void
}

type RemarkCellProps = {
  value: string
  label: string
  onChange: (text: string) => void
}

export function DbeRemarkCell({ value, label, onChange }: RemarkCellProps) {
  return (
    <td className="cap-dbe-sheet__remark-cell">
      <textarea
        className="cap-dbe-sheet__remark-input"
        rows={2}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Add comment…"
        aria-label={label}
      />
    </td>
  )
}

/**
 * Empty means "use the row default", so the cell shows blank with the default as a
 * placeholder instead of a real number. Previously it echoed the default back as
 * text, which made a cleared cell instantly refill itself.
 */
function costInputValue(item: { months: Record<string, number | null> }, month: string): string {
  const raw = item.months[month]
  return raw === null || raw === undefined ? '' : String(raw)
}

export function DbeLineCostTable({
  line,
  months,
  resolveOptions,
  onCostItemChange,
  onCostBreakdownChange,
  onRowRemarkChange,
}: Props) {
  return (
    <div className="cap-dbe__sheet-wrap cap-dbe__cost-wrap">
      <h4 className="cap-dbe__cost-title">Cost table &amp; margin</h4>
      <table className="cap-dbe-sheet">
        <thead>
          <tr>
            <th>Cost &amp; margin</th>
            {months.map((month) => (
              <th key={month}>{formatFiscalMonthLabel(month)}</th>
            ))}
            <th className="cap-dbe-sheet__remark-head">Remarks</th>
          </tr>
        </thead>
        <tbody>
          {line.costItems.map((item) => (
            <Fragment key={item.id}>
              <tr>
                <td>
                  <strong>{item.label}</strong>
                  {item.breakdown.length === 0 ? (
                    <span className="cap-dbe-sheet__active-tag">
                      {' '}
                      {DBE_COST_MODES.find((mode) => mode.value === item.mode)?.label ?? item.mode}
                    </span>
                  ) : (
                    <span className="cap-dbe-sheet__active-tag"> breakdown</span>
                  )}
                </td>
                {months.map((month) => {
                  const computed = computeDbeMonth(line, month, resolveOptions(month))
                  const amount = computed.costByItem[item.id] ?? 0
                  if (item.breakdown.length > 0) {
                    return (
                      <td key={month} className="cap-dbe-sheet__computed">
                        {currency.format(amount)}
                      </td>
                    )
                  }
                  return (
                    <td key={month} className="cap-dbe-sheet__input-cell">
                      <DbeSoftDecimalInput
                        value={costInputValue(item, month)}
                        onChange={(raw) => onCostItemChange(line.id, item.id, month, raw)}
                        ariaLabel={`${item.label} ${formatFiscalMonthLabel(month)}`}
                        placeholder={String(item.defaultValue)}
                      />
                      <span className="cap-dbe__applied">{currency.format(amount)}</span>
                    </td>
                  )
                })}
                <DbeRemarkCell
                  value={getDbeRowRemark(line, dbeRemarkKey('cost', item.id))}
                  label={`Remarks — ${item.label}`}
                  onChange={(text) => onRowRemarkChange(line.id, dbeRemarkKey('cost', item.id), text)}
                />
              </tr>
              {item.breakdown.map((sub) => (
                <tr key={sub.id} className="cap-dbe-sheet__breakdown-row">
                  <td>↳ {sub.label}</td>
                  {months.map((month) => (
                    <td key={month} className="cap-dbe-sheet__input-cell">
                      <DbeSoftDecimalInput
                        value={costInputValue(sub, month)}
                        onChange={(raw) => onCostBreakdownChange(line.id, item.id, sub.id, month, raw)}
                        ariaLabel={`${sub.label} ${formatFiscalMonthLabel(month)}`}
                        placeholder={String(sub.defaultValue)}
                      />
                    </td>
                  ))}
                  <DbeRemarkCell
                    value={getDbeRowRemark(line, dbeRemarkKey('cost-bd', sub.id))}
                    label={`Remarks — ${sub.label}`}
                    onChange={(text) => onRowRemarkChange(line.id, dbeRemarkKey('cost-bd', sub.id), text)}
                  />
                </tr>
              ))}
            </Fragment>
          ))}
          <tr className="cap-dbe-sheet__total">
            <td>Total Cost</td>
            {months.map((month) => (
              <td key={month}>{currency.format(computeDbeMonth(line, month, resolveOptions(month)).totalCost)}</td>
            ))}
            <DbeRemarkCell
              value={getDbeRowRemark(line, dbeRemarkKey('total-cost'))}
              label="Remarks — Total Cost"
              onChange={(text) => onRowRemarkChange(line.id, dbeRemarkKey('total-cost'), text)}
            />
          </tr>
          <tr className="cap-dbe-sheet__total">
            <td>GM</td>
            {months.map((month) => (
              <td key={month}>{currency.format(computeDbeMonth(line, month, resolveOptions(month)).gm)}</td>
            ))}
            <DbeRemarkCell
              value={getDbeRowRemark(line, dbeRemarkKey('gm'))}
              label="Remarks — GM"
              onChange={(text) => onRowRemarkChange(line.id, dbeRemarkKey('gm'), text)}
            />
          </tr>
          <tr className="cap-dbe-sheet__total">
            <td>GM %</td>
            {months.map((month) => (
              <td key={month}>
                {computeDbeMonth(line, month, resolveOptions(month)).gmPct.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
                %
              </td>
            ))}
            <DbeRemarkCell
              value={getDbeRowRemark(line, dbeRemarkKey('gm-pct'))}
              label="Remarks — GM %"
              onChange={(text) => onRowRemarkChange(line.id, dbeRemarkKey('gm-pct'), text)}
            />
          </tr>
        </tbody>
      </table>
    </div>
  )
}

type FormEditorProps = {
  revenueAdjustments: DbeRevenueAdjustment[]
  costItems: DbeCostItem[]
  onRevenueAdjustmentsChange: (next: DbeRevenueAdjustment[]) => void
  onCostItemsChange: (next: DbeCostItem[]) => void
}

export function DbeFormMetricsEditor({
  revenueAdjustments,
  costItems,
  onRevenueAdjustmentsChange,
  onCostItemsChange,
}: FormEditorProps) {
  return (
    <>
      <div className="cap-dbe__defaults cap-dbe__metrics-editor">
        <div className="cap-dbe__defaults-head">
          <p className="cap-dbe__defaults-title">Custom revenue metrics (affect Total Revenue)</p>
          <button
            type="button"
            className="cap-dbe__btn"
            onClick={() => onRevenueAdjustmentsChange([...revenueAdjustments, createRevenueAdjustment()])}
          >
            + Add metric
          </button>
        </div>
        {revenueAdjustments.length === 0 ? (
          <p className="cap-dbe__field-hint">Optional. Add rows that add to or deduct from Total Revenue in $ or %.</p>
        ) : (
          <div className="cap-dbe__metric-list">
            {revenueAdjustments.map((adj) => (
              <div key={adj.id} className="cap-dbe__metric-row">
                <input
                  value={adj.label}
                  onChange={(event) =>
                    onRevenueAdjustmentsChange(
                      revenueAdjustments.map((item) =>
                        item.id === adj.id ? { ...item, label: event.target.value } : item,
                      ),
                    )
                  }
                  placeholder="Metric label"
                />
                <select
                  value={adj.mode}
                  onChange={(event) =>
                    onRevenueAdjustmentsChange(
                      revenueAdjustments.map((item) =>
                        item.id === adj.id
                          ? { ...item, mode: event.target.value as DbeRevenueAdjustment['mode'] }
                          : item,
                      ),
                    )
                  }
                >
                  {DBE_REVENUE_ADJUSTMENT_MODES.map((mode) => (
                    <option key={mode.value} value={mode.value}>
                      {mode.label}
                    </option>
                  ))}
                </select>
                <select
                  value={adj.effect}
                  onChange={(event) =>
                    onRevenueAdjustmentsChange(
                      revenueAdjustments.map((item) =>
                        item.id === adj.id
                          ? { ...item, effect: event.target.value as DbeRevenueAdjustment['effect'] }
                          : item,
                      ),
                    )
                  }
                >
                  {DBE_REVENUE_ADJUSTMENT_EFFECTS.map((effect) => (
                    <option key={effect.value} value={effect.value}>
                      {effect.label}
                    </option>
                  ))}
                </select>
                <DbeSoftDecimalInput
                  className="cap-field__input"
                  value={adj.defaultValue === 0 ? '' : String(adj.defaultValue)}
                  placeholder={adj.mode === 'percent' ? 'e.g. 2.5' : 'e.g. 1000'}
                  title="Default value used for months you have not overridden"
                  ariaLabel={`Default value — ${adj.label || 'revenue adjustment'}`}
                  onChange={(raw) =>
                    onRevenueAdjustmentsChange(
                      revenueAdjustments.map((item) =>
                        item.id === adj.id
                          ? { ...item, defaultValue: raw === '' ? 0 : Number(raw) || 0 }
                          : item,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  className="cap-dbe__link cap-dbe__link--danger"
                  onClick={() =>
                    onRevenueAdjustmentsChange(revenueAdjustments.filter((item) => item.id !== adj.id))
                  }
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="cap-dbe__defaults cap-dbe__metrics-editor">
        <div className="cap-dbe__defaults-head">
          <p className="cap-dbe__defaults-title">Cost table (People Cost, OPEX, GM)</p>
          <button
            type="button"
            className="cap-dbe__btn"
            onClick={() => onCostItemsChange([...costItems, createCostItem()])}
          >
            + Add cost item
          </button>
        </div>
        <div className="cap-dbe__metric-list">
          {costItems.map((item) => (
            <div key={item.id} className="cap-dbe__cost-block">
              <div className="cap-dbe__metric-row">
                <input
                  value={item.label}
                  onChange={(event) =>
                    onCostItemsChange(
                      costItems.map((row) =>
                        row.id === item.id ? { ...row, label: event.target.value } : row,
                      ),
                    )
                  }
                  placeholder="Cost item"
                />
                <select
                  value={item.mode}
                  onChange={(event) =>
                    onCostItemsChange(
                      costItems.map((row) =>
                        row.id === item.id
                          ? { ...row, mode: event.target.value as DbeCostItem['mode'] }
                          : row,
                      ),
                    )
                  }
                  disabled={item.breakdown.length > 0}
                >
                  {DBE_COST_MODES.map((mode) => (
                    <option key={mode.value} value={mode.value}>
                      {mode.label}
                    </option>
                  ))}
                </select>
                <DbeSoftDecimalInput
                  className="cap-field__input"
                  value={item.defaultValue === 0 ? '' : String(item.defaultValue)}
                  ariaLabel={`Default value — ${item.label || 'cost item'}`}
                  title="Default value used for months you have not overridden"
                  onChange={(raw) =>
                    onCostItemsChange(
                      costItems.map((row) =>
                        row.id === item.id
                          ? { ...row, defaultValue: raw === '' ? 0 : Number(raw) || 0 }
                          : row,
                      ),
                    )
                  }
                  placeholder="e.g. 5000"
                  disabled={item.breakdown.length > 0}
                />
                <button
                  type="button"
                  className="cap-dbe__btn"
                  onClick={() =>
                    onCostItemsChange(
                      costItems.map((row) =>
                        row.id === item.id
                          ? { ...row, breakdown: [...row.breakdown, createCostBreakdownItem()] }
                          : row,
                      ),
                    )
                  }
                >
                  + Breakdown
                </button>
                <button
                  type="button"
                  className="cap-dbe__link cap-dbe__link--danger"
                  onClick={() => onCostItemsChange(costItems.filter((row) => row.id !== item.id))}
                >
                  Remove
                </button>
              </div>
              {item.breakdown.map((sub) => (
                <div key={sub.id} className="cap-dbe__metric-row cap-dbe__metric-row--nested">
                  <span>↳</span>
                  <input
                    value={sub.label}
                    onChange={(event) =>
                      onCostItemsChange(
                        costItems.map((row) =>
                          row.id === item.id
                            ? {
                                ...row,
                                breakdown: row.breakdown.map((entry) =>
                                  entry.id === sub.id ? { ...entry, label: event.target.value } : entry,
                                ),
                              }
                            : row,
                        ),
                      )
                    }
                    placeholder="Breakdown label"
                  />
                  <DbeSoftDecimalInput
                    className="cap-field__input"
                    value={sub.defaultValue === 0 ? '' : String(sub.defaultValue)}
                    ariaLabel={`Default value — ${sub.label || 'breakdown item'}`}
                    title="Default value used for months you have not overridden"
                    onChange={(raw) =>
                      onCostItemsChange(
                        costItems.map((row) =>
                          row.id === item.id
                            ? {
                                ...row,
                                breakdown: row.breakdown.map((entry) =>
                                  entry.id === sub.id
                                    ? { ...entry, defaultValue: raw === '' ? 0 : Number(raw) || 0 }
                                    : entry,
                                ),
                              }
                            : row,
                        ),
                      )
                    }
                    placeholder="e.g. 1200"
                  />
                  <button
                    type="button"
                    className="cap-dbe__link cap-dbe__link--danger"
                    onClick={() =>
                      onCostItemsChange(
                        costItems.map((row) =>
                          row.id === item.id
                            ? { ...row, breakdown: row.breakdown.filter((entry) => entry.id !== sub.id) }
                            : row,
                        ),
                      )
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

export { DEFAULT_DBE_COST_ITEMS, createCostItem, createRevenueAdjustment }
