import type { CanonicalField, DatasetDetectionReport } from '../types/dashboard'
import { requiredFieldsForDataset } from './datasetDetector'
import type { TransformOptions } from './transformPipeline'

/** Order for stable dedupe / drop-null key columns */
const KEY_FIELD_ORDER: CanonicalField[] = [
  'project_code',
  'fy',
  'month',
  'week',
  'scenario',
  'client_name',
  'location',
  'date',
  'project_name',
  'du',
]

/**
 * Maps dataset detection field maps to transform options (explicit Project Code keys + key columns per sheet).
 */
export function buildTransformOptionsFromReport(report: DatasetDetectionReport): TransformOptions {
  const projectCodeKeysBySheet: Record<string, string[]> = {}
  const keyAccum: Record<string, Set<string>> = {}

  for (const d of report.detected) {
    const sheet = d.sheetName
    const pc = d.fieldMap.project_code
    if (pc) {
      if (!projectCodeKeysBySheet[sheet]) projectCodeKeysBySheet[sheet] = []
      if (!projectCodeKeysBySheet[sheet].includes(pc)) {
        projectCodeKeysBySheet[sheet].push(pc)
      }
    }

    // Wide ops sheets (AHT/HC/Shrinkage/Attrition) have weeks as COLUMN HEADERS.
    // Using required key columns (especially "week") for drop/dedupe can incorrectly collapse
    // Planned/Actuals/Cap or Requirement/Projection variants into a single surviving row.
    // For these sheets, skip key-column drop/dedupe entirely and rely on full-row signature.
    if (d.dataset === 'attrition' || d.dataset === 'shrinkage' || d.dataset === 'headcount' || d.dataset === 'aht') {
      continue
    }

    const req = requiredFieldsForDataset(d.dataset)
    for (const f of req) {
      const colKey = d.fieldMap[f]
      if (!colKey) continue
      if (!keyAccum[sheet]) keyAccum[sheet] = new Set()
      keyAccum[sheet]!.add(colKey)
    }
  }

  const keyColumnsBySheet: Record<string, string[]> = {}
  for (const [sheet, set] of Object.entries(keyAccum)) {
    const ordered: string[] = []
    for (const f of KEY_FIELD_ORDER) {
      for (const d of report.detected) {
        if (d.sheetName !== sheet) continue
        const k = d.fieldMap[f]
        if (k && set.has(k) && !ordered.includes(k)) ordered.push(k)
      }
    }
    for (const k of set) {
      if (!ordered.includes(k)) ordered.push(k)
    }
    keyColumnsBySheet[sheet] = ordered
  }

  return {
    ...(Object.keys(projectCodeKeysBySheet).length > 0 ? { projectCodeKeysBySheet } : {}),
    ...(Object.keys(keyColumnsBySheet).length > 0 ? { keyColumnsBySheet } : {}),
  }
}
