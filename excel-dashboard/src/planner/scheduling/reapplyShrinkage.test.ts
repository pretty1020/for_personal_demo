import { describe, expect, it } from 'vitest'
import { reapplyShrinkageToPackage } from './schedulingPackageUtils'
import { buildSchedulingResult, defaultSchedulingRules } from './scheduleOptimization'
import type { GeneratedRequirementTable } from './requirementGeneration'
import type { PatternScheduleMeta } from './patternAnalysis'
import type { AgentShiftAssignment } from './scheduleGeneration'
import type { GeneratedSchedulingPackage } from './types'

describe('reapplyShrinkageToPackage', () => {
  const day = '2026-08-23'
  const interval = '09:00'
  const templates = defaultSchedulingRules().shiftTemplates
  const requirementTable: GeneratedRequirementTable = {
    days: [
      {
        day,
        intervals: { [interval]: 2, '09:30': 2 },
        dailyFte: 1,
      },
    ],
    totals: { [interval]: 2, '09:30': 2 },
    weeklyFteTarget: 1,
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
  const rules = defaultSchedulingRules()

  it('changes only Net FTE after shrinkage, never Scheduled or Net FTE', () => {
    const raw = buildSchedulingResult(
      requirementTable,
      1,
      rules,
      patternMeta,
      { [day]: [shiftAssignment] },
      undefined,
      { flatApplyShrinkagePct: 0 },
    )
    const base: GeneratedSchedulingPackage = {
      requirementTable,
      schedulingResult: raw,
      agentSchedules: [],
      weeklyAgentGrid: { weekDates: [day], dayHeaders: [day], rows: [], breakColumns: [] },
      productionHc: 1,
      patternMeta,
      metricsMatrix: {
        slaPercent: 80,
        slaSeconds: 20,
        occupancyPct: null,
        pureFteReq: 1,
        scheduledHeadcount: 1,
        pureFteStaffTotals: 1,
        netFteTotal: 1,
        shrinkagePct: null,
        scfPct: null,
        projectedServiceLevelPct: null,
        hasVolumeAht: false,
      },
      generatedAt: new Date().toISOString(),
      assignmentsByDay: { [day]: [shiftAssignment] },
    }

    const next = reapplyShrinkageToPackage(
      base,
      rules,
      { slaPercent: 80, slaSeconds: 20, shrinkagePct: 12, volumeAhtRows: [] },
      { flatApplyShrinkagePct: 12 },
    )

    for (const rawRow of raw.days[0]!.intervals) {
      const nextRow = next.schedulingResult.days[0]!.intervals.find((row) => row.interval === rawRow.interval)!
      expect(nextRow.scheduledFte).toBe(rawRow.scheduledFte)
      expect(nextRow.netFte).toBe(rawRow.netFte)
      expect(nextRow.netFteAfterShrinkage).toBeCloseTo((rawRow.netFte ?? 0) * 0.88)
      expect(nextRow.variance).toBeCloseTo((nextRow.netFteAfterShrinkage ?? 0) - nextRow.requiredFte)
    }
  })
})
