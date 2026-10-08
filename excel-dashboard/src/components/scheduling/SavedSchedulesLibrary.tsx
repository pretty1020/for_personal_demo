import type { SavedSchedulingSchedule } from '../../planner/scheduling/schedulingArtifactPersistence'

function formatWhen(value?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export function SavedSchedulesLibrary({
  entries,
  activeId,
  hideHeader,
  onOpen,
  onRename,
  onDownload,
  onDelete,
}: {
  entries: SavedSchedulingSchedule[]
  activeId?: string | null
  hideHeader?: boolean
  onOpen: (entry: SavedSchedulingSchedule) => void
  onRename: (entry: SavedSchedulingSchedule) => void
  onDownload: (entry: SavedSchedulingSchedule) => void
  onDelete: (entry: SavedSchedulingSchedule) => void
}) {
  return (
    <section className={`sched-library${hideHeader ? ' sched-library--nested' : ' sched-panel saas-card'}`}>
      {hideHeader ? null : (
        <header className="sched-library__head">
          <div>
            <h2 className="sched-section-title m-0">Saved / generated schedules</h2>
            <p className="saas-muted m-0 text-xs">
              Drafts are kept automatically after generate. Save a named copy to keep it in this library after you leave
              the page. Previous runs keep their exact schedule and settings.
            </p>
          </div>
        </header>
      )}
      {entries.length ? (
        <div className="sched-table-wrap">
          <table className="sched-table sched-table--compact sched-library__table">
            <caption>Stored drafts and saved copies for this planner</caption>
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Client</th>
                <th>LOB</th>
                <th>Team</th>
                <th>Coverage period</th>
                <th>Generated</th>
                <th>Created by</th>
                <th className="sched-library__actions-col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className={activeId === entry.id ? 'sched-library__row--active' : undefined}>
                  <th scope="row">{entry.name}</th>
                  <td>
                    <span className={`sched-badge${entry.status === 'draft' ? ' sched-badge--draft' : ' sched-badge--saved'}`}>
                      {entry.status === 'draft' ? 'Draft' : 'Saved'}
                    </span>
                  </td>
                  <td>{entry.clientName || '—'}</td>
                  <td>{entry.lobName || '—'}</td>
                  <td>{entry.teamSupervisor || 'All teams'}</td>
                  <td>
                    {entry.coverageStart || entry.weekStartIso}
                    {entry.coverageEnd ? ` → ${entry.coverageEnd}` : ''}
                  </td>
                  <td>{formatWhen(entry.generatedAt ?? entry.savedAt)}</td>
                  <td>{entry.createdBy || '—'}</td>
                  <td className="sched-library__actions-col">
                    <div className="sched-library__actions" role="group" aria-label={`Actions for ${entry.name}`}>
                      <button
                        type="button"
                        className="saas-btn saas-btn--secondary saas-btn--sm"
                        onClick={() => onOpen(entry)}
                      >
                        Open
                      </button>
                      <button
                        type="button"
                        className="saas-btn saas-btn--secondary saas-btn--sm"
                        onClick={() => onRename(entry)}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className="saas-btn saas-btn--secondary saas-btn--sm"
                        onClick={() => onDownload(entry)}
                      >
                        Download
                      </button>
                      <button
                        type="button"
                        className="saas-btn saas-btn--danger saas-btn--sm"
                        onClick={() => onDelete(entry)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="saas-muted m-0 text-xs">No generated schedules stored yet. Generate a schedule to create a draft.</p>
      )}
    </section>
  )
}
