import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import {
  applyShrinkageToNetFte,
  buildApplyShrinkageOptions,
  clearApplyShrinkage,
  combinedApplyShrinkagePct,
  effectiveApplyShrinkagePct,
  flatShrinkageAssumptionPct,
  parseShrinkageWorkbook,
  shrinkageFactorFromPct,
  withFlatShrinkageAssumption,
} from './applyShrinkage'
import { createDefaultSchedulingWorkspace } from './persistence'
import { parseScheduleDayCell } from './scheduleGridEdit'
import { aggregateDayCoverage, aggregateGrossShiftCoverage, type AgentShiftAssignment } from './scheduleGeneration'
import { buildSchedulingResult, defaultSchedulingRules } from './scheduleOptimization'
import type { GeneratedRequirementTable } from './requirementGeneration'
import type { PatternScheduleMeta } from './patternAnalysis'

describe('applyShrinkage', () => {
  it('combines and caps at 100', () => {
    expect(combinedApplyShrinkagePct(5, 8)).toBe(13)
    expect(combinedApplyShrinkagePct(60, 50)).toBe(100)
    expect(combinedApplyShrinkagePct(-1, 10)).toBe(10)
  })

  it('converts pct to factor and applies to net FTE', () => {
    expect(shrinkageFactorFromPct(10)).toBeCloseTo(0.9)
    expect(applyShrinkageToNetFte(20, 10)).toBeCloseTo(18)
    expect(applyShrinkageToNetFte(20, 0)).toBe(20)
    // Net FTE 7 × (1 − 12%) = 6.16
    expect(applyShrinkageToNetFte(7, 12)).toBeCloseTo(6.16)
    // Net FTE 7 × (1 − 1%) = 6.93
    expect(applyShrinkageToNetFte(7, 1)).toBeCloseTo(6.93)
  })

  it('effectiveApplyShrinkagePct uses flat or interval average', () => {
    const workspace = createDefaultSchedulingWorkspace('sc1')
    workspace.applyAbsenteeismPct = 4.7
    workspace.applyInOfficePct = 0
    expect(effectiveApplyShrinkagePct(workspace)).toBeCloseTo(4.7)
    workspace.applyShrinkageMode = 'per_interval'
    workspace.intervalApplyShrinkagePct = {
      '2026-08-16': { '08:00': 10, '08:30': 20 },
    }
    expect(effectiveApplyShrinkagePct(workspace)).toBeCloseTo(15)
  })

  it('flatShrinkageAssumptionPct sums legacy abs+in-office into one assumption', () => {
    const workspace = createDefaultSchedulingWorkspace('sc1')
    workspace.applyAbsenteeismPct = 5
    workspace.applyInOfficePct = 7
    expect(flatShrinkageAssumptionPct(workspace)).toBe(12)
    const next = withFlatShrinkageAssumption(workspace, 12)
    expect(next.applyAbsenteeismPct).toBe(12)
    expect(next.applyInOfficePct).toBe(0)
    expect(next.shrinkagePct).toBe(12)
  })

  it('clearApplyShrinkage resets maps and pcts', () => {
    const workspace = createDefaultSchedulingWorkspace('sc1')
    workspace.applyAbsenteeismPct = 5
    workspace.applyInOfficePct = 8
    workspace.intervalApplyShrinkagePct = { '2026-08-16': { '08:00': 12 } }
    const cleared = clearApplyShrinkage(workspace)
    expect(cleared.applyAbsenteeismPct).toBe(0)
    expect(cleared.applyInOfficePct).toBe(0)
    expect(cleared.intervalApplyShrinkagePct).toEqual({})
    expect(cleared.shrinkagePct).toBe(0)
  })
})

