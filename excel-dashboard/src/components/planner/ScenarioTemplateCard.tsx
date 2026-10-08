import { useState } from 'react'
import type { ScenarioTemplate } from '../../planner/types'

type Props = {
  template: ScenarioTemplate
  onApply: (templateId: string) => void
}

export function ScenarioTemplateCard({ template, onApply }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [appliedFlash, setAppliedFlash] = useState(false)

  const handleApply = () => {
    onApply(template.id)
    setAppliedFlash(true)
    window.setTimeout(() => setAppliedFlash(false), 2200)
  }

  return (
    <article className="cap-scenario-template">
      <header className="cap-scenario-template__head">
        <h4 className="cap-scenario-template__title">{template.name}</h4>
        <p className="cap-scenario-template__summary">{template.description}</p>
      </header>

      <button
        type="button"
        className="cap-scenario-template__more"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? 'Show less' : 'Learn more'}
      </button>

      {expanded ? (
        <div className="cap-scenario-template__details">
          <p className="cap-scenario-template__details-text">{template.details ?? template.description}</p>
        </div>
      ) : null}

      <div className="cap-scenario-template__actions">
        <button type="button" className="saas-btn saas-btn--secondary text-xs" onClick={handleApply}>
          Use this scenario
        </button>
        {appliedFlash ? <span className="cap-scenario-template__flash">Applied</span> : null}
      </div>
    </article>
  )
}

export { SCENARIO_TEMPLATES } from '../../planner/templates'
