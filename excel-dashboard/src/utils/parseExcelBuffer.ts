import * as XLSX from 'xlsx'
import type { ParsedWorkbookBundle, SheetSnapshot } from '../types/dashboard'
import { matrixToSnapshot } from './parseExcelCore'

/** Parse an in-memory workbook buffer (sample templates, drag-drop previews). */
export function parseFullWorkbookFromArrayBuffer(
  fileName: string,
  buffer: ArrayBuffer,
): ParsedWorkbookBundle {
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true })
  const sheetNames = wb.SheetNames.filter(Boolean)
  if (!sheetNames.length) {
    throw new Error('Workbook has no sheets.')
  }
  const snapshots: Record<string, SheetSnapshot> = {}
  for (const name of sheetNames) {
    const sheet = wb.Sheets[name]
    if (!sheet) continue
    const matrix = XLSX.utils.sheet_to_json<(unknown | null)[]>(sheet, {
      header: 1,
      defval: null,
      raw: false,
    }) as (unknown | null)[][]
    snapshots[name] = matrixToSnapshot(name, matrix)
  }
  return { fileName, sheetNames, snapshots }
}
