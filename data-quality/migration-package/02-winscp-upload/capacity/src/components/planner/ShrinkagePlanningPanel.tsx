import { useMemo, useState } from 'react'
import { fmtPct } from '../../planner/format'
import {
  createCustomShrinkageCategory,
  mergeShrinkageCategoryTemplates,
  shrinkageCategoryLabel,
  splitShrinkageCategoriesByGroup,
  type ShrinkageCategoryTemplate,
} from '../../planner/shrinkageCategories'
import type { DerivedCapacityRow } from '../../planner/capacityPlanDerived'
import { SoftPercentField } from './SoftPercentField'

type Props = {
  rows: DerivedCapacityRow[]
  categories?: ShrinkageCategoryTemplate[]
  visibleCategoryIds: string[]
  onVisibleCategoryIdsChange: (ids: string[]) => void
  onPlannedCategoryChange: (week: string, categoryId: string, value: number | null) => void
  getPlannedCategoryValue: (week: string, categoryId: string) => number | null
  onAddCategory?: (category: ShrinkageCategoryTemplate) => void
  onDeleteCategory?: (categoryId: string) => void
  disabled?: boolean
}

export function ShrinkagePlanningPanel({
  rows,
  categories = [],
  visibleCategoryIds,
  onVisibleCategoryIdsChange,
  onPlannedCategoryChange,
  getPlannedCategoryValue,
  onAddCategory,
  onDeleteCategory,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false)
  const [expandedWeek, setExpandedWeek] = useState<string | null>(null)
  const [addingGroup, setAddingGroup] = useState<'out_of_office' | 'in_office' | null>(null)
  const [newName, setNewName] = useState('')
  const [newBillable, setNewBillable] = useState(false)
  const forwardRows = useMemo(() => rows.filter((row) => row.timeline === 'forward_plan'), [rows])
  const customCategories = useMemo(() => mergeShrinkageCategoryTemplates(categories), [categories])
  const groupedCategories = useMemo(() => splitShrinkageCategoriesByGroup(customCategories), [customCategories])

  const toggleCategory = (categoryId: string) => {
    if (visibleCategoryIds.includes(categoryId)) {
      onVisibleCategoryIdsChange(visibleCategoryIds.filter((id) => id !== categoryId))
      return
    }
    onVisibleCategoryIdsChange([...visibleCategoryIds, categoryId])
  }

  const addCategory = () => {
    if (!onAddCategory || !addingGroup || !newName.trim()) return
    const created = createCustomShrinkageCategory(newName, addingGroup, newBillable)
    onAddCategory(created)
    onVisibleCategoryIdsChange([...visibleCategoryIds, created.id])
    setNewName('')
    setNewBillable(false)
    setAddingGroup(null)
  }

  const renderGroup = (label: string, group: 'out_of_office' | 'in_office', items: ShrinkageCategoryTemplate[]) => (
    <>
      <div className="cap-shrinkage-group-head">
        <span className="saas-muted text-xs">{label}</span>
        <button
          type="button"
          className="cap-shrinkage-add-btn"
          title={`Add ${label} + custom name`}
          disabled={disabled}
          onClick={() => {
            setAddingGroup(group)
            setNewName('')
            setNewBillable(false)
          }}
        >
          +
        </button>
      </div>
      {items.length === 0 ? (
        <span className="saas-muted text-xs">No custom {label.toLowerCase()} categories yet.</span>
      ) : (
        items.map((category) => (
          <span key={category.id} className="cap-shrinkage-chip-wrap">
            <button
              type="button"
              className={`cap-shrinkage-chip${visibleCategoryIds.includes(category.id) ? ' is-active' : ''}`}
              onClick={() => toggleCategory(category.id)}
              title={
                visibleCategoryIds.includes(category.id)
                  ? 'Hide from matrix (excluded from totals)'
                  : 'Show in matrix (included in totals)'
              }
            >
              {label} · {category.name}
              <span className="cap-shrinkage-chip__billing">
                {category.billable ? 'Billable' : 'Not Billable'}
              </span>
            </button>
            {onDeleteCategory ? (
              <button
                type="button"
                className="cap-shrinkage-row-delete"
                title={`Delete ${category.name}`}
                disabled={disabled}
                onClick={() => onDeleteCategory(category.id)}
              >
                Delete
              </button>
            ) : null}
          </span>
        ))
      )}
      {addingGroup === group ? (
        <div className="cap-shrinkage-add-form">
          <input
            className="cap-field__input"
            placeholder={`${label} name (e.g. PTO, Meeting)`}
            value={newName}
            autoFocus
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') addCategory()
              if (event.key === 'Escape') setAddingGroup(null)
            }}
          />
          <label className="cap-shrinkage-billable-toggle">
            <span className="saas-muted text-xs">Billing</span>
            <select
              className="cap-field__input"
              value={newBillable ? 'billable' : 'non_billable'}
              onChange={(event) => setNewBillable(event.target.value === 'billable')}
            >
              <option value="non_billable">Not Billable</option>
              <option value="billable">Billable</option>
            </select>
          </label>
          <button
            type="button"
            className="cap-capacity-sidecard__toggle is-active"
            onClick={addCategory}
            disabled={!newName.trim()}
          >
            Add
          </button>
          <button type="button" className="cap-capacity-sidecard__toggle" onClick={() => setAddingGroup(null)}>
            Cancel
          </button>
        </div>
      ) : null}
    </>
  )

  return (
    <div className="cap-capacity-sidecard">
      <div className="cap-capacity-sidecard__head">
        <div>
          <p className="cap-capacity-sidecard__eyebrow">Shrinkage</p>
          <h3 className="cap-capacity-sidecard__title">Custom categories</h3>
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
            Expand a week and type planned % for each visible category. Only Non-Billable overages count toward revenue
            leakages.
          </p>
          <div className="cap-shrinkage-category-chips">
            {renderGroup('Out of office', 'out_of_office', groupedCategories.outOfOffice)}
            {renderGroup('In office', 'in_office', groupedCategories.inOffice)}
          </div>
          <div className="cap-stage-attrition-list">
            {forwardRows.map((row) => {
              const isExpanded = expandedWeek === row.week
              const categoryTotal = visibleCategoryIds.reduce((sum, categoryId) => {
                const value = getPlannedCategoryValue(row.week, categoryId)
                return sum + (value ?? 0)
              }, 0)
              return (
                <div key={row.week} className="cap-stage-attrition-item">
                  <button
                    type="button"
                    className="cap-stage-attrition-item__head"
                    onClick={() => setExpandedWeek(isExpanded ? null : row.week)}
                  >
                    <span>{row.week}</span>
                    <span className="saas-muted">Total {fmtPct(categoryTotal || row.planned.shrinkagePct)}</span>
                  </button>
                  {isExpanded ? (
                    <div className="cap-stage-attrition-item__body">
                      {visibleCategoryIds.length === 0 ? (
                        <p className="saas-muted m-0 text-xs">
                          Add a custom category and keep it shown to enter planned %.
                        </p>
                      ) : (
                        visibleCategoryIds.map((categoryId) => (
                          <SoftPercentField
                            key={`${row.week}-${categoryId}`}
                            label={shrinkageCategoryLabel(categoryId, customCategories)}
                            value={getPlannedCategoryValue(row.week, categoryId)}
                            disabled={disabled}
                            placeholder="e.g. 4.5"
                            onChange={(next) => onPlannedCategoryChange(row.week, categoryId, next)}
                          />
                        ))
                      )}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
