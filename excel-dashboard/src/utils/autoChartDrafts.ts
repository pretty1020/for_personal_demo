import type { ChartDraftState } from '../types/dashboard'
import type { SheetSnapshot } from '../types/dashboard'
import type { SheetColumnProfile } from './columnSemantics'

export interface AutoChartSpec {
  title: string
  draft: ChartDraftState
}

/** Pre-built chart configs for instant dashboard (uses same pipeline as manual charts). */
export function buildAutoChartDrafts(
  snapshot: SheetSnapshot,
  profile: SheetColumnProfile,
): AutoChartSpec[] {
  const out: AutoChartSpec[] = []
  const nums = snapshot.columns.filter((c) => c.type === 'number')
  const dates = snapshot.columns.filter((c) => c.type === 'date')
  const texts = snapshot.columns.filter((c) => c.type === 'text')
  const yKey = profile.measureColumns[0]?.key ?? nums[0]?.key ?? ''
  const dateKey = profile.primaryDateKey ?? dates[0]?.key ?? ''
  const catKey = profile.categoryKeys[0] ?? texts[0]?.key ?? ''

  if (!yKey) return out

  const emptyFilters: ChartDraftState['filters'] = {}

  /* Trend line */
  if (dateKey) {
    out.push({
      title: 'Trend over time',
      draft: {
        title: 'Trend',
        chartType: 'line',
        xColumn: dateKey,
        yColumn: yKey,
        categoryColumn: '',
        sizeColumn: '',
        aggregation: 'sum',
        filters: emptyFilters,
        showDataLabels: false,
        includePivotTotalRows: false,
      },
    })
  }

  /* Top categories bar */
  if (catKey) {
    out.push({
      title: 'Totals by category',
      draft: {
        title: 'By category',
        chartType: 'bar',
        xColumn: catKey,
        yColumn: yKey,
        categoryColumn: '',
        sizeColumn: '',
        aggregation: 'sum',
        filters: emptyFilters,
        showDataLabels: false,
        includePivotTotalRows: false,
      },
    })
    out.push({
      title: 'Category mix',
      draft: {
        title: 'Share',
        chartType: 'donut',
        xColumn: catKey,
        yColumn: yKey,
        categoryColumn: '',
        sizeColumn: '',
        aggregation: 'sum',
        filters: emptyFilters,
        showDataLabels: false,
        includePivotTotalRows: false,
      },
    })
  }

  /* Scatter / correlation */
  if (nums.length >= 2) {
    const xk = nums[0]!.key
    const yk = nums[1]!.key
    if (xk !== yk) {
      out.push({
        title: 'Correlation',
        draft: {
          title: 'Relationship',
          chartType: 'scatter',
          xColumn: xk,
          yColumn: yk,
          categoryColumn: catKey || '',
          sizeColumn: '',
          aggregation: 'sum',
          filters: emptyFilters,
          showDataLabels: false,
          includePivotTotalRows: false,
        },
      })
    }
  }

  return out.slice(0, 5)
}