describe('scheduleGridEdit parse', () => {
  it('accepts OFF, VL, and HH:MM-HH:MM', () => {
    expect(parseScheduleDayCell('OFF').ok).toBe(true)
    expect(parseScheduleDayCell('vl').ok).toBe(true)
    const shift = parseScheduleDayCell('09:00-17:00')
    expect(shift.ok).toBe(true)
    if (shift.ok && shift.value.kind === 'shift') {
      expect(shift.value.startMinutes).toBe(9 * 60)
      expect(shift.value.endMinutes).toBe(17 * 60)
    }
  })

  it('rejects invalid formats', () => {
    expect(parseScheduleDayCell('').ok).toBe(false)
    expect(parseScheduleDayCell('9-5').ok).toBe(false)
    expect(parseScheduleDayCell('25:00-26:00').ok).toBe(false)
  })
})

describe('VL exclusion and apply shrinkage once', () => {
  const templates = defaultSchedulingRules().shiftTemplates
  const day = '2026-08-17'
  const interval = '09:00'

  const requirementTable: GeneratedRequirementTable = {
    weeklyFteTarget: 1,
    days: [
      {
        day,
        intervals: { [interval]: 2, '09:30': 2 },
        dailyFte: 1,
      },
    ],
    totals: { [interval]: 2, '09:30': 2 },
  }

  const patternMeta: PatternScheduleMeta = {
    workingDays: [day],
    restDays: [],
    hoursOfOperation: {
      label: '09:00 – 10:00',
      start: '09:00',
      end: '10:00',
      intervals: [interval, '09:30'],
    },
    hoopByDay: {
      [day]: {
        day,
        start: '09:00',
        end: '10:00',
        label: '09:00 – 10:00',
        intervals: [interval, '09:30'],
      },
    },
    hoopIntervalSet: new Set([interval, '09:30']),
  }

  const shiftAssignment: AgentShiftAssignment = {
    agentIndex: 0,
    templateId: templates[0]!.id,
    startMinutes: templates[0]!.startMinutes,
    lunchStart: templates[0]!.startMinutes + 180,
    lunchEnd: templates[0]!.startMinutes + 210,
    breaks: [],
    kind: 'shift',
  }

  const vlAssignment: AgentShiftAssignment = {
    kind: 'vl',
    agentIndex: 1,
    templateId: 'vl',
    startMinutes: 0,
    lunchStart: 0,
    lunchEnd: 0,
    breaks: [],
  }

  it('excludes VL from gross and productive coverage', () => {
    const withVl = [shiftAssignment, vlAssignment]
    const withoutVl = [shiftAssignment]
    expect(aggregateGrossShiftCoverage(withVl, templates)).toEqual(
      aggregateGrossShiftCoverage(withoutVl, templates),
    )
    expect(aggregateDayCoverage(withVl, templates)).toEqual(aggregateDayCoverage(withoutVl, templates))
  })

  it('applies shrinkage once to net and variance', () => {
    const assignmentsByDay = { [day]: [shiftAssignment, vlAssignment] }
    const raw = buildSchedulingResult(
      requirementTable,
      2,
      defaultSchedulingRules(),
      patternMeta,
      assignmentsByDay,
      undefined,
      { flatApplyShrinkagePct: 0 },
    )
    const shrunk = buildSchedulingResult(
      requirementTable,
      2,
      defaultSchedulingRules(),
      patternMeta,
      assignmentsByDay,
      undefined,
      { flatApplyShrinkagePct: 10 },
    )
    const rawRow = raw.days[0]!.intervals.find((row) => row.interval === interval)!
    const shrunkRow = shrunk.days[0]!.intervals.find((row) => row.interval === interval)!
    expect(shrunkRow.scheduledFte).toBe(rawRow.scheduledFte)
    expect(shrunkRow.netFte).toBeCloseTo(rawRow.netFte ?? 0)
    expect(shrunkRow.netFteAfterShrinkage).toBeCloseTo((rawRow.netFte ?? 0) * 0.9)
    expect(shrunkRow.variance).toBeCloseTo((shrunkRow.netFteAfterShrinkage ?? 0) - shrunkRow.requiredFte)
  })

  it('uses Net FTE for variance when shrinkage is 0%', () => {
    const assignmentsByDay = { [day]: [shiftAssignment] }
    const result = buildSchedulingResult(
      requirementTable,
      1,
      defaultSchedulingRules(),
      patternMeta,
      assignmentsByDay,
      undefined,
      { flatApplyShrinkagePct: 0 },
    )
    const row = result.days[0]!.intervals.find((item) => item.interval === interval)!
    expect(row.netFteAfterShrinkage).toBeCloseTo(row.netFte ?? 0)
    expect(row.variance).toBeCloseTo((row.netFte ?? 0) - row.requiredFte)
  })

  it('applies 1% flat shrinkage as Net FTE × 0.99 on every interval', () => {
    const assignmentsByDay = { [day]: [shiftAssignment] }
    const result = buildSchedulingResult(
      requirementTable,
      1,
      defaultSchedulingRules(),
      patternMeta,
      assignmentsByDay,
      undefined,
      { flatApplyShrinkagePct: 1 },
    )
    for (const row of result.days[0]!.intervals) {
      expect(row.netFteAfterShrinkage).toBeCloseTo((row.netFte ?? 0) * 0.99)
      expect(row.variance).toBeCloseTo((row.netFteAfterShrinkage ?? 0) - row.requiredFte)
    }
  })

  it('keeps Scheduled and Net FTE unchanged when shrinkage is applied', () => {
    const assignmentsByDay = { [day]: [shiftAssignment] }
    const raw = buildSchedulingResult(
      requirementTable,
      1,
      defaultSchedulingRules(),
      patternMeta,
      assignmentsByDay,
      undefined,
      { flatApplyShrinkagePct: 0 },
    )
    const shrunk = buildSchedulingResult(
      requirementTable,
      1,
      defaultSchedulingRules(),
      patternMeta,
      assignmentsByDay,
      undefined,
      { flatApplyShrinkagePct: 12 },
    )
    for (const rawRow of raw.days[0]!.intervals) {
      const shrunkRow = shrunk.days[0]!.intervals.find((row) => row.interval === rawRow.interval)!
      expect(shrunkRow.scheduledFte).toBe(rawRow.scheduledFte)
      expect(shrunkRow.netFte).toBe(rawRow.netFte)
      expect(shrunkRow.netFteAfterShrinkage).toBeCloseTo((rawRow.netFte ?? 0) * 0.88)
    }
  })

  it('flat mode ignores leftover per-interval upload map', () => {
    const workspace = createDefaultSchedulingWorkspace('sc1')
    workspace.applyShrinkageMode = 'flat'
    workspace.applyAbsenteeismPct = 1
    workspace.applyInOfficePct = 0
    workspace.intervalApplyShrinkagePct = {
      '2026-08-23': { '00:00': 100, '00:30': 100 },
    }
    const options = buildApplyShrinkageOptions(workspace)
    expect(options.intervalApplyShrinkagePct).toBeUndefined()
    expect(options.flatApplyShrinkagePct).toBe(1)
  })

  it('parses Shrinkage_Pct upload workbook', () => {
    const rows = [
      ['Day', 'Interval', 'Shrinkage_Pct'],
      ['Sunday', '00:00', 1],
      ['Sunday', '00:30', 1],
    ]
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'ApplyShrinkage')
    const weekDates = [
      '2026-08-23',
      '2026-08-24',
      '2026-08-25',
      '2026-08-26',
      '2026-08-27',
      '2026-08-28',
      '2026-08-29',
    ]
    const parsed = parseShrinkageWorkbook(workbook, weekDates)
    expect(parsed.rows.length).toBe(2)
    expect(parsed.intervalApplyShrinkagePct['2026-08-23']?.['00:00']).toBe(1)
    expect(parsed.intervalApplyShrinkagePct['2026-08-23']?.['00:30']).toBe(1)
  })
})
