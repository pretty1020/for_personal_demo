import * as XLSX from 'xlsx'
import type { GeneratedSchedulingPackage } from './types'
import type { SchedulingSettings } from './schedulingSettingsTypes'
import { allIntervalTimes } from './intervalSlots'
import { formatDayLabel } from './intervalSlots'
import {
  weeklyAgentGridDataRow,
  weeklyAgentGridHeaderRow,
  countOnShiftAgentsPerInterval,
} from './agentScheduleGrid'

export const SCHEDULING_EXPORT_FILENAME = 'Scheduling_Output.xlsx'
export const AGENT_SCHEDULE_EXPORT_FILENAME = 'Agent_Schedule.xlsx'

function statusLabel(status: string): string {
  if (status === 'productive') return 'On'
  if (status === 'lunch') return 'Lunch'
  if (status === 'break') return 'Break'
  return 'Off'
}

export function buildSchedulingExportWorkbook(
  pkg: GeneratedSchedulingPackage,
  scenarioLabel: string,
  settings?: Pick<SchedulingSettings, 'fteDailyDivisorHours' | 'fteWeeklyDivisorHours' | 'shiftLengthHours'>,
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  const intervals = allIntervalTimes()
  const shiftLengthHours = settings?.shiftLengthHours ?? 8
  const paidHours = settings?.fteWeeklyDivisorHours ?? 45
  const intervalDivisor = 2

  const summaryRows: (string | number)[][] = [
    ['Scheduling output summary'],
    ['Scenario', scenarioLabel],
    ['Generated at', new Date(pkg.generatedAt).toLocaleString()],
    ['Production HC', pkg.productionHc],
    ['Weekly required FTE (avg)', pkg.schedulingResult.totals.requiredFte],
    ['Week total required FTE', pkg.schedulingResult.totals.weeklySumRequired ?? pkg.requirementTable.weeklyFteTarget],
    ['Week total scheduled', pkg.schedulingResult.totals.weeklySumScheduled ?? pkg.schedulingResult.totals.scheduledFte],
    ['Week interval sum', pkg.schedulingResult.totals.weeklyScheduledIntervalSum ?? ''],
    ['Variance', pkg.schedulingResult.totals.variance],
    ['Staffing %', pkg.schedulingResult.totals.staffingPct ?? ''],
    ['HoOP (from pattern)', pkg.patternMeta.hoursOfOperation.label],
    ['Working days', pkg.patternMeta.workingDays.map((d) => formatDayLabel(d)).join(', ')],
    ['Rest days', pkg.patternMeta.restDays.map((d) => formatDayLabel(d)).join(', ') || '—'],
    [],
    ['Formulas'],
    ['Net FTE (daily)', `SUM(day Net FTE intervals) ÷ ${shiftLengthHours} ÷ ${intervalDivisor}`],
    ['Net FTE (week)', `SUM(week Net FTE intervals) ÷ ${paidHours} ÷ ${intervalDivisor}`],
    [],
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), 'Summary')

  const matrix = pkg.metricsMatrix
  const matrixRows: (string | number)[][] = [
    ['Staffing quality matrix'],
    ['Metric', 'Value', 'Note'],
    ['SLA Percent', matrix.slaPercent, 'Input'],
    ['SLA Seconds', matrix.slaSeconds, 'Input'],
    ['Occupancy', matrix.occupancyPct ?? '', matrix.hasVolumeAht ? 'Per interval (Volume×AHT)' : 'Per interval (proxy)'],
    ['Pure FTE Req', matrix.pureFteReq, 'Required FTE'],
    ['Pure FTE Staff Totals', matrix.scheduledHeadcount, 'Scheduled HC'],
    ['Net FTE Total', matrix.pureFteStaffTotals, 'Scheduled FTE (net)'],
    ['Apply Shrinkage', matrix.shrinkagePct ?? '', 'Input'],
    ['SCF %', matrix.scfPct ?? '', 'Scheduled ÷ Required'],
    ['Projected Service Level', matrix.projectedServiceLevelPct ?? '', 'Highest of normal SL and Erlang C'],
    ['Projected SL (Erlang C)', matrix.projectedServiceLevelErlangPct ?? '', matrix.hasVolumeAht ? 'Erlang C' : 'Upload Volume/AHT'],
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matrixRows), 'Quality_Matrix')

  const dailyRows: (string | number)[][] = [
    [
      'Day',
      'Date',
      'Required FTE (daily)',
      'Scheduled interval sum',
      'Net FTE interval sum',
      'Net FTE (Daily)',
      'Variance',
      'Staffing %',
      'Over intervals',
      'Under intervals',
    ],
    [],
    [`Net FTE (Daily) = SUM(day Net FTE intervals) ÷ ${shiftLengthHours} ÷ ${intervalDivisor}`],
    [`Net FTE (week) = SUM(week Net FTE intervals) ÷ ${paidHours} ÷ ${intervalDivisor}`],
    [],
  ]
  for (const day of pkg.schedulingResult.days) {
    dailyRows.push([
      day.dateLabel,
      day.day,
      day.dailyRequiredTotal,
      day.dailyScheduledIntervalSum,
      day.dailyProductiveIntervalSum ?? 0,
      day.dailyNetFteTotal ?? 0,
      day.dailyVariance,
      day.dailyStaffingPct ?? '',
      day.overstaffedIntervals,
      day.understaffedIntervals,
    ])
  }
  dailyRows.push([
    'Week total',
    '',
    pkg.schedulingResult.totals.weeklySumRequired ?? pkg.requirementTable.weeklyFteTarget,
    pkg.schedulingResult.totals.weeklyScheduledGrossIntervalSum ?? '',
    pkg.schedulingResult.totals.weeklyScheduledIntervalSum ?? '',
    pkg.schedulingResult.totals.weeklySumScheduled ?? pkg.schedulingResult.totals.scheduledFte,
    pkg.schedulingResult.totals.variance,
    pkg.schedulingResult.totals.staffingPct ?? '',
    pkg.schedulingResult.totals.overstaffedIntervals,
    pkg.schedulingResult.totals.understaffedIntervals,
  ])
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dailyRows), 'Daily_FTE')

  const weekDates = pkg.requirementTable.days.map((day) => day.day)
  const onShiftByDay = countOnShiftAgentsPerInterval(weekDates, pkg.agentSchedules)
  const schedHeader = ['Interval', ...pkg.schedulingResult.days.map((day) => formatDayLabel(day.day))]
  const schedRows: (string | number)[][] = [
    schedHeader,
    ...intervals.map((interval) => [
      interval,
      ...pkg.schedulingResult.days.map((day) => onShiftByDay[day.day]?.[interval] ?? 0),
    ]),
  ]
  schedRows.push([
    'Net FTE (Daily)',
    ...pkg.schedulingResult.days.map((day) => day.dailyNetFteTotal ?? 0),
  ])
  schedRows.push([
    'Scheduled interval sum',
    ...pkg.schedulingResult.days.map((day) => day.dailyScheduledIntervalSum),
  ])
  schedRows.push([
    'Net FTE interval sum',
    ...pkg.schedulingResult.days.map((day) => day.dailyProductiveIntervalSum ?? 0),
  ])
  schedRows.push([
    'Net FTE (week)',
    pkg.schedulingResult.totals.weeklySumScheduled ?? '',
  ])
  schedRows.push([])
  schedRows.push([
    'Daily formula',
    ...pkg.schedulingResult.days.map(() => `SUM(Net FTE day) ÷ ${shiftLengthHours} ÷ 2`),
  ])
  schedRows.push(['Week formula', `SUM(Net FTE week) ÷ ${paidHours} ÷ ${intervalDivisor}`])
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(schedRows), 'Scheduled_Intervals')

  const reqHeader = ['Interval', ...pkg.requirementTable.days.map((d) => formatDayLabel(d.day)), 'Week total']
  const reqRows: (string | number)[][] = [reqHeader]
  for (const interval of intervals) {
    reqRows.push([
      interval,
      ...pkg.requirementTable.days.map((day) => day.intervals[interval] ?? 0),
      pkg.requirementTable.totals[interval] ?? 0,
    ])
  }
  reqRows.push([
    'Daily target',
    ...pkg.requirementTable.days.map((day) => day.dailyFte),
    pkg.schedulingResult.totals.requiredFte,
  ])
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(reqRows), 'Generated_Requirements')

  const compareRows: (string | number)[][] = [
    [
      'Day',
      'Interval',
      'Required FTE',
      'Scheduled FTE',
      'Net FTE',
      'Net FTE after shrinkage',
      'Variance',
      'Projected SL %',
      'Projected SL (Erlang) %',
      'Occupancy %',
      'Staffing %',
      'Status',
    ],
  ]
  for (const day of pkg.schedulingResult.days) {
    for (const row of day.intervals) {
      if (row.requiredFte <= 0.01) continue
      const status = row.variance > 0.01 ? 'Over' : row.variance < -0.01 ? 'Under' : 'Match'
      compareRows.push([
        day.dateLabel,
        row.interval,
        row.requiredFte,
        row.scheduledFte,
        row.netFte ?? 0,
        row.netFteAfterShrinkage ?? row.netFte ?? 0,
        row.variance,
        row.projectedSlPct ?? '',
        row.projectedSlErlangPct ?? '',
        row.occupancyPct ?? '',
        row.staffingPct ?? '',
        status,
      ])
    }
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(compareRows), 'Interval_Comparison')

  const dailyCompareRows: (string | number)[][] = [
    ['Day', 'Required FTE', 'Net FTE (Daily)', 'Variance', 'Staffing %'],
  ]
  for (const day of pkg.schedulingResult.days) {
    dailyCompareRows.push([
      day.dateLabel,
      day.dailyRequiredTotal,
      day.dailyNetFteTotal ?? 0,
      day.dailyVariance,
      day.dailyStaffingPct ?? '',
    ])
  }
  dailyCompareRows.push([
    'Week total',
    pkg.schedulingResult.totals.weeklySumRequired ?? pkg.requirementTable.weeklyFteTarget,
    pkg.schedulingResult.totals.weeklySumScheduled ?? '',
    pkg.schedulingResult.totals.variance,
    pkg.schedulingResult.totals.staffingPct ?? '',
  ])
  dailyCompareRows.push(
    [],
    ['Use this sheet to build an Excel chart: Required vs Net FTE (Daily) by day.'],
  )
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dailyCompareRows), 'Daily_Compare_Chart')

  const grid = pkg.weeklyAgentGrid
  const agentRows: (string | number)[][] = [weeklyAgentGridHeaderRow(grid)]
  for (const row of grid.rows) {
    agentRows.push(weeklyAgentGridDataRow(grid, row))
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(agentRows), 'Agent_Schedule')

  const detailRows: (string | number)[][] = [
    ['Day', 'Agent', 'Shift', 'Interval', 'Status'],
  ]
  for (const daySchedule of pkg.agentSchedules) {
    for (const agent of daySchedule.agents) {
      for (const [interval, status] of Object.entries(agent.intervals)) {
        if (status === 'off') continue
        detailRows.push([
          daySchedule.dateLabel,
          agent.agentLabel,
          `${agent.shiftStart}-${agent.shiftEnd}`,
          interval,
          statusLabel(status),
        ])
      }
    }
  }
  detailRows.push([])
  detailRows.push(['Interval staffing counts productive time only (excludes OFF, lunch, and breaks).'])
  detailRows.push(['Break/lunch columns follow the schedule pattern constraint when it is enabled.'])
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detailRows), 'Agent_Interval_Detail')

  const scheduleRows: (string | number)[][] = [
    [
      'Day',
      'Agent',
      'Shift template',
      'Shift start',
      'Shift end',
      'Lunch start',
      'Lunch end',
      'Break 1 start',
      'Break 1 end',
      'Break 2 start',
      'Break 2 end',
      ...intervals,
    ],
  ]
  for (const day of pkg.agentSchedules) {
    for (const agent of day.agents) {
      scheduleRows.push([
        day.dateLabel,
        agent.agentLabel,
        agent.templateLabel,
        agent.shiftStart,
        agent.shiftEnd,
        agent.lunchStart,
        agent.lunchEnd,
        agent.break1Start,
        agent.break1End,
        agent.break2Start,
        agent.break2End,
        ...intervals.map((interval) => statusLabel(agent.intervals[interval] ?? 'off')),
      ])
    }
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(scheduleRows), 'Agent_Schedules')

  return wb
}

