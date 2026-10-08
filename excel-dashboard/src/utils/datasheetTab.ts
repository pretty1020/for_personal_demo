import type { SheetSnapshot } from '../types/dashboard'

/** Normalize tab name for matching "Datasheet", "Data sheet", etc. */
export function normalizeTabNameForMatch(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
}

/**
 * Prefer the workbook tab that holds dashboard dimensions (Client, Project, …).
 * Matches names that normalize to "datasheet" or start with "datasheet" (e.g. Datasheet1).
 */
export function findDatasheetSnapshot(
  snapshots: Record<string, SheetSnapshot>,
  sheetNames: string[],
): SheetSnapshot | null {
  let fallback: SheetSnapshot | null = null
  for (const name of sheetNames) {
    const snap = snapshots[name]
    if (!snap) continue
    const n = normalizeTabNameForMatch(name)
    if (n === 'datasheet') return snap
    if (n.startsWith('datasheet')) fallback ??= snap
  }
  return fallback
}

export function describeDatasheetSource(datasheetName: string | null, activeName: string): string {
  if (!datasheetName || datasheetName === activeName) {
    return ''
  }
  return `Filter options are built from “${datasheetName}”.`
}
