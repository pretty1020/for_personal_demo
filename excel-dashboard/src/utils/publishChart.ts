import type { ChartDraftState } from '../types/dashboard'
import type { SheetSnapshot } from '../types/dashboard'

export function isDraftPublishable(snapshot: SheetSnapshot | null, draft: ChartDraftState): boolean {
  if (!snapshot || snapshot.columns.length === 0) return false
  if (!draft.xColumn.trim() || !draft.yColumn.trim()) return false

  const yCol = snapshot.columns.find((c) => c.key === draft.yColumn)
  if (yCol?.type !== 'number') return false

  if (draft.chartType === 'scatter' || draft.chartType === 'bubble') {
    const xCol = snapshot.columns.find((c) => c.key === draft.xColumn)
    return xCol?.type === 'number'
  }

  const xCol = snapshot.columns.find((c) => c.key === draft.xColumn)
  return Boolean(xCol)
}
