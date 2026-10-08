import type { CompanyHierarchy } from '../../planner/companyHierarchy'

type Props = {
  hierarchy: CompanyHierarchy
  onOpenLob: (scenarioId: string) => void
  onOpenCombined: (clientName: string) => void
  /** Combined roll-up for all teams that share a project code. */
  onOpenCombinedProjectCode?: (projectCode: string) => void
  /** Add another LOB under an existing client. */
  onAddLob?: (clientId: string | null, clientName: string) => void
  onAddClient?: () => void
  onExecutiveSummary?: () => void
  /** Button label for the summary action (defaults to Executive summary). */
  financialLabel?: string
  onDeleteLob?: (scenarioId: string, label: string) => void
  emptyMessage?: string
}

export function CompanyHierarchyPanel({
  hierarchy,
  onOpenLob,
  onOpenCombined,
  onOpenCombinedProjectCode,
  onAddLob,
  onAddClient,
  onExecutiveSummary,
  financialLabel = 'Open Financials',
  onDeleteLob,
  emptyMessage = 'No clients yet. Choose Add client to set one up.',
}: Props) {
  return (
    <section className="portfolio-hierarchy saas-card">
      <header className="portfolio-hierarchy__head">
        <div>
          <p className="portfolio-hierarchy__eyebrow">Clients</p>
          <h2 className="portfolio-hierarchy__title m-0">Your teams</h2>
        </div>
        <div className="portfolio-hierarchy__head-actions">
          {onAddClient ? (
            <button type="button" className="saas-btn" onClick={onAddClient}>
              Add client
            </button>
          ) : null}
          {onExecutiveSummary ? (
            <button
              type="button"
              className="saas-btn saas-btn--secondary portfolio-hierarchy__exec-btn"
              onClick={onExecutiveSummary}
            >
              {financialLabel}
            </button>
          ) : null}
        </div>
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
            {hierarchy.clients.map((client) => (
              <li key={client.label} className="portfolio-hierarchy__client">
                <div className="portfolio-hierarchy__client-head">
                  <div className="portfolio-hierarchy__client-meta">
                    <span className="portfolio-hierarchy__client-icon" aria-hidden>
                      ▣
                    </span>
                    <strong>{client.label}</strong>
                    <span className="portfolio-hierarchy__lob-count">
                      {client.lobs.length} team{client.lobs.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="portfolio-hierarchy__client-actions">
                    <button
                      type="button"
                      className="portfolio-hierarchy__link"
                      onClick={() => onOpenCombined(client.label)}
                      title="Combined view for this client"
                    >
                      Combined · Client
                    </button>
                    {onAddLob ? (
                      <button
                        type="button"
                        className="portfolio-hierarchy__link"
                        onClick={() => onAddLob(client.clientId, client.label)}
                      >
                        Add LOB
                      </button>
                    ) : null}
                  </div>
                </div>
                <ul className="portfolio-hierarchy__lobs">
                  {client.lobs.map((lob) => (
                    <li key={lob.scenarioId} className="portfolio-hierarchy__lob">
                      <button
                        type="button"
                        className="portfolio-hierarchy__lob-btn"
                        onClick={() => onOpenLob(lob.scenarioId)}
                      >
                        <span className="portfolio-hierarchy__lob-label">{lob.label}</span>
                        {lob.projectCode ? (
                          <span className="portfolio-hierarchy__lob-code" title="Project Code">
                            {lob.projectCode}
                          </span>
                        ) : null}
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
            ))}
          </ul>
        ) : (
          <p className="saas-muted m-0">{emptyMessage}</p>
        )}

        {hierarchy.sharedProjectCodes.length && onOpenCombinedProjectCode ? (
          <div className="portfolio-hierarchy__projects">
            <div className="portfolio-hierarchy__projects-head">
              <span className="portfolio-hierarchy__client-icon" aria-hidden>
                ⌗
              </span>
              <strong>Shared project codes</strong>
              <span className="portfolio-hierarchy__lob-count">
                {hierarchy.sharedProjectCodes.length} code
                {hierarchy.sharedProjectCodes.length === 1 ? '' : 's'}
              </span>
            </div>
            <ul className="portfolio-hierarchy__project-list">
              {hierarchy.sharedProjectCodes.map((project) => (
                <li key={project.codeKey} className="portfolio-hierarchy__project">
                  <div className="portfolio-hierarchy__project-meta">
                    <strong>{project.label}</strong>
                    <span className="portfolio-hierarchy__lob-count">
                      {project.teamCount} team{project.teamCount === 1 ? '' : 's'}
                      {project.clients.length > 1 ? ` · ${project.clients.length} clients` : ''}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="portfolio-hierarchy__link"
                    onClick={() => onOpenCombinedProjectCode(project.label)}
                    title="Combined view for all teams with this project code"
                  >
                    Combined · Project Code
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {onExecutiveSummary ? (
          <button type="button" className="portfolio-hierarchy__summary-link" onClick={onExecutiveSummary}>
            {hierarchy.executiveScopeLabel} — all clients
          </button>
        ) : null}
      </div>
    </section>
  )
}
