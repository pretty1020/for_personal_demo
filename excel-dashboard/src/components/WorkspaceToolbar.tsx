import { Link } from 'react-router-dom'

interface WorkspaceToolbarProps {
  fileName: string
  showAnalysisExtras: boolean
  onToggleExtras: () => void
  /** Return to upload page and clear session */
  onHome: () => void
  /** Same as home — new workbook */
  onNewUpload: () => void
}

export function WorkspaceToolbar(props: WorkspaceToolbarProps) {
  const { fileName, showAnalysisExtras, onToggleExtras, onHome, onNewUpload } = props

  const shortName = fileName.length > 42 ? `${fileName.slice(0, 39)}…` : fileName

  return (
    <div className="workspace-toolbar">
      <button type="button" className="btn-home" onClick={onHome}>
        Home
      </button>
      <button type="button" className="btn-secondary toolbar-upload-btn" onClick={onNewUpload}>
        New upload
      </button>
      <div className="workspace-toolbar__center">
        <span className="workspace-file" title={fileName}>
          {shortName}
        </span>
        <span className="toolbar-hint">Select a sheet card below</span>
      </div>
      <div className="workspace-toolbar__end">
        <Link to="/executive" className="btn-secondary toolbar-exec-link">
          Executive Summary
        </Link>
        <button
          type="button"
          className="btn-extras-toggle"
          aria-expanded={showAnalysisExtras}
          onClick={onToggleExtras}
        >
          {showAnalysisExtras ? 'Hide charts & KPIs' : 'Charts & KPIs'}
        </button>
      </div>
    </div>
  )
}
