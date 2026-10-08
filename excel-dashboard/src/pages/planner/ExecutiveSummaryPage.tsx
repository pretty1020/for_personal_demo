import { OperationsLatestKpis } from '../../components/planner/OperationsLatestKpis'
import { ChannelStaffingSummary } from '../../components/planner/ChannelStaffingSummary'
import { WorkforceSummaryKpis } from '../../components/planner/WorkforceSummaryKpis'
import { PlannerChartCard } from '../../components/planner/PlannerChartCard'
import { usePlanner } from '../../context/PlannerContext'
import { METRIC_LABELS } from '../../planner/metricLabels'
import { APP_THEME } from '../../utils/appTheme'
import {
  compactAxisTooltip,
  compactCategoryAxis,
  compactGrid,
  compactLegend,
  compactValueAxis,
} from '../../utils/echartsCompact'

export function ExecutiveSummaryPage() {
  const { activeResult } = usePlanner()
  const s = activeResult?.summary

  if (!activeResult || !s) {
    return <p className="saas-muted">Select a scenario in Planning Scenario.</p>
  }

  const periods = activeResult.periods.slice(0, 26)
  const labels = periods.map((p) => p.periodLabel)

  const staffingOption = {
    tooltip: compactAxisTooltip(),
    legend: compactLegend([METRIC_LABELS.requiredHeadcount, METRIC_LABELS.productionHeadcount, METRIC_LABELS.productionFte]),
    grid: compactGrid(),
    xAxis: compactCategoryAxis(labels),
    yAxis: compactValueAxis(),
    color: APP_THEME.chart,
    series: [
      { name: METRIC_LABELS.requiredHeadcount, type: 'bar', barMaxWidth: 18, data: periods.map((p) => +p.requiredFte.toFixed(1)) },
      { name: METRIC_LABELS.productionHeadcount, type: 'line', symbolSize: 6, lineStyle: { width: 2 }, data: periods.map((p) => +p.scheduledFte.toFixed(1)) },
      { name: METRIC_LABELS.productionFte, type: 'line', symbolSize: 6, lineStyle: { width: 2 }, data: periods.map((p) => +p.productiveFte.toFixed(1)) },
    ],
  }

  const hiringOption = {
    tooltip: compactAxisTooltip(),
    legend: compactLegend(['Hiring', 'Attrition']),
    grid: compactGrid(),
    xAxis: compactCategoryAxis(labels),
    yAxis: compactValueAxis(),
    color: APP_THEME.chart,
    series: [
      { name: 'Hiring', type: 'bar', barMaxWidth: 18, data: periods.map((p) => p.hiringPlanned) },
      { name: 'Attrition', type: 'line', smooth: true, symbolSize: 6, lineStyle: { width: 2 }, data: periods.map((p) => +p.attritionPlanned.toFixed(1)) },
    ],
  }

  const hoursOption = {
    tooltip: compactAxisTooltip(),
    legend: compactLegend(['Scheduled', 'Payroll', 'Productive', 'OT']),
    grid: compactGrid(),
    xAxis: compactCategoryAxis(labels),
    yAxis: compactValueAxis(),
    color: APP_THEME.chart,
    series: [
      { name: 'Scheduled', type: 'line', smooth: true, symbolSize: 5, lineStyle: { width: 2 }, data: periods.map((p) => Math.round(p.scheduledHours)) },
      { name: 'Payroll', type: 'line', smooth: true, symbolSize: 5, lineStyle: { width: 2 }, data: periods.map((p) => Math.round(p.payrollHours)) },
      { name: 'Productive', type: 'line', smooth: true, symbolSize: 5, lineStyle: { width: 2 }, data: periods.map((p) => Math.round(p.productiveHours)) },
      { name: 'OT', type: 'bar', barMaxWidth: 14, data: periods.map((p) => Math.round(p.otHours)) },
    ],
  }

  const utilizationOption = {
    tooltip: compactAxisTooltip(),
    legend: compactLegend(['Occupancy', 'Productivity', 'Utilization', 'SLA']),
    grid: compactGrid(52),
    xAxis: compactCategoryAxis(labels),
    yAxis: compactValueAxis({ percent: true, min: 0.75, max: 1 }),
    color: APP_THEME.chart,
    series: [
      { name: 'Occupancy', type: 'line', smooth: true, symbolSize: 5, lineStyle: { width: 2 }, data: periods.map((p) => p.occupancy) },
      { name: 'Productivity', type: 'line', smooth: true, symbolSize: 5, lineStyle: { width: 2 }, data: periods.map((p) => p.productivity) },
      { name: 'Utilization', type: 'line', smooth: true, symbolSize: 5, lineStyle: { width: 2 }, data: periods.map((p) => p.utilization) },
      { name: 'SLA', type: 'line', smooth: true, symbolSize: 5, lineStyle: { width: 2 }, data: periods.map((p) => p.serviceLevel) },
    ],
  }

  const shrinkOption = {
    tooltip: compactAxisTooltip(),
    legend: compactLegend(['In-office', 'Out-of-office']),
    grid: compactGrid(),
    xAxis: compactCategoryAxis(labels),
    yAxis: compactValueAxis(),
    color: APP_THEME.chart,
    series: [
      { name: 'In-office', type: 'bar', stack: 'shrink', barMaxWidth: 22, data: periods.map((p) => Math.round(p.shrinkageInOfficeHours)) },
      { name: 'Out-of-office', type: 'bar', stack: 'shrink', barMaxWidth: 22, data: periods.map((p) => Math.round(p.shrinkageOutOfOfficeHours)) },
    ],
  }

  return (
    <div className="space-y-4">
      <WorkforceSummaryKpis summary={s} compact hideFinancial />

      {s.channelStaffing ? (
        <ChannelStaffingSummary staffing={s.channelStaffing} financials={s.channelFinancials} showFinancials={false} />
      ) : null}

      <OperationsLatestKpis result={activeResult} />

      <div className="exec-chart-grid exec-chart-grid--compact">
        <PlannerChartCard title="Staffing requirements vs supply" option={staffingOption} defaultHidden={false} />
        <PlannerChartCard title="Hiring & attrition" option={hiringOption} defaultHidden={false} />
        <PlannerChartCard title="Hours breakdown" option={hoursOption} defaultHidden={false} />
        <PlannerChartCard title="Shrinkage hours" option={shrinkOption} defaultHidden={false} />
        <PlannerChartCard title="Performance metrics" option={utilizationOption} defaultHidden={false} />
      </div>

      <p className="cap-planning-financial-hidden saas-muted m-0 text-sm">
        Revenue and cost are on Financials.
      </p>
    </div>
  )
}
