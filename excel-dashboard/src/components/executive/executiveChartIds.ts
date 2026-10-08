/** Stable ids for customize-view toggles and chart sections */
export const EXEC_CHART_IDS = [
  'revenueGmBridge',
  'commitActualBridge',
  'peopleCostBreakdown',
  'monthlyTrend',
  'commitVsActual',
  'gmWatchlist',
  'revPerFte',
  'clientPareto',
  'clientMarginRank',
  'profitabilityMap',
  'clientCostChord',
  'movingBubbles',
  'timelineInfographic',
  'sankeyDiagram',
  'radarChart',
  'funnelChart',
  'customView',
  'lwCwWeeklyFinancial',
  'ahtPlannedVsActual',
  'attritionAssumptionVsActual',
  'shrinkageAssumptionVsActual',
  'headcountRequirementVsProjection',
  'opsMomTrending',
] as const

export type ExecChartId = (typeof EXEC_CHART_IDS)[number]

export const EXEC_CHART_LABELS: Record<ExecChartId, string> = {
  revenueGmBridge: 'Revenue to GM Bridge',
  commitActualBridge: 'Commit to Actual Bridge',
  peopleCostBreakdown: 'People Cost / Expense',
  monthlyTrend: 'Monthly Trend',
  commitVsActual: 'Commit vs Actual',
  gmWatchlist: 'GM Watchlist',
  revPerFte: 'Revenue per FTE',
  clientPareto: 'Client Pareto',
  clientMarginRank: 'Client Margin Ranking',
  profitabilityMap: 'Profitability Map',
  clientCostChord: 'Client Cost Chord',
  movingBubbles: 'Moving Client Bubbles',
  timelineInfographic: 'Timeline Infographic',
  sankeyDiagram: 'Sankey Diagram',
  radarChart: 'Radar Chart',
  funnelChart: 'Funnel Chart',
  customView: 'Custom View',
  lwCwWeeklyFinancial: 'LW‑CW Weekly Financial Metrics',
  ahtPlannedVsActual: 'AHT (Planned vs Actuals vs Cap)',
  attritionAssumptionVsActual: 'Attrition (Assumption vs Actuals)',
  shrinkageAssumptionVsActual: 'Shrinkage (Total vs Actual Total)',
  headcountRequirementVsProjection: 'Headcount (HC Requirement vs Projection)',
  opsMomTrending: 'Ops metrics charts & spreadsheet table',
}

export function defaultChartVisibility(): Record<ExecChartId, boolean> {
  const o = {} as Record<ExecChartId, boolean>
  const defaultOff = new Set<ExecChartId>([
    'movingBubbles',
    'timelineInfographic',
    'sankeyDiagram',
    'radarChart',
    'funnelChart',
    'customView',
    'clientCostChord',
    'commitActualBridge',
    'peopleCostBreakdown',
    'commitVsActual',
  ])
  for (const id of EXEC_CHART_IDS) {
    o[id] = !defaultOff.has(id)
  }
  return o
}
