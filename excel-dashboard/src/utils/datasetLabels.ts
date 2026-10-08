import type { DatasetKind } from '../types/dashboard'

export function labelDatasetKind(kind: DatasetKind): string {
  switch (kind) {
    case 'datasheet':
      return 'PnL'
    case 'commit_vs_actuals':
      return 'Commit vs Actuals'
    case 'budget_vs_trending':
      return 'Budget vs Trending'
    case 'lw_cw_datasheet':
      return 'LW-CW'
    default:
      return kind.replace(/_/g, ' ')
  }
}

