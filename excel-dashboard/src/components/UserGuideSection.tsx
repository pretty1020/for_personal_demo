type Props = {
  variant?: 'landing' | 'workspace'
}

export function UserGuideSection({ variant = 'workspace' }: Props) {
  if (variant === 'landing') {
    return (
      <section className="card card--guide card--guide-landing" aria-label="User guide">
        <div className="card-header">
          <div>
            <h2 className="card-title">User guide</h2>
            <p className="card-desc">Quick start for workforce capacity and financial simulation dashboards.</p>
          </div>
        </div>
        <ul className="guide-list guide-list--landing">
          <li>
            <strong>Financial Dashboard</strong> — Budget, actuals, projections, variance, and leakage. Use header filters
            for period and client.
          </li>
          <li>
            <strong>Capacity Plan</strong> — Staffing, volume, and operational leakage from workforce templates.
          </li>
          <li>
            <strong>Planning Scenario</strong> — Model scenarios, compare staffing and financial outcomes.
          </li>
        </ul>
      </section>
    )
  }

  return (
    <section className="card card--guide" aria-label="User guide">
      <div className="card-header">
        <div>
          <h2 className="card-title">User guide & definitions</h2>
          <p className="card-desc">Quick orientation for building trustworthy, presentation-ready visuals.</p>
        </div>
      </div>
      <div className="guide-grid">
        <article className="guide-card">
          <h3>Getting started</h3>
          <ol className="guide-list">
            <li>Upload an Excel workbook — every sheet is parsed once; data never leaves your tab.</li>
            <li>
              On the dashboard, click a <strong>sheet card</strong> — the original grid appears first, then analytics
              tables and charts.
            </li>
            <li>Build charts in the builder and add them to the canvas.</li>
          </ol>
        </article>
        <article className="guide-card">
          <h3>Filters</h3>
          <p className="guide-copy">
            Use period (month, quarter, H1, H2, full year), client, and week range where shown. Leakage totals roll up
            by calendar month from program weeks in that period.
          </p>
        </article>
        <article className="guide-card">
          <h3>Privacy</h3>
          <p className="guide-copy">No cloud storage or telemetry — workbooks stay on this device unless you export.</p>
        </article>
      </div>
    </section>
  )
}
