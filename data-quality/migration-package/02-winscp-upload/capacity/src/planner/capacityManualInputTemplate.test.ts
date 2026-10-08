import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { isManualInputWorkbook, parseStaffingManualInputWorkbook } from './capacityManualInputTemplate'

describe('capacityManualInputTemplate', () => {
  it('round-trips planned and actual manual inputs by week', () => {
    const workbook = XLSX.utils.book_new()
    const rows = [
      {
        Week: '2026-01-05',
        WeekNumber: 1,
        ForecastVolume: 1000,
        PlannedAHT: 300,
        PlannedOccupancy: 85,
        PlannedNewHires: 2,
        ActualProductionHc: 40,
        OfferedVolume: 980,
      },
      {
        Week: '2026-01-12',
        WeekNumber: 2,
        ForecastVolume: 1100,
        PlannedOccupancy: 80,
      },
    ]
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Manual_Inputs')

    expect(isManualInputWorkbook(workbook)).toBe(true)

    const result = parseStaffingManualInputWorkbook(workbook, {
      mode: 'overwrite',
      weekStart: 'monday',
      includeRequiredFte: false,
      shrinkageCategories: [],
      supportRoles: [],
    })

    expect(result.success).toBe(true)
    expect(result.weeksApplied).toBe(2)
    expect(result.plannedByWeek['2026-01-05']?.callVolume).toBe(1000)
    expect(result.plannedByWeek['2026-01-05']?.ahtSeconds).toBe(300)
    expect(result.plannedByWeek['2026-01-05']?.occupancy).toBeCloseTo(0.85)
    expect(result.plannedByWeek['2026-01-05']?.plannedNewHires).toBe(2)
    expect(result.plannedByWeek['2026-01-12']?.callVolume).toBe(1100)
    expect(result.actualOverrides.find((item) => item.week === '2026-01-05')?.metrics.productionHc).toBe(40)
    expect(result.actualOverrides.find((item) => item.week === '2026-01-05')?.metrics.callVolume).toBe(980)
  })

  it('reads percents on a strict 0-100 scale, so sub-1% values survive a round trip', () => {
    // The sheet documents 0-100 and the prefill writes value*100, so a stored 0.8%
    // comes back as "0.8". The old >1 heuristic read that as 80% - a 100x inflation
    // from re-uploading an untouched cell.
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet([
        {
          Week: '2026-01-05',
          PlannedNestingAttritionPct: 0.8,
          PlannedTrainingAttritionPct: 0.5,
          PlannedOccupancy: 85,
        },
      ]),
      'Manual_Inputs',
    )

    const result = parseStaffingManualInputWorkbook(workbook, {
      mode: 'overwrite',
      weekStart: 'monday',
      includeRequiredFte: false,
      shrinkageCategories: [],
      supportRoles: [],
    })

    expect(result.success).toBe(true)
    expect(result.plannedByWeek['2026-01-05']?.nestingAttritionPct).toBeCloseTo(0.008)
    expect(result.plannedByWeek['2026-01-05']?.trainingAttritionPct).toBeCloseTo(0.005)
    expect(result.plannedByWeek['2026-01-05']?.occupancy).toBeCloseTo(0.85)
  })

  it('append mode skips existing planned values', () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet([{ Week: '2026-01-05', ForecastVolume: 999, PlannedAHT: 250 }]),
      'Manual_Inputs',
    )

    const result = parseStaffingManualInputWorkbook(workbook, {
      mode: 'append',
      weekStart: 'monday',
      includeRequiredFte: false,
      shrinkageCategories: [],
      supportRoles: [],
      existingPlanned: {
        '2026-01-05': { callVolume: 1000 },
      },
    })

    expect(result.success).toBe(true)
    expect(result.plannedByWeek['2026-01-05']?.callVolume).toBeUndefined()
    expect(result.plannedByWeek['2026-01-05']?.ahtSeconds).toBe(250)
  })
})
