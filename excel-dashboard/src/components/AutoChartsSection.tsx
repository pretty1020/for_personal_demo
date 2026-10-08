import { useMemo } from 'react'
import type { SheetSnapshot } from '../types/dashboard'
import { buildAutoChartDrafts } from '../utils/autoChartDrafts'
import { buildColumnProfile } from '../utils/columnSemantics'
import { ChartVisualization } from './ChartVisualization'

export function AutoChartsSection(props: { snapshot: SheetSnapshot }) {
  const { snapshot } = props

  const specs = useMemo(() => {
    const profile = buildColumnProfile(snapshot)
    return buildAutoChartDrafts(snapshot, profile)
  }, [snapshot])

  if (specs.length === 0) {
    return (
      <section className="card empty-card" aria-label="Auto charts">
        <h2 className="card-title">Auto charts</h2>
        <p className="empty-text">Add numeric columns to generate instant trend and breakdown views.</p>
      </section>
    )
  }

  return (
    <section className="card card--autocharts" aria-label="Auto charts">
      <div className="card-header compact-header">
        <div>
          <h2 className="card-title">Auto charts</h2>
          <p className="card-desc">
            Generated from detected date, category, and measure fields on cleaned rows.
          </p>
        </div>
      </div>
      <div className="autocharts-grid">
        {specs.map((spec, idx) => (
          <article key={`${spec.title}-${idx}`} className="autochart-tile">
            <h3 className="autochart-tile__title">{spec.title}</h3>
            <div className="autochart-tile__chart">
              <ChartVisualization
                snapshot={snapshot}
                draft={spec.draft}
                height={260}
                title=""
              />
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
