// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { DriverTimelineTable } from './DriverTimelineTable'
import type { DriverTimelineRow } from '../../planner/driverTimeline'

/**
 * The timeline is where a planner looks to see whether a forecast landed.
 *
 * Its worst state is silent: the models fitted, the accuracy is on screen, and
 * these columns are unchanged because applying is a separate step nobody took.
 * Read without a word of explanation, that looks like the tab is broken.
 */

afterEach(cleanup)

const row = (week: string, timeline: 'actual' | 'forecast', aht: number): DriverTimelineRow =>
  ({
    week,
    timeline,
    volume: 6000,
    aht,
    ahtAdjusted: aht,
    attritionHc: 2,
    absenteeism: 0.05,
    shrinkage: 0.045,
    nestingHc: 0,
    productionHc: 100,
    note: null,
  }) as DriverTimelineRow

const rows = [row('2026-08-16', 'actual', 304), row('2026-08-23', 'forecast', 304)]

describe('DriverTimelineTable', () => {
  it('names drivers whose fitted forecast is not switched on', () => {
    render(<DriverTimelineTable rows={rows} analysisOnlyDrivers={['Volume', 'AHT']} />)
    const note = screen.getByText(/fitted forecast that is not applied/i)
    expect(note.textContent).toContain('Volume')
    expect(note.textContent).toContain('AHT')
    // And says what to do about it, not merely that it happened.
    expect(note.textContent).toMatch(/switch on/i)
  })

  it('says nothing when every fitted forecast is applied', () => {
    render(<DriverTimelineTable rows={rows} serviceDrivers={['Volume']} />)
    expect(screen.queryByText(/fitted forecast that is not applied/i)).toBeNull()
  })

  it('reads naturally for a single driver', () => {
    render(<DriverTimelineTable rows={rows} analysisOnlyDrivers={['AHT']} />)
    const note = screen.getByText(/fitted forecast that is not applied/i)
    expect(note.textContent).toMatch(/AHT has a fitted forecast/)
    expect(note.textContent).toMatch(/its future weeks/)
  })

  it('reads naturally for several drivers', () => {
    render(<DriverTimelineTable rows={rows} analysisOnlyDrivers={['Volume', 'Absenteeism']} />)
    const note = screen.getByText(/fitted forecast that is not applied/i)
    expect(note.textContent).toMatch(/have a fitted forecast/)
    expect(note.textContent).toMatch(/their future weeks/)
  })

  it('names the drivers a forecast model is actually driving', () => {
    render(<DriverTimelineTable rows={rows} serviceDrivers={['Volume', 'AHT']} />)
    expect(screen.getByText(/Forecast models drive Volume, AHT/)).toBeTruthy()
  })

  it('says so plainly when no driver is fed by a model', () => {
    render(<DriverTimelineTable rows={rows} />)
    expect(screen.getByText(/No driver is currently fed by a forecast model/)).toBeTruthy()
  })

  it('warns when sample data is behind a forecast', () => {
    render(<DriverTimelineTable rows={rows} sampleDrivers={['Volume']} />)
    expect(screen.getByText(/Sample data \(not real\)/)).toBeTruthy()
  })

  it('counts actual and forecast weeks separately', () => {
    render(<DriverTimelineTable rows={rows} />)
    expect(screen.getByText('1 actual')).toBeTruthy()
    expect(screen.getByText('1 forecast')).toBeTruthy()
  })
})
