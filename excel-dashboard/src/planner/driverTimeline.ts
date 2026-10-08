import type { ScenarioForecastPackage } from './forecasting'
import type { WeeklyLedgerRow } from './weeklyLedger'

/**
 * One week of every capacity driver, actual and forecast, in a single series.
 *
 * Splitting actuals and planned weeks into separate tables made the one
 * comparison that matters — how the forecast continues from the history — a
 * matter of reading two tables side by side. They are one timeline here, marked
 * by `timeline` so the rendering can colour them apart.
 */

export type DriverTimelineRow = {
  week: string
  timeline: 'actual' | 'forecast'
  volume: number | null
  /** Actual AHT for history; the driver's planned AHT for forward weeks. */
  aht: number | null
  /** Mix-adjusted AHT, where the nesting analysis produced one. */
  ahtAdjusted: number | null
  attritionHc: number | null
  /** Rates in 0–1. */
  absenteeism: number | null
  shrinkage: number | null
  nestingHc: number | null
  productionHc: number | null
  /** Cohort for a historical week, or the method behind a planned one. */
  note: string | null
}

export type AhtDetail = {
  /**
   * Handle time for production agents alone, with any nesting premium taken
   * out. Comparable across weeks whatever the mix was.
   */
  productionOnlyAht?: number | null
  /**
   * Handle time the floor actually runs at, nesting included — recorded on weeks
   * that have happened, planned on weeks that have not.
   *
   * Named for what it holds rather than as "adjusted", which read as either
   * direction and was filled the wrong way round twice.
   */
  withNestingAht?: number | null
  /**
   * Leavers the Capacity Plan is actually planning for that week.
   *
   * Taken from the plan rather than from the attrition forecast, because the
   * headcount beside it comes from the plan. Reading the two from different
   * places produced rows showing two leavers a week against a headcount that
   * never moved — each column right on its own, and the pair impossible.
   */
  attritionHc?: number | null
  nestingHc?: number | null
  productionHc?: number | null
  note?: string | null
}

function finite(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null
}

/** Actual driver values for one ledger week. */
function actualsOf(row: WeeklyLedgerRow) {
  const absenteeism = row.shrinkage.find((item) => item.id === 'absenteeism')?.actualPct
  const shrinkage = row.shrinkage.reduce((sum, item) => sum + Math.max(0, item.actualPct ?? 0), 0)
  return {
    volume: finite(row.actual?.callVolume),
    aht: finite(row.actual?.ahtSeconds),
    attritionHc: finite(row.actual?.attritionHc),
    absenteeism: finite(absenteeism),
    // A week with no shrinkage entries sums to zero, which is absence of data
    // rather than zero shrinkage.
    shrinkage: row.shrinkage.length ? finite(shrinkage) : null,
  }
}

/**
 * Forecast values keyed by week, taken from each driver's selected model.
 *
 * `ForecastPoint.label` carries the plan week, so values are matched by date
 * rather than by position — the horizons of different drivers need not align.
 */
export function forecastByWeek(
  forecast: ScenarioForecastPackage | null,
): Map<string, Map<string, number>> {
  const byWeek = new Map<string, Map<string, number>>()
  for (const metric of forecast?.metrics ?? []) {
    for (const point of metric.forecast) {
      if (!Number.isFinite(point.value)) continue
      let row = byWeek.get(point.label)
      if (!row) {
        row = new Map<string, number>()
        byWeek.set(point.label, row)
      }
      row.set(metric.metricId, point.value)
    }
  }
  return byWeek
}

export type StaffingHcDetail = {
  nestingHc: number | null
  productionHc: number | null
}

export function buildDriverTimeline(options: {
  ledger: WeeklyLedgerRow[]
  forecast: ScenarioForecastPackage | null
  /** Per-week AHT detail from the nesting-mix analysis, keyed by week. */
  ahtDetail?: Map<string, AhtDetail>
  /**
   * Nesting / Production HC from the Capacity staffing plan.
   * Used whenever AHT detail is missing for a week so the timeline still shows
   * the floor headcount the Mix-adj. AHT calculation is built from.
   */
  staffingHc?: Map<string, StaffingHcDetail>
  /** Most recent historical weeks to include. */
  historyWeeks?: number
  /** Forward weeks to include. */
  forecastWeeks?: number
}): DriverTimelineRow[] {
  const { ledger, forecast, ahtDetail, staffingHc, historyWeeks = 26, forecastWeeks = 26 } = options

  const planned = forecastByWeek(forecast)

  const resolveHc = (
    week: string,
    detail: AhtDetail | undefined,
  ): { nestingHc: number | null; productionHc: number | null } => {
    const fromStaffing = staffingHc?.get(week)
    return {
      nestingHc: finite(detail?.nestingHc) ?? finite(fromStaffing?.nestingHc),
      productionHc: finite(detail?.productionHc) ?? finite(fromStaffing?.productionHc),
    }
  }

  const history = ledger
    .filter((row) => row.timeline === 'historical_actual')
    .slice(-historyWeeks)
    .map((row): DriverTimelineRow => {
      const actual = actualsOf(row)
      const detail = ahtDetail?.get(row.week)
      const hc = resolveHc(row.week, detail)
      return {
        week: row.week,
        timeline: 'actual',
        volume: actual.volume,
        aht: finite(detail?.productionOnlyAht) ?? actual.aht,
        ahtAdjusted: finite(detail?.withNestingAht) ?? actual.aht,
        attritionHc: actual.attritionHc,
        absenteeism: actual.absenteeism,
        shrinkage: actual.shrinkage,
        nestingHc: hc.nestingHc,
        productionHc: hc.productionHc,
        note: detail?.note ?? null,
      }
    })

  const forward = ledger
    .filter((row) => row.timeline === 'forward_plan')
    .slice(0, forecastWeeks)
    .map((row): DriverTimelineRow => {
      const values = planned.get(row.week)
      const detail = ahtDetail?.get(row.week)
      const hc = resolveHc(row.week, detail)
      return {
        week: row.week,
        timeline: 'forecast',
        volume: finite(values?.get('callVolume')),
        // Production-only first, then the same week with nesting mixed in. The
        // second is what the plan staffs to, so it wins over the raw model
        // output wherever the AHT analysis produced one.
        aht: finite(detail?.productionOnlyAht) ?? finite(values?.get('ahtSeconds')),
        ahtAdjusted:
          finite(detail?.withNestingAht) ?? finite(values?.get('ahtSeconds')),
        attritionHc: finite(detail?.attritionHc) ?? finite(values?.get('attritionHc')),
        absenteeism: finite(values?.get('absenteeism')),
        shrinkage: finite(values?.get('totalShrinkagePct')),
        nestingHc: hc.nestingHc,
        productionHc: hc.productionHc,
        note: detail?.note ?? null,
      }
    })

  return [...history, ...forward]
}
