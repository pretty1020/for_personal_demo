import type { ChartDraftState } from '../types/dashboard'
import type { SheetSnapshot } from '../types/dashboard'

export const EMPTY_DRAFT: ChartDraftState = {
  title: 'Quarterly spotlight',
  chartType: 'bar',
  xColumn: '',
  yColumn: '',
  categoryColumn: '',
  sizeColumn: '',
  aggregation: 'sum',
  filters: {},
  showDataLabels: false,
  includePivotTotalRows: false,
}

export function pickScatterDefaults(snapshot: SheetSnapshot) {
  const nums = snapshot.columns.filter((c) => c.type === 'number').map((c) => c.key)
  const x = nums[0] ?? ''
  const y = nums[1] ?? nums[0] ?? ''
  const size = nums.find((k) => k !== x && k !== y) ?? ''
  return { x, y, size }
}

export function pickCategoricalDefaults(snapshot: SheetSnapshot) {
  const y = snapshot.columns.find((c) => c.type === 'number')
  const x =
    snapshot.columns.find((c) => c.type === 'text') ??
    snapshot.columns.find((c) => c.type === 'date')
  const firstNonNumeric = snapshot.columns.find((c) => c.type !== 'number')
  const firstNumeric = snapshot.columns.find((c) => c.type === 'number')

  return {
    x: (x ?? firstNonNumeric)?.key ?? '',
    y: (y ?? firstNumeric)?.key ?? '',
  }
}

export function createDefaultDraft(snapshot: SheetSnapshot | null): ChartDraftState {
  if (!snapshot || snapshot.columns.length === 0) {
    return { ...EMPTY_DRAFT }
  }

  const { x, y } = pickCategoricalDefaults(snapshot)

  return {
    title: `Insights · ${snapshot.name}`,
    chartType: 'bar',
    xColumn: x,
    yColumn: y,
    categoryColumn: '',
    sizeColumn: '',
    aggregation: 'sum',
    filters: {},
    showDataLabels: false,
    includePivotTotalRows: false,
  }
}
