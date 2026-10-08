import { fmtNum, fmtPct } from '../../planner/format'
import type { CompanyHierarchy } from '../../planner/companyHierarchy'
import type { ClientPortfolioSummary } from '../../planner/executivePortfolioTotals'

type Props = {
  hierarchy: CompanyHierarchy
  onOpenLob: (scenarioId: string) => void
  onOpenCombined: (clientName: string) => void
  onAddLob?: (clientId: string) => void
  onExecutiveSummary?: () => void
  onDeleteLob?: (scenarioId: string, label: string) => void
  clientSummaries?: ClientPortfolioSummary[]
  emptyMessage?: string
}

function money(value: number): string {
  return `$${fmtNum(value, 0)}`
}

export function CompanyHierarchyPanel({
  hierarchy,
  onOpenLob,
  onOpenCombined,
  onAddLob,
  onExecutiveSummary,
  onDeleteLob,
  clientSummaries = [],
  emptyMessage = 'No clients yet. Use New client to run the setup wizard.',
}: Props) {
  const summaryByLabel = new Map(clientSummaries.map((item) => [item.clientLabel, item]))

  return (
    <section className="portfolio-hierarchy saas-card">
      <header className="portfolio-hierarchy__head">
        <div>
          <h2 className="portfolio-hierarchy__title m-0">Company hierarchy</h2>
          {hierarchy.clients.length > 0 ? (
            <p className="portfolio-hierarchy__subtitle m-0">
              {hierarchy.clients.length} client{hierarchy.clients.length === 1 ? '' : 's'} ·{' '}
              {hierarchy.clients.reduce((sum, client) => sum + client.lobs.length, 0)} LOB
              {hierarchy.clients.reduce((sum, client) => sum + client.lobs.length, 0) === 1 ? '' : 's'}
            </p>
          ) : null}
        </div>
        {onExecutiveSummary ? (
          <button type="button" className="saas-btn saas-btn--secondary portfolio-hierarchy__exec-btn" onClick={onExecutiveSummary}>
            Executive summary
          </button>
        ) : null}
      </header>

      <div className="portfolio-hierarchy__tree">
        <div className="portfolio-hierarchy__root">
          <span className="portfolio-hierarchy__root-icon" aria-hidden>
            ◉
          </span>
          <strong>Company</strong>
        </div>

        {hierarchy.clients.length ? (
          <ul className="portfolio-hierarchy__clients">
            {hierarchy.clients.map((client) => {
              const summary = summaryByLabel.get(client.label)
              return (
                <li key={client.label} className="portfolio-hierarchy__client">
                  <div className="portfolio-hierarchy__client-head">
                    <div className="portfolio-hierarchy__client-meta">
                      <span className="portfolio-hierarchy__client-icon" aria-hidden>
                        ▣
                      </span>
                      <div className="portfolio-hierarchy__client-titles">
                        <strong>{client.label}</strong>
                        {client.industry ? (
                          <span className="portfolio-hierarchy__industry">{client.industry}</span>
                        ) : null}
                      </div>
                      <span className="portfolio-hierarchy__lob-count">
                        {client.lobs.length} LOB{client.lobs.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="portfolio-hierarchy__client-actions">
                      <button type="button" className="portfolio-hierarchy__link" onClick={() => onOpenCombined(client.label)}>
                        Combined summary
                      </button>
                      {onAddLob ? (
                        <button
                          type="button"
                          className="portfolio-hierarchy__link"
                          onClick={() => onAddLob(client.clientId ?? '')}
                        >
                          Add LOB
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {summary ? (
                    <div className="portfolio-hierarchy__client-stats" aria-label={`${client.label} metrics`}>
                      <div className="portfolio-hierarchy__stat">
                        <span className="portfolio-hierarchy__stat-label">Revenue</span>
                        <strong className="portfolio-hierarchy__stat-value">{money(summary.revenue)}</strong>
                      </div>
                      <div className="portfolio-hierarchy__stat">
                        <span className="portfolio-hierarchy__stat-label">Cost</span>
                        <strong className="portfolio-hierarchy__stat-value">{money(summary.laborCost)}</strong>
                      </div>
                      <div className="portfolio-hierarchy__stat">
                        <span className="portfolio-hierarchy__stat-label">Margin</span>
                        <strong
                          className={`portfolio-hierarchy__stat-value${
                            summary.grossMargin < 0 ? ' portfolio-hierarchy__stat-value--loss' : ''
                          }`}
                        >
                          {money(summary.grossMargin)}
                          {summary.grossMarginPct != null ? (
                            <span
                              className={`portfolio-hierarchy__stat-pct${
                                summary.grossMarginPct < 0 ? ' portfolio-hierarchy__stat-pct--loss' : ''
                              }`}
                            >
                              {' '}
                              {fmtPct(summary.grossMarginPct)}
                            </span>
                          ) : null}
                        </strong>
                      </div>
                      <div className="portfolio-hierarchy__stat">
                        <span className="portfolio-hierarchy__stat-label">Req / Prod FTE</span>
                        <strong className="portfolio-hierarchy__stat-value">
                          {fmtNum(summary.requiredFte, 1)} / {fmtNum(summary.productionFte, 1)}
                        </strong>
                      </div>
                      <div className="portfolio-hierarchy__stat">
                        <span className="portfolio-hierarchy__stat-label">Staffing</span>
                        <strong className="portfolio-hierarchy__stat-value">
                          {summary.staffingPct != null ? fmtPct(summary.staffingPct) : '—'}
                        </strong>
                      </div>
                    </div>
                  ) : null}

                  <ul className="portfolio-hierarchy__lobs">
                    {client.lobs.map((lob) => (
                      <li key={lob.scenarioId} className="portfolio-hierarchy__lob">
                        <button type="button" className="portfolio-hierarchy__lob-btn" onClick={() => onOpenLob(lob.scenarioId)}>
                          <span className="portfolio-hierarchy__lob-label">{lob.label}</span>
                          <span className="portfolio-hierarchy__lob-badge">{lob.billingType}</span>
                        </button>
                        {onDeleteLob ? (
                          <button
                            type="button"
                            className="portfolio-hierarchy__delete"
                            onClick={() => onDeleteLob(lob.scenarioId, `${client.label} · ${lob.label}`)}
                            aria-label={`Delete ${lob.label}`}
                          >
                            Delete
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="saas-muted m-0">{emptyMessage}</p>
        )}

        {onExecutiveSummary ? (
          <button type="button" className="portfolio-hierarchy__summary-link" onClick={onExecutiveSummary}>
            {hierarchy.executiveScopeLabel} (all clients)
          </button>
        ) : null}
      </div>
    </section>
  )
}
