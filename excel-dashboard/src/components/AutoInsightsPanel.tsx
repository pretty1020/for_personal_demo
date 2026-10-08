import { useMemo } from 'react'
import type { SheetSnapshot } from '../types/dashboard'
import { buildColumnProfile } from '../utils/columnSemantics'
import { generateAutoInsights } from '../utils/insightsEngine'

export function AutoInsightsPanel(props: { snapshot: SheetSnapshot }) {
  const { snapshot } = props

  const insights = useMemo(() => {
    const profile = buildColumnProfile(snapshot)
    return generateAutoInsights(snapshot, profile)
  }, [snapshot])

  if (insights.length === 0) return null

  return (
    <section className="card card--insights" aria-label="Auto insights">
      <div className="card-header compact-header">
        <div>
          <h2 className="card-title">Auto insights</h2>
        </div>
      </div>
      <ul className="insights-list">
        {insights.map((ins, i) => (
          <li
            key={i}
            className={`insights-item insights-item--${ins.tone}`}
          >
            {ins.text}
          </li>
        ))}
      </ul>
    </section>
  )
}
