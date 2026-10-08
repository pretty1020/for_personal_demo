// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { SeriesProfilePanel } from './SeriesProfilePanel'
import type { StoredWfmModel } from '../../planner/advancedForecastPersistence'

/**
 * The series profile is where a planner decides whether to believe the
 * scoreboard, so what it refuses to claim matters as much as what it shows. A
 * seasonal figure on a series too short to have one, or a suggestion that
 * contradicts the shape, would send a plan the wrong way.
 */

afterEach(cleanup)

const seasonal = (weeks: number) =>
  Array.from({ length: weeks }, (_, i) => 1000 * (1 + 0.3 * Math.sin((2 * Math.PI * i) / 52)))

const model = (over: Partial<StoredWfmModel> = {}): StoredWfmModel =>
  ({
    id: 'theta',
    label: 'Theta',
    success: true,
    error: null,
    accuracy: { wape: 5, bias: 1 },
    parameters: {},
    weekly: [],
    ...over,
  }) as StoredWfmModel

function panel(props: Partial<Parameters<typeof SeriesProfilePanel>[0]> = {}) {
  const onUseSuggested = vi.fn()
  render(
    <SeriesProfilePanel
      driverLabel="Volume"
      values={seasonal(156)}
      models={[model()]}
      horizonWeeks={52}
      accessLevel={null}
      selectedModels={[]}
      onUseSuggested={onUseSuggested}
      {...props}
    />,
  )
  return { onUseSuggested }
}

describe('SeriesProfilePanel', () => {
  it('shows the measured shape of a long seasonal series', () => {
    panel()
    expect(screen.getByText('Series profile')).toBeTruthy()
    expect(screen.getByText(/strongly seasonal/i)).toBeTruthy()
    // Seasonality is quoted as a percentage, not withheld.
    expect(screen.queryByText('n/a')).toBeNull()
  })

  it('refuses to quote seasonality on a series too short to show one', () => {
    panel({ values: Array.from({ length: 20 }, (_, i) => 1000 + i * 5) })
    expect(screen.getByText('n/a')).toBeTruthy()
    expect(screen.getByText(/needs ~78 weeks/i)).toBeTruthy()
  })

  it('renders nothing at all for a series with almost no history', () => {
    const { container } = render(
      <SeriesProfilePanel
        driverLabel="Volume"
        values={[1, 2, 3]}
        models={[]}
        horizonWeeks={52}
        accessLevel={null}
        selectedModels={[]}
        onUseSuggested={vi.fn()}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('gives a reason with every model it suggests', () => {
    panel()
    const list = screen.getByText('Suited to this shape').closest('div')!
    const items = within(list).getAllByRole('listitem')
    expect(items.length).toBeGreaterThan(0)
    for (const item of items) {
      // A bare model name is not advice; each has to say why.
      expect(item.textContent!.length).toBeGreaterThan(40)
    }
  })

  it('offers to select the suggested models, and reports which ones', () => {
    const { onUseSuggested } = panel({ selectedModels: [] })
    screen.getByRole('button', { name: /select these models/i }).click()
    expect(onUseSuggested).toHaveBeenCalledTimes(1)
    expect(onUseSuggested.mock.calls[0]![0]).toContain('holt-winters')
  })

  it('stops offering once those models are already selected', () => {
    panel({ selectedModels: ['holt-winters', 'fourier-holidays', 'theta'] })
    expect(screen.queryByRole('button', { name: /select these models/i })).toBeNull()
  })

  it('warns that a short history cannot support a long horizon', () => {
    panel({ values: Array.from({ length: 12 }, (_, i) => 1000 - i * 10) })
    expect(screen.getByText(/only 12 weeks of history/i)).toBeTruthy()
  })

  it('does not offer the advisor when nothing fitted', () => {
    panel({ models: [model({ success: false, error: 'Needs more history' })] })
    const button = screen.getByRole('button', { name: /ask ai assistant/i }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('offers the advisor once a model has fitted', () => {
    panel()
    const button = screen.getByRole('button', { name: /ask ai assistant/i }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
  })

  it('disables everything while a forecast is running', () => {
    panel({ disabled: true })
    for (const button of screen.getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(true)
    }
  })

  it('says the advice is advisory, so nobody reads it as a change', () => {
    panel()
    expect(screen.getByText(/never changes the forecast/i)).toBeTruthy()
  })
})
