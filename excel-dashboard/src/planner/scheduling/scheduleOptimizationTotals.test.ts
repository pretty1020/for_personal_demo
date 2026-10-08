import { describe, expect, it } from 'vitest'
import { buildSchedulingResult, defaultSchedulingRules } from './scheduleOptimization'
import { buildSchedulingMetricsMatrix } from './schedulingMetrics'
import type { GeneratedRequirementTable } from './requirementGeneration'
import type { PatternScheduleMeta } from './patternAnalysis'
import type { AgentShiftAssignment } from './scheduleGeneration'

describe('weekly FTE denominators', () => {
  const rules = defaultSchedulingRules()
  const workingDays = ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20']
  const requirementTable: GeneratedRequirementTable = {
    weeklyFteTarget: 0,
    days: workingDays.map((day) => ({
      day,
      dailyFte: 1,
      intervals: { '09:00': 2, '09:30': 2 },
    })),
    totals: { '09:00': 8, '09:30': 8 },
  }
  const patternMeta: PatternScheduleMeta = {
    workingDays,
    restDays: [],
    hoursOfOperation: {
      label: '09:00 – 10:00',
      start: '09:00',
      end: '10:00',
      intervals: ['09:00', '09:30'],
    },
    hoopByDay: Object.fromEntries(
      workingDays.map((day) => [
        day,
        {
          day,
          start: '09:00',
          end: '10:00',
          label: '09:00 – 10:00',
          intervals: ['09:00', '09:30'],
        },
      ]),
    ),
    hoopIntervalSet: new Set(['09:00', '09:30']),
  }
  const shift: AgentShiftAssignment = {
    agentIndex: 0,
    templateId: rules.shiftTemplates[0]!.id,
    startMinutes: rules.shiftTemplates[0]!.startMinutes,
    lunchStart: rules.shiftTemplates[0]!.startMinutes + 180,
    lunchEnd: rules.shiftTemplates[0]!.startMinutes + 210,
    breaks: [],
    kind: 'shift',
  }
  const assignmentsByDay = Object.fromEntries(workingDays.map((day) => [day, [shift]]))

  it('uses open working-day count for weekly required FTE (not paid-day settings)', () => {
    const result = buildSchedulingResult(
      requirementTable,
      1,
      rules,
      patternMeta,
      assignmentsByDay,
      undefined,
      { flatApplyShrinkagePct: 0 },
    )
    expect(result.totals.weeklySumRequired).toBeCloseTo(result.totals.requiredFte, 5)
    expect(workingDays.length).toBe(4)
    expect(rules.settings.workingDayCount).toBe(5)
  })

  it('computes net FTE total from open working days only', () => {
    const result = buildSchedulingResult(
      requirementTable,
      1,
      rules,
      patternMeta,
      assignmentsByDay,
      undefined,
      { flatApplyShrinkagePct: 10 },
    )
    const matrix = buildSchedulingMetricsMatrix(
      result,
      {
        slaPercent: 80,
        slaSeconds: 20,
        shrinkagePct: 10,
        volumeAhtRows: [],
      },
      rules,
      patternMeta,
    )
    expect(matrix.pureFteStaffTotals).toBeGreaterThan(0)
    expect(matrix.netFteTotal).toBeGreaterThan(0)
    expect(matrix.scheduledHeadcount).toBe(1)
  })
})
