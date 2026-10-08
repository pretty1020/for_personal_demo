/** Heuristic styling to mirror Excel pivot / grouped rows when SheetJS flattens the grid. */
export function getPivotRowPresentation(
  row: (unknown | null)[],
  _rowIndex: number,
): { bold: boolean; indentPx: number; subtle: boolean } {
  const c0 = String(row[0] ?? '').trim()
  const rest = row.slice(1)
  const hasLeadingSpaces = /^\s+/.test(String(row[0] ?? ''))
  const low = c0.toLowerCase()
  const bold =
    /grand\s*total|subtotal|^total\s/i.test(low) ||
    low === 'total' ||
    low.endsWith(': total')
  const subtle = low === '' && rest.some((c) => String(c ?? '').trim() !== '')
  const indentPx = hasLeadingSpaces ? Math.min(Math.floor(12 + (String(row[0]).length - c0.length) * 3), 40) : subtle ? 16 : 0
  return { bold, indentPx, subtle }
}

export function looksPivotLikeSheet(matrix: (unknown | null)[][]): boolean {
  if (matrix.length < 2) return false
  const head = String(matrix[0]?.[0] ?? '').toLowerCase()
  if (head.includes('row labels') || head.includes('values')) return true
  let hits = 0
  for (let i = 1; i < Math.min(matrix.length, 25); i++) {
    const a = String(matrix[i]?.[0] ?? '').toLowerCase()
    if (a.includes('total') || a.includes('grand')) hits++
  }
  return hits >= 2
}
