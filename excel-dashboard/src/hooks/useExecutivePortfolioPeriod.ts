import { useEffect, useMemo, useState } from 'react'
import type { DerivedCapacityRow } from '../planner/capacityPlanDerived'
import type { CalendarQuarter, PeriodView } from '../utils/executiveQuarter'
import {
  capacityMonthOptions,
  listWeeksInCustomRange,
  resolveCapacityWeekWindow,
  uniqCapacityWeeks,
} from '../utils/capacityWeekRange'
import type { ExecutivePeriodKind } from '../components/executive/ExecutivePeriodFilter'

function yearOptionsFromWeeks(weeks: string[]): string[] {
  const years = new Set<string>()
  weeks.forEach((week) => {
    if (/^\d{4}/.test(week)) years.add(week.slice(0, 4))
  })
  if (!years.size) years.add(String(new Date().getFullYear()))
  return [...years].sort()
}

function formatPeriodLabel(
  periodKind: ExecutivePeriodKind,
  calendarYear: string,
  month: string,
  quarter: CalendarQuarter | '',
  weekStart: string,
  weekEnd: string,
): string {
  if (periodKind === 'custom' && weekStart && weekEnd) return `${weekStart} – ${weekEnd}`
  if (periodKind === 'month' && month) {
    const date = new Date(`${month}-01T12:00:00`)
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    }
  }
  if (periodKind === 'quarter' && quarter && calendarYear) return `${quarter} ${calendarYear}`
  if (periodKind === 'h1' && calendarYear) return `H1 ${calendarYear}`
  if (periodKind === 'h2' && calendarYear) return `H2 ${calendarYear}`
  if (periodKind === 'full_year' && calendarYear) {
    if (weekStart && weekEnd) return `FY ${calendarYear} · ${weekStart} – ${weekEnd}`
    return `FY ${calendarYear}`
  }
  if (weekStart && weekEnd) return `${weekStart} – ${weekEnd}`
  return 'All available weeks'
}

export function useExecutivePortfolioPeriod(capacityRows: DerivedCapacityRow[]) {
  const weekOptions = useMemo(() => uniqCapacityWeeks(capacityRows), [capacityRows])
  const monthOptions = useMemo(() => capacityMonthOptions(weekOptions), [weekOptions])
  const yearOptions = useMemo(() => yearOptionsFromWeeks(weekOptions), [weekOptions])

  const [periodKind, setPeriodKind] = useState<ExecutivePeriodKind>('full_year')
  const [calendarYear, setCalendarYear] = useState(() => yearOptions[yearOptions.length - 1] ?? String(new Date().getFullYear()))
  const [month, setMonth] = useState('')
  const [quarter, setQuarter] = useState<CalendarQuarter | ''>('Q1')
  const [weekStart, setWeekStart] = useState('')
  const [weekEnd, setWeekEnd] = useState('')

  useEffect(() => {
    if (!yearOptions.length) return
    if (!yearOptions.includes(calendarYear)) setCalendarYear(yearOptions[yearOptions.length - 1]!)
  }, [calendarYear, yearOptions])

  useEffect(() => {
    if (periodKind !== 'month' || !monthOptions.length) return
    const preferred = monthOptions.filter((item) => item.startsWith(calendarYear))
    const pool = preferred.length ? preferred : monthOptions
    if (!month || !pool.includes(month)) setMonth(pool[pool.length - 1]!)
  }, [periodKind, calendarYear, month, monthOptions])

  useEffect(() => {
    if (periodKind !== 'quarter') return
    if (!quarter) setQuarter('Q1')
  }, [periodKind, quarter])

  useEffect(() => {
    if (periodKind === 'custom') {
      if (!weekOptions.length) {
        setWeekStart('')
        setWeekEnd('')
        return
      }
      setWeekStart((prev) => (prev && weekOptions.includes(prev) ? prev : weekOptions[0]!))
      setWeekEnd((prev) => (prev && weekOptions.includes(prev) ? prev : weekOptions[weekOptions.length - 1]!))
      return
    }

    const periodView = periodKind as PeriodView
    const next = resolveCapacityWeekWindow(weekOptions, periodView, calendarYear, month, quarter)
    setWeekStart(next.weekStart)
    setWeekEnd(next.weekEnd)
  }, [calendarYear, month, periodKind, quarter, weekOptions])

  const effectiveRange = useMemo(() => {
    if (periodKind === 'custom') {
      const scoped = listWeeksInCustomRange(weekOptions, weekStart, weekEnd)
      if (!scoped.length) return { weekStart: '', weekEnd: '' }
      return { weekStart: scoped[0]!, weekEnd: scoped[scoped.length - 1]! }
    }
    return { weekStart, weekEnd }
  }, [periodKind, weekEnd, weekOptions, weekStart])

  const rangeLabel = formatPeriodLabel(
    periodKind,
    calendarYear,
    month,
    quarter,
    effectiveRange.weekStart,
    effectiveRange.weekEnd,
  )

  return {
    periodKind,
    setPeriodKind,
    calendarYear,
    setCalendarYear,
    yearOptions,
    month,
    setMonth,
    monthOptions,
    quarter,
    setQuarter,
    weekStart: effectiveRange.weekStart,
    weekEnd: effectiveRange.weekEnd,
    setWeekStart,
    setWeekEnd,
    weekOptions,
    rangeLabel,
  }
}
