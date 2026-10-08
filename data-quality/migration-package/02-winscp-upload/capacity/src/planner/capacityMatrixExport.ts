import * as XLSX from 'xlsx'
import type { DerivedCapacityRow } from './capacityPlanDerived'

export type MatrixExportMetric = {
  groupLabel: string
  label: string
  values: string[]
}

export type MatrixExportPayload = {
  title: string
  subtitle: string
  weekLabels: string[]
  weekStatuses: string[]
  metrics: MatrixExportMetric[]
  savedAt: string
}

export function buildMatrixExportPayload(
  title: string,
  subtitle: string,
  displayedRows: DerivedCapacityRow[],
  groups: Record<string, { label: string; metrics: Array<{ label: string; values: string[] }> }>,
): MatrixExportPayload {
  const metrics: MatrixExportMetric[] = []
  Object.values(groups).forEach((group) => {
    group.metrics.forEach((metric) => {
      metrics.push({
        groupLabel: group.label,
        label: metric.label,
        values: metric.values,
      })
    })
  })
  return {
    title,
    subtitle,
    weekLabels: displayedRows.map((row) => row.week),
    weekStatuses: displayedRows.map((row) => row.statusLabel),
    metrics,
    savedAt: new Date().toISOString(),
  }
}

export function downloadCapacityMatrixExcel(payload: MatrixExportPayload): void {
  const header = ['Category', 'Metric', ...payload.weekLabels]
  const statusRow = ['', 'Status', ...payload.weekStatuses]
  const dataRows = payload.metrics.map((metric) => [metric.groupLabel, metric.label, ...metric.values])
  const sheet = XLSX.utils.aoa_to_sheet([header, statusRow, ...dataRows])
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'Capacity_Matrix')
  const metaSheet = XLSX.utils.json_to_sheet([
    { Field: 'Title', Value: payload.title },
    { Field: 'Subtitle', Value: payload.subtitle },
    { Field: 'Exported', Value: payload.savedAt },
    { Field: 'Weeks', Value: payload.weekLabels.length },
    { Field: 'Metrics', Value: payload.metrics.length },
  ])
  XLSX.utils.book_append_sheet(workbook, metaSheet, 'Export_Info')
  XLSX.writeFile(workbook, `${payload.title.replace(/[^\w.-]+/g, '_')}_capacity_matrix.xlsx`)
}

export function downloadCapacityMatrixPdf(matrixElement: HTMLElement, filename: string): void {
  const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=1400,height=900')
  if (!printWindow) return
  const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
    .map((node) => node.outerHTML)
    .join('')
  printWindow.document.write(`<!DOCTYPE html><html><head><title>${filename}</title>${styles}
    <style>
      body { margin: 16px; background: #fff; }
      .cap-ledger-matrix { font-size: 11px; }
      .cap-ledger-matrix__metric-row { min-width: 220px; }
      @page { size: landscape; margin: 12mm; }
    </style>
  </head><body>${matrixElement.outerHTML}</body></html>`)
  printWindow.document.close()
  printWindow.focus()
  printWindow.onload = () => {
    printWindow.print()
    printWindow.close()
  }
}
