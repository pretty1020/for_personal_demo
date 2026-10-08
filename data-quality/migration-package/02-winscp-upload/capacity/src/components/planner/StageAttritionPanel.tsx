import { useState } from 'react'
import { fmtPct } from '../../planner/format'
import type { PlannerAssumptions } from '../../planner/types'
import type { StageAttritionOverride } from '../../planner/capacityStageAttritionPersistence'
import { SoftPercentField } from './SoftPercentField'

type Props = {
  assumptions: PlannerAssumptions
  overrides: StageAttritionOverride
  onChange: (stage: 'training' | 'nesting', stageWeek: number, value: number | null) => void
  disabled?: boolean
}

export function StageAttritionPanel({ assumptions, overrides, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const [expandedStage, setExpandedStage] = useState<string | null>(null)
  const trainingWeeks = Math.max(1, Math.round(assumptions.newHire.trainingWeeks))
  const nestingWeeks = Math.max(1, Math.round(assumptions.newHire.nestingWeeks))

  const renderStageGroup = (stage: 'training' | 'nesting', count: number, defaultRate: number) => {
    const key = `${stage}-group`
    const isExpanded = expandedStage === key
    return (
      <div key={key} className="cap-stage-attrition-item">
        <button
          type="button"
          className="cap-stage-attrition-item__head"
          onClick={() => setExpandedStage(isExpanded ? null : key)}
        >
          <span>{stage === 'training' ? 'Training' : 'Nesting'} stages</span>
          <span className="saas-muted">{count} week{count === 1 ? '' : 's'}</span>
        </button>
        {isExpanded ? (
          <div className="cap-stage-attrition-item__body">
            {Array.from({ length: count }, (_, index) => {
              const stageWeek = index + 1
              const override = overrides[stage]?.[stageWeek]
              const effective = override ?? defaultRate
              return (
                <SoftPercentField
                  key={`${stage}-${stageWeek}`}
                  label={`Week ${stageWeek} ${stage === 'training' ? 'Training' : 'Nesting'} attrition`}
                  value={override ?? null}
                  placeholder={formatPlaceholder(defaultRate)}
                  disabled={disabled}
                  onChange={(next) => onChange(stage, stageWeek, next)}
                  hint={`Effective: ${fmtPct(effective)} · blank uses LOB default · carries to later stages`}
                />
              )
            })}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="cap-capacity-sidecard">
      <div className="cap-capacity-sidecard__head">
        <div>
          <p className="cap-capacity-sidecard__eyebrow">Pipeline</p>
          <h3 className="cap-capacity-sidecard__title">Stage attrition</h3>
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
            Set planned attrition per training/nesting week. Leave blank to use the LOB default — values compound forward.
          </p>
          {renderStageGroup('training', trainingWeeks, assumptions.newHire.trainingAttritionRate)}
          {renderStageGroup('nesting', nestingWeeks, assumptions.newHire.nestingAttritionRate)}
        </div>
      ) : null}
    </div>
  )
}

function formatPlaceholder(rate: number): string {
  if (!Number.isFinite(rate)) return 'e.g. 5'
  return String(Math.round(rate * 10000) / 100)
}
