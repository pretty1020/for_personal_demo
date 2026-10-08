import { useEffect, useId, useMemo, useState } from 'react'
import {
  USER_GUIDE_INTRO,
  USER_GUIDE_SECTIONS,
  downloadUserGuide,
  filterUserGuideSections,
  type UserGuideSection as GuideSection,
} from '../../content/userGuide'

type Props = {
  /** Compact layout for sign-in landing column */
  variant?: 'default' | 'compact'
}

function scrollToGuide() {
  document.getElementById('user-guide')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export function scrollToUserGuide() {
  scrollToGuide()
}

function GuideAccordionItem({
  section,
  expanded,
  onToggle,
  panelId,
  buttonId,
}: {
  section: GuideSection
  expanded: boolean
  onToggle: () => void
  panelId: string
  buttonId: string
}) {
  return (
    <article className={`user-guide__item${expanded ? ' user-guide__item--open' : ''}`}>
      <h3 className="user-guide__item-title">
        <button
          type="button"
          id={buttonId}
          className="user-guide__trigger"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={onToggle}
        >
          <span className="user-guide__trigger-label">{section.title}</span>
          <span className="user-guide__chevron" aria-hidden>
            {expanded ? '−' : '+'}
          </span>
        </button>
      </h3>
      <p className="user-guide__summary">{section.summary}</p>
      <div
        id={panelId}
        role="region"
        aria-labelledby={buttonId}
        hidden={!expanded}
        className="user-guide__panel"
      >
        <ol className="user-guide__steps">
          {section.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        {section.tips.length ? (
          <ul className="user-guide__tips">
            {section.tips.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </article>
  )
}

export function UserGuideSection({ variant = 'default' }: Props) {
  const baseId = useId()
  const [query, setQuery] = useState('')
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set([USER_GUIDE_SECTIONS[0]!.id]))

  const sections = useMemo(() => filterUserGuideSections(query), [query])

  const toggle = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const expandAll = () => setOpenIds(new Set(sections.map((s) => s.id)))
  const collapseAll = () => setOpenIds(new Set())

  useEffect(() => {
    if (window.location.hash !== '#user-guide') return
    const timer = window.setTimeout(() => scrollToGuide(), 80)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <section
      id="user-guide"
      className={`user-guide saas-card${variant === 'compact' ? ' user-guide--compact' : ''}`}
      aria-labelledby={`${baseId}-title`}
    >
      <header className="user-guide__head">
        <div className="user-guide__brand">
          <div>
            <h2 id={`${baseId}-title`} className="user-guide__title">
              How to use Capacity Planning
            </h2>
            <p className="user-guide__lead">{USER_GUIDE_INTRO}</p>
            <p className="user-guide__badge" aria-label="Available to all roles">
              All roles
            </p>
          </div>
        </div>
        <div className="user-guide__toolbar">
          <label className="user-guide__search">
            <span className="sr-only">Search guide</span>
            <input
              type="search"
              className="cap-field__input user-guide__search-input"
              placeholder="Search topics…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoComplete="off"
            />
          </label>
          <div className="user-guide__toolbar-actions">
            <button type="button" className="cap-link" onClick={expandAll}>
              Expand all
            </button>
            <button type="button" className="cap-link" onClick={collapseAll}>
              Collapse all
            </button>
            <button type="button" className="saas-btn saas-btn--secondary user-guide__download" onClick={downloadUserGuide}>
              Download PDF guide
            </button>
          </div>
        </div>
      </header>

      {sections.length === 0 ? (
        <p className="user-guide__empty saas-muted">No topics match your search. Try “schedule”, “matrix”, or “users”.</p>
      ) : (
        <div className="user-guide__list">
          {sections.map((section) => {
            const expanded = openIds.has(section.id)
            const slug = `${baseId}-${section.id}`
            return (
              <GuideAccordionItem
                key={section.id}
                section={section}
                expanded={expanded}
                onToggle={() => toggle(section.id)}
                buttonId={`${slug}-btn`}
                panelId={`${slug}-panel`}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}
