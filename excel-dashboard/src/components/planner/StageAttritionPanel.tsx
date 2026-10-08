import { useState } from 'react'
import { StableNumberInput } from '../fields/StableNumberInput'
import { fmtPct } from '../../planner/format'
import type { PlannerAssumptions } from '../../planner/types'
import type { StageAttritionOverride } from '../../planner/capacityStageAttritionPersistence'

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
                <label key={`${stage}-${stageWeek}`} className="saas-field">
                  <span className="saas-field__label">
                    Week {stageWeek} {stage === 'training' ? 'Training' : 'Nesting'} attrition
                  </span>
                  <StableNumberInput
                    className="cap-field__input"
                    min={0}
                    max={100}
                    step={0.1}
                    disabled={disabled}
                    placeholder={fmtPct(defaultRate)}
                    value={override != null ? Math.round(override * 100000) / 1000 : ''}
                    onCommit={(parsed) => {
                      onChange(stage, stageWeek, parsed == null ? null : Math.max(0, parsed) / 100)
                    }}
                    aria-label={`Week ${stageWeek} ${stage} attrition percent`}
                  />
                  <span className="cap-panel__desc">Effective: {fmtPct(effective)} · carries to later stages</span>
                </label>
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
            Set planned attrition per training/nesting week. Unset stages use the LOB default rates and compound forward.
          </p>
          {renderStageGroup('training', trainingWeeks, assumptions.newHire.trainingAttritionRate)}
          {renderStageGroup('nesting', nestingWeeks, assumptions.newHire.nestingAttritionRate)}
        </div>
      ) : null}
    </div>
  )
}
