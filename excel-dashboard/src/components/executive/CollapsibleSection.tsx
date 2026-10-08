import { type ReactNode, useState } from 'react'

type Props = {
  title: string
  subtitle?: string
  /** When false, body is collapsed on first render. */
  defaultExpanded?: boolean
  children: ReactNode
  className?: string
  id?: string
}

export function CollapsibleSection({
  title,
  subtitle,
  defaultExpanded = true,
  children,
  className = '',
  id,
}: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <section
      id={id}
      className={`collapsible-section ${expanded ? 'collapsible-section--open' : 'collapsible-section--closed'} ${className}`.trim()}
      aria-label={title}
    >
      <div className="collapsible-section__head">
        <div className="collapsible-section__titles">
          <h2 className="collapsible-section__title">{title}</h2>
          {subtitle ? <p className="collapsible-section__sub">{subtitle}</p> : null}
        </div>
        <button
          type="button"
          className="exec-chart-card__btn collapsible-section__toggle"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? 'Hide' : 'Show'}
        </button>
      </div>
      {expanded ? <div className="collapsible-section__body">{children}</div> : null}
    </section>
  )
}
