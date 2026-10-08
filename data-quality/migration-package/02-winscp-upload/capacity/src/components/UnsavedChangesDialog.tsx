type UnsavedChangesDialogProps = {
  title?: string
  message?: string
  saveLabel?: string
  discardLabel?: string
  onSave: () => void | Promise<void>
  onDiscard: () => void
  onCancel: () => void
}

export function UnsavedChangesDialog({
  title = 'Unsaved changes',
  message = 'You have unsaved changes. Save before leaving this page?',
  saveLabel = 'Save changes',
  discardLabel = 'Leave without saving',
  onSave,
  onDiscard,
  onCancel,
}: UnsavedChangesDialogProps) {
  return (
    <div className="cap-unsaved-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="cap-delete-confirm cap-unsaved-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="unsaved-changes-title"
        onClick={(event) => event.stopPropagation()}
      >
        <p id="unsaved-changes-title" className="m-0 font-semibold text-slate-900">
          {title}
        </p>
        <p className="cap-panel__desc m-0 mt-1">{message}</p>
        <div className="cap-capacity-sidebar__actions mt-3">
          <button type="button" className="saas-btn saas-btn--secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="saas-btn saas-btn--secondary" onClick={onDiscard}>
            {discardLabel}
          </button>
          <button
            type="button"
            className="saas-btn saas-btn--primary"
            onClick={() => {
              void Promise.resolve(onSave())
            }}
          >
            {saveLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
