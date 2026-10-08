import type { DragEventHandler } from 'react'

interface FileUploadZoneProps {
  disabled?: boolean
  isDragging: boolean
  fileName?: string | null
  error?: string | null
  /** Called when the chosen file is not an accepted spreadsheet type. */
  onInvalidFile?: (message: string) => void
  onFile: (file: File) => void
  setDragging: (v: boolean) => void
  /** Override default hero copy (secondary upload flows, e.g. DBE-only workbooks). */
  cardTitle?: string
  cardDesc?: string
}

const ACCEPT =
  '.xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv'

export function FileUploadZone(props: FileUploadZoneProps) {
  const {
    disabled,
    isDragging,
    fileName,
    error,
    onInvalidFile,
    onFile,
    setDragging,
    cardTitle = 'Upload workbook',
    cardDesc = 'Drag in a workbook or browse from your computer.',
  } = props

  const pickFile = (file: File | undefined) => {
    if (!file) return
    const lower = file.name.toLowerCase()
    const ok =
      lower.endsWith('.xlsx') ||
      lower.endsWith('.xls') ||
      lower.endsWith('.csv') ||
      file.type.includes('spreadsheet')
    if (!ok) {
      onInvalidFile?.('Use an Excel or CSV file (.xlsx, .xls, or .csv).')
      return
    }
    onFile(file)
  }

  const onDrop: DragEventHandler<HTMLLabelElement> = (e) => {
    e.preventDefault()
    setDragging(false)
    if (disabled) return
    pickFile(e.dataTransfer.files[0])
  }

  const onDragOver: DragEventHandler<HTMLLabelElement> = (e) => {
    e.preventDefault()
    if (!disabled) setDragging(true)
  }

  const onDragLeave: DragEventHandler<HTMLLabelElement> = () => {
    setDragging(false)
  }

  return (
    <section className="card card--elevated" aria-label="Excel upload">
      <div className="card-header">
        <div>
          <h2 className="card-title">{cardTitle}</h2>
          <p className="card-desc">{cardDesc}</p>
        </div>
      </div>
      <label
        className={`upload-zone ${isDragging ? 'upload-zone--active' : ''} ${disabled ? 'upload-zone--disabled' : ''}`}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
      >
        <input
          type="file"
          accept={ACCEPT}
          className="sr-only"
          disabled={disabled}
          onChange={(e) => pickFile(e.target.files?.[0])}
        />
        <div className="upload-icon" aria-hidden>
          <svg width="42" height="42" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 3v12m0 0 4.5-4.5M12 15 7.5 10.5M5 21h14"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div className="upload-copy">
          <p className="upload-strong">Drop Excel here</p>
          <p className="upload-hint">
            Accepted: <kbd>.xlsx</kbd>, <kbd>.xls</kbd>, <kbd>.csv</kbd> — processed only in your browser.
          </p>
          <span className="btn-secondary upload-browse">Browse files</span>
        </div>
      </label>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      {fileName ? (
        <p className="file-chip" aria-live="polite">
          <span className="file-dot" />
          Loaded: <strong>{fileName}</strong>
        </p>
      ) : null}
    </section>
  )
}