export function buildAgentScheduleWorkbook(pkg: GeneratedSchedulingPackage): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  const grid = pkg.weeklyAgentGrid
  const rows: (string | number)[][] = [weeklyAgentGridHeaderRow(grid)]
  for (const row of grid.rows) {
    rows.push(weeklyAgentGridDataRow(grid, row))
  }
  rows.push([])
  rows.push(['Notes'])
  rows.push(['Day columns show shift start–end (HH:mm–HH:mm) or OFF for rest days.'])
  rows.push(['Break/lunch column order follows the checked schedule pattern constraint.'])
  rows.push(['Interval staffing counts productive time only (excludes OFF, lunch, and breaks).'])
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Agent_Schedule')
  return wb
}

export function downloadAgentScheduleExport(pkg: GeneratedSchedulingPackage): void {
  XLSX.writeFile(buildAgentScheduleWorkbook(pkg), AGENT_SCHEDULE_EXPORT_FILENAME)
}

export function downloadSchedulingExport(
  pkg: GeneratedSchedulingPackage,
  scenarioLabel: string,
  settings?: Pick<SchedulingSettings, 'fteDailyDivisorHours' | 'fteWeeklyDivisorHours' | 'shiftLengthHours'>,
): void {
  XLSX.writeFile(buildSchedulingExportWorkbook(pkg, scenarioLabel, settings), SCHEDULING_EXPORT_FILENAME)
}

export async function captureSchedulingChartsPng(chartRoots: HTMLElement[]): Promise<Blob | null> {
  const html2canvas = (await import('html2canvas')).default
  const canvases: HTMLCanvasElement[] = []
  for (const root of chartRoots) {
    const canvas = await html2canvas(root, {
      backgroundColor: '#ffffff',
      scale: 2,
      logging: false,
    })
    canvases.push(canvas)
  }
  if (!canvases.length) return null

  const width = Math.max(...canvases.map((canvas) => canvas.width))
  const height = canvases.reduce((sum, canvas) => sum + canvas.height + 24, 0)
  const merged = document.createElement('canvas')
  merged.width = width
  merged.height = height
  const ctx = merged.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  let offsetY = 0
  for (const canvas of canvases) {
    ctx.drawImage(canvas, 0, offsetY)
    offsetY += canvas.height + 24
  }
  return new Promise((resolve) => merged.toBlob((blob) => resolve(blob), 'image/png'))
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
