import { useRef } from 'react'
import { useWorkbook } from '../../context/WorkbookContext'

export function IdealFinancialUpload() {
  const inputRef = useRef<HTMLInputElement>(null)
  const { loadFinancialWorkbook, isLoading, error, financialFileName } = useWorkbook()

  const onPick = async (file: File | undefined) => {
    if (!file) return
    await loadFinancialWorkbook(file)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="ideal-upload-bar">
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.xlsm,.csv"
        className="sr-only"
        id="ideal-financial-upload"
        onChange={(e) => void onPick(e.target.files?.[0])}
      />
      <label htmlFor="ideal-financial-upload" className="exec-chart-card__btn ideal-upload-bar__btn">
        {isLoading ? 'Uploading…' : 'Upload financial workbook'}
      </label>
      {financialFileName ? (
        <span className="ideal-upload-bar__name" title={financialFileName}>
          Loaded: {financialFileName}
        </span>
      ) : (
        <span className="ideal-upload-bar__hint">Upload a financial file (.xlsx)</span>
      )}
      {error ? <span className="ideal-upload-bar__error">{error}</span> : null}
    </div>
  )
}
