import { useEffect, useState } from 'react'
import {
  retryFailedDocuments,
  subscribeSaveStatus,
  type SaveStatus,
} from '../../data/capacityDocuments'
import { isRemoteBackend } from '../../data/apiClient'

/**
 * Tells the user whether their work reached the database. A failed save used to go only
 * to the browser console, so someone could keep typing for an hour into a session that
 * had stopped saving. Errors stay on screen until the retry succeeds.
 */
export function SaveStatusBadge() {
  const [status, setStatus] = useState<SaveStatus>({
    state: 'idle',
    message: '',
    pendingKeys: [],
    lastSavedAt: null,
  })

  useEffect(() => subscribeSaveStatus(setStatus), [])

  // Nothing to report without a backend: local mode never had a save to lose.
  if (!isRemoteBackend()) return null
  if (status.state === 'idle') return null

  if (status.state === 'error') {
    return (
      <div className="cap-save-status cap-save-status--error" role="alert">
        <span>{status.message || 'Your last change could not be saved.'}</span>
        <button type="button" className="cap-save-status__retry" onClick={retryFailedDocuments}>
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="cap-save-status" role="status" aria-live="polite">
      {status.state === 'saving' ? 'Saving…' : 'All changes saved'}
    </div>
  )
}
