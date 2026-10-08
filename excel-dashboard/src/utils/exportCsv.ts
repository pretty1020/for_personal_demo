import type { SheetSnapshot } from '../types/dashboard'
import { formatCellForDisplay } from './inferTypes'

export function rowsToCsv(snapshot: SheetSnapshot): string {
  const cols = snapshot.columns
  const headerLine = cols.map((c) => escapeCsvField(c.header)).join(',')
  const lines = [headerLine]
  for (const row of snapshot.rows) {
    const line = cols
      .map((c) => escapeCsvField(formatCellForDisplay(row[c.key], c)))
      .join(',')
    lines.push(line)
  }
  return lines.join('\r\n')
}

function escapeCsvField(value: string): string {
  if (/[,"\r\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`
  }
  return value
}

export function triggerDownloadCsv(text: string, fileNameBase: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${fileNameBase}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
