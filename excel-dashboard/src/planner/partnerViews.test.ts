import { describe, expect, it } from 'vitest'
import {
  addDays,
  adherencePct,
  applyMoves,
  confirmBy,
  confirmationStatus,
  itDemand,
  itStatus,
  readyBy,
  resolveBoard,
  loadOperationsDay,
  SAMPLE_OVERSTAFF_OFFSETS,
  sampleBoard,
  shiftsFor,
  summarizeOverstaffing,
  type HiringClass,
  type PlanWeek,
} from './partnerViews'

const TODAY = '2026-10-09'

describe('partner views', () => {
  it('asks talent to confirm four weeks ahead and IT to be ready five days ahead', () => {
    expect(confirmBy('2026-11-06')).toBe('2026-10-09')
    expect(readyBy('2026-11-06')).toBe('2026-11-01')
    expect(confirmationStatus('2026-11-06', TODAY, false)).toBe('due')
    expect(confirmationStatus('2026-11-06', TODAY, true)).toBe('confirmed')
    expect(confirmationStatus('2026-10-20', TODAY, false)).toBe('late')
    expect(itStatus('2026-10-20', TODAY, { seat: false, device: true, login: true })).toBe('due')
    expect(itStatus('2026-10-12', TODAY, { seat: false, device: true, login: true })).toBe('late')
    expect(itStatus('2026-12-01', TODAY, { seat: true, device: true, login: true })).toBe('ready')
  })

  it('turns a class into seats, devices, and logins', () => {
    expect(itDemand(10, 0.86)).toEqual({ seats: 9, devices: 10, logins: 10 })
    expect(itDemand(10, 0.4)).toEqual({ seats: 4, devices: 10, logins: 10 })
  })

  it('moves hires from an overstaffed class without going past the people it has', () => {
    const classes: HiringClass[] = [
      { id: 'from', programId: 'a', client: 'Retail', site: 'Manila', program: 'Chat', classDate: '2026-11-13', hires: 10, onsiteShare: 0.4, source: 'sample' },
      { id: 'to', programId: 'b', client: 'Retail', site: 'Manila', program: 'Voice Care', classDate: '2026-10-30', hires: 12, onsiteShare: 0.86, source: 'sample' },
    ]
    const moved = applyMoves(classes, [{ id: 'm1', fromId: 'from', toId: 'to', hires: 4 }])
    expect(moved.find((item) => item.id === 'from')?.hires).toBe(6)
    expect(moved.find((item) => item.id === 'to')?.hires).toBe(16)
    const emptied = applyMoves(classes, [{ id: 'm2', fromId: 'from', toId: 'to', hires: 40 }])
    expect(emptied.find((item) => item.id === 'from')).toBeUndefined()
    expect(emptied.find((item) => item.id === 'to')?.hires).toBe(22)
  })

  it('reads new hires from the capacity plan and otherwise uses a six-month sample', () => {
    const rows: PlanWeek[] = [
      week('Retail', 'Manila', 'Voice Care', addDays(TODAY, 14), 8, -6, 140, 146, 120, 140),
      week('Retail', 'Manila', 'Chat', addDays(TODAY, 21), 0, 9, 57, 48, 20, 50),
    ]
    const plan = resolveBoard(rows, TODAY)
    expect(plan.usedSample).toBe(false)
    expect(plan.classes.map((item) => item.hires)).toContain(8)
    expect(plan.programs).toHaveLength(2)

    const gapOnly = resolveBoard([{ ...rows[1]!, newHires: 0 }, { ...rows[0]!, newHires: 0 }], TODAY)
    expect(gapOnly.usedSample).toBe(false)
    expect(gapOnly.classes.length).toBeGreaterThan(0)

    const sample = resolveBoard([], TODAY)
    expect(sample.usedSample).toBe(true)
    expect(sampleBoard(TODAY).classes.every((item) => item.classDate > TODAY && item.classDate <= addDays(TODAY, 26 * 7))).toBe(true)
  })

  it('loads a database-shaped operations day for the schedule, playbook, and scorecard', () => {
    const program = sampleBoard(TODAY).programs.find((item) => item.program === 'Voice Care')!
    const day = loadOperationsDay(program, TODAY, 'two')
    expect(day.source).toBe('sample')
    expect(day.scheduleId).toBe('SCH-20261009-voice-care')
    expect(day.schedules.map((row) => row.plannedHc).reduce((sum, value) => sum + value, 0)).toBe(Math.round(program.productionFte))
    expect(day.schedules[0]).toMatchObject({ name: 'Shift A', start: '06:00', end: '15:00', supervisor: 'A. Cruz' })
    expect(day.playbook.map((step) => step.at)).toEqual(['06:15', '09:00', '12:00', '15:00', '18:00'])
    expect(day.scorecard.map((row) => row.metric)).toContain('Service level')
    expect(day.exceptions.filter((row) => row.status === 'open')).toHaveLength(2)
    expect(loadOperationsDay(program, TODAY, '24x7').schedules).toHaveLength(3)
  })

  it('counts overstaffed weeks and the months those weeks fall in', () => {
    const chat = summarizeOverstaffing(sampleBoard(TODAY).staffing).find((item) => item.program === 'Chat')!
    expect(chat.overWeeks).toHaveLength(SAMPLE_OVERSTAFF_OFFSETS['Retail|Manila|Chat']!.length)
    expect(chat.totalWeeks).toBe(26)
    expect(chat.months.length).toBe(new Set(chat.overWeeks.map((week) => week.week.slice(0, 7))).size)
    expect(chat.months.every((month) => month.weeks.length > 0)).toBe(true)

    const summary = summarizeOverstaffing([
      point('Chat', '2026-10-12', 6),
      point('Chat', '2026-10-19', 4),
      point('Chat', '2026-10-26', -2),
      point('Chat', '2026-11-02', 3),
    ])
    expect(summary[0]?.overWeeks.map((week) => week.week)).toEqual(['2026-10-12', '2026-10-19', '2026-11-02'])
    expect(summary[0]?.months.map((month) => month.label)).toEqual(['October 2026', 'November 2026'])
    expect(summary[0]?.months[0]?.weeks).toHaveLength(2)
  })

  it('builds the operations shifts and lowers adherence when exceptions stay open', () => {
    expect(shiftsFor(100, 'single')).toEqual([{ name: 'Shift A', planned: 100 }])
    expect(shiftsFor(100, 'two').map((item) => item.planned).reduce((sum, value) => sum + value, 0)).toBe(100)
    expect(shiftsFor(100, '24x7').map((item) => item.planned).reduce((sum, value) => sum + value, 0)).toBe(100)
    expect(adherencePct(136, 142, 0)).toBeGreaterThan(adherencePct(136, 142, 2))
  })
})

function point(program: string, week: string, overUnderFte: number) {
  return { programId: program, client: 'Retail', site: 'Manila', program, week, overUnderFte }
}

function week(
  client: string,
  site: string,
  program: string,
  date: string,
  newHires: number,
  overUnderFte: number,
  productionFte: number,
  requiredFte: number,
  onsiteHc: number,
  productionHc: number,
): PlanWeek {
  return {
    programId: `${client}|${site}|${program}`,
    client,
    site,
    program,
    week: date,
    newHires,
    overUnderFte,
    productionFte,
    requiredFte,
    onsiteHc,
    productionHc,
  }
}
