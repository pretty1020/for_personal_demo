import * as XLSX from 'xlsx'
import type { ParsedWorkbookBundle, ParsedWorkbookMeta, SheetSnapshot } from '../types/dashboard'
import { matrixToSnapshot } from './parseExcelCore'

function isCsvFile(file: File): boolean {
  const lower = file.name.toLowerCase()
  return lower.endsWith('.csv') || file.type.includes('csv')
}

export function parseWorkbookFromFile(file: File): Promise<ParsedWorkbookMeta> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the file. Please try again.'))
    reader.onload = () => {
      try {
        const wb = isCsvFile(file)
          ? XLSX.read(String(reader.result ?? ''), { type: 'string', cellDates: true })
          : XLSX.read(new Uint8Array(reader.result as ArrayBuffer), { type: 'array', cellDates: true })
        const sheetNames = wb.SheetNames.filter(Boolean)
        if (sheetNames.length === 0) {
          reject(new Error('This workbook has no sheets.'))
          return
        }
        resolve({
          fileName: file.name,
          sheetNames,
        })
      } catch {
        reject(new Error('Invalid or unsupported Excel file. Use .xlsx or .xls.'))
      }
    }
    if (isCsvFile(file)) reader.readAsText(file)
    else reader.readAsArrayBuffer(file)
  })
}

/** Parse every sheet once (recommended after upload). */
export function parseFullWorkbookFromFile(file: File): Promise<ParsedWorkbookBundle> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the file. Please try again.'))
    reader.onload = () => {
      try {
        const wb = isCsvFile(file)
          ? XLSX.read(String(reader.result ?? ''), { type: 'string', cellDates: true })
          : XLSX.read(new Uint8Array(reader.result as ArrayBuffer), { type: 'array', cellDates: true })
        const sheetNames = wb.SheetNames.filter(Boolean)
        if (sheetNames.length === 0) {
          reject(new Error('This workbook has no sheets.'))
          return
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
        resolve({
          fileName: file.name,
          sheetNames,
          snapshots,
        })
      } catch {
        reject(new Error('Invalid or unsupported file. Use .xlsx, .xls, or .csv.'))
      }
    }
    if (isCsvFile(file)) reader.readAsText(file)
    else reader.readAsArrayBuffer(file)
  })
}

/** Parse a single sheet (legacy helper — reads file again). */
export function parseSheetFromFile(file: File, sheetName: string): Promise<SheetSnapshot> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the file.'))
    reader.onload = () => {
      try {
        const data = new Uint8Array(reader.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array', cellDates: true })
        const sheet = wb.Sheets[sheetName]
        if (!sheet) {
          reject(new Error(`Sheet “${sheetName}” was not found.`))
          return
        }
        const matrix = XLSX.utils.sheet_to_json<(unknown | null)[]>(sheet, {
          header: 1,
          defval: null,
          raw: false,
        }) as (unknown | null)[][]
        resolve(matrixToSnapshot(sheetName, matrix))
      } catch {
        reject(new Error('Failed to parse the selected sheet.'))
      }
    }
    reader.readAsArrayBuffer(file)
  })
}
