import * as XLSX from 'xlsx'
import type { DerivedCapacityRow } from './capacityPlanDerived'

export type MatrixExportMetric = {
  groupLabel: string
  label: string
  /** Stable override key used on re-upload (e.g. callVolume, requiredFte). */
  metricId?: string
  /** Raw numeric values preferred for accurate re-import. */
  values: Array<string | number | null>
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
  groups: Record<
    string,
    {
      label: string
      metrics: Array<{ label: string; metricId?: string; values: Array<string | number | null> }>
    }
  >,
): MatrixExportPayload {
  const metrics: MatrixExportMetric[] = []
  Object.values(groups).forEach((group) => {
    group.metrics.forEach((metric) => {
      metrics.push({
        groupLabel: group.label,
        label: metric.label,
        metricId: metric.metricId,
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

function cellValue(value: string | number | null | undefined): string | number {
  if (value == null || value === '') return ''
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const text = String(value).trim()
  if (!text || text === '—' || text === '-' || text === '–' || text.toLowerCase() === 'n/a') return ''
  const cleaned = text.replace(/,/g, '').replace(/%$/, '')
  const parsed = Number(cleaned)
  if (Number.isFinite(parsed) && /^-?\d+(\.\d+)?%?$/.test(cleaned)) return parsed
  return text
}

export function downloadCapacityMatrixExcel(payload: MatrixExportPayload): void {
  const header = ['Category', 'Metric', 'Metric_Id', ...payload.weekLabels]
  const statusRow = ['', 'Status', '', ...payload.weekStatuses]
  const dataRows = payload.metrics.map((metric) => [
    metric.groupLabel,
    metric.label,
    metric.metricId ?? '',
    ...metric.values.map((value) => cellValue(value)),
  ])
  const sheet = XLSX.utils.aoa_to_sheet([header, statusRow, ...dataRows])
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'Capacity_Matrix')
  const instructions = XLSX.utils.aoa_to_sheet([
    ['Capacity matrix upload template'],
    ['1. Keep Week columns as YYYY-MM-DD (ISO week start dates).'],
    ['2. Edit values in rows that have a Metric_Id. Those are the fields re-imported.'],
    ['3. Shrinkage categories use Metric_Id = shrinkage:<categoryId> (e.g. shrinkage:absenteeism).'],
    ['4. Leave Metric_Id blank for calculated rows (they are ignored on upload).'],
    ['5. Labels Required Staffing / Production / Required Production FTE also import when Metric_Id is blank.'],
    ['6. Use Upload template with Overwrite or Append / merge.'],
    ['7. Percent fields may be entered as 0.85 or 85%.'],
    ['8. Uploaded driver fields (volume, AHT, occupancy, attrition, shrinkage) switch to Manual mode so values stick.'],
    ['9. Weeks marked Actual (Status row) also write Production HC and drivers into actual overrides.'],
  ])
  XLSX.utils.book_append_sheet(workbook, instructions, 'Instructions')
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
  }
}
