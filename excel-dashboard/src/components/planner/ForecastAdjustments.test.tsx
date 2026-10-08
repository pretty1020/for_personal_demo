// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ForecastAdjustments } from './ForecastAdjustments'
import type { StoredWfmModel } from '../../planner/advancedForecastPersistence'

/**
 * Where a planner overrides the model.
 *
 * These numbers go into the plan, so the arithmetic on screen has to be the
 * arithmetic that lands: an event that reads +40% must move the week by 40%, and
 * a rate typed as a percentage must not be stored as a multiple of one hundred.
 */

afterEach(cleanup)

const WEEKS = ['2026-05-03', '2026-05-10', '2026-05-17', '2026-05-24']

const model = (value = 1000): StoredWfmModel =>
  ({
    id: 'theta',
    label: 'Theta',
    success: true,
    error: null,
    accuracy: {},
    parameters: {},
    weekly: WEEKS.map((week) => ({ week, value, days: 7 })),
  }) as StoredWfmModel

function mount(props: Partial<Parameters<typeof ForecastAdjustments>[0]> = {}) {
  const onEventsChange = vi.fn()
  const onOverridesChange = vi.fn()
  const view = render(
    <ForecastAdjustments
      model={model()}
      events={[]}
      overrides={{}}
      unit="number"
      onEventsChange={onEventsChange}
      onOverridesChange={onOverridesChange}
      {...props}
    />,
  )
  return { onEventsChange, onOverridesChange, view }
}

/** The panel is collapsed until asked for. */
function open() {
  const toggle = screen.getByRole('button', { name: /add an adjustment|weeks adjusted|hide/i })
  fireEvent.click(toggle)
}

describe('ForecastAdjustments', () => {
  it('renders nothing when no model has been chosen', () => {
    const { container } = render(
      <ForecastAdjustments
        model={null}
        events={[]}
        overrides={{}}
        unit="number"
        onEventsChange={vi.fn()}
        onOverridesChange={vi.fn()}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('invites an adjustment when there are none', () => {
    mount()
    expect(screen.getByRole('button', { name: /add an adjustment/i })).toBeTruthy()
  })

  it('reports how many weeks carry an adjustment', () => {
    mount({ overrides: { [WEEKS[0]!]: 1200, [WEEKS[2]!]: 900 } })
    expect(screen.getByRole('button', { name: /2 weeks adjusted/i })).toBeTruthy()
  })

  it('records an event with its reason and its span', () => {
    const { onEventsChange } = mount()
    open()

    fireEvent.change(screen.getByPlaceholderText(/black friday/i), {
      target: { value: 'Product launch' },
    })
    const [from, to] = screen.getAllByRole('combobox')
    fireEvent.change(from!, { target: { value: WEEKS[1] } })
    fireEvent.change(to!, { target: { value: WEEKS[2] } })
    fireEvent.change(screen.getByPlaceholderText('+40'), { target: { value: '40' } })
    fireEvent.click(screen.getByRole('button', { name: /^add event$/i }))

    expect(onEventsChange).toHaveBeenCalledTimes(1)
    const [added] = onEventsChange.mock.calls[0]![0]
    expect(added.name).toBe('Product launch')
    expect(added.fromWeek).toBe(WEEKS[1])
    expect(added.toWeek).toBe(WEEKS[2])
    expect(added.upliftPct).toBe(40)
  })

  it('puts a back-to-front span the right way round', () => {
    const { onEventsChange } = mount()
    open()

    fireEvent.change(screen.getByPlaceholderText(/black friday/i), { target: { value: 'Ramp' } })
    const [from, to] = screen.getAllByRole('combobox')
    fireEvent.change(from!, { target: { value: WEEKS[3] } })
    fireEvent.change(to!, { target: { value: WEEKS[1] } })
    fireEvent.change(screen.getByPlaceholderText('+40'), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: /^add event$/i }))

    const [added] = onEventsChange.mock.calls[0]![0]
    expect(added.fromWeek).toBe(WEEKS[1])
    expect(added.toWeek).toBe(WEEKS[3])
  })

  it('refuses an event with no reason given', () => {
    mount()
    open()
    const add = screen.getByRole('button', { name: /^add event$/i }) as HTMLButtonElement
    expect(add.disabled).toBe(true)
  })

  it('shows the model number beside the number actually used', () => {
    mount({
      events: [
        { id: 'e1', name: 'Campaign', fromWeek: WEEKS[0]!, toWeek: WEEKS[0]!, upliftPct: 40 },
      ],
    })
    open()
    // 1000 lifted by 40% is 1,400, and the model's own 1,000 stays visible.
    expect(screen.getAllByText('1,400').length).toBeGreaterThan(0)
    expect(screen.getAllByText('1,000').length).toBeGreaterThan(0)
  })

  it('stores a typed override as given for a count', () => {
    const { onOverridesChange } = mount()
    open()
    const inputs = screen.getAllByPlaceholderText('—')
    fireEvent.blur(inputs[0]!, { target: { value: '8000' } })
    expect(onOverridesChange).toHaveBeenCalledWith({ [WEEKS[0]!]: 8000 })
  })

  it('reads an override typed with separators', () => {
    const { onOverridesChange } = mount()
    open()
    fireEvent.blur(screen.getAllByPlaceholderText('—')[0]!, { target: { value: '8,500' } })
    expect(onOverridesChange).toHaveBeenCalledWith({ [WEEKS[0]!]: 8500 })
  })

  it('stores a rate typed as a percentage as a fraction', () => {
    const { onOverridesChange } = mount({ unit: 'percent', model: model(0.3) })
    open()
    // Typing 55 for a rate means 55%, not 5,500%.
    fireEvent.blur(screen.getAllByPlaceholderText('—')[0]!, { target: { value: '55' } })
    expect(onOverridesChange).toHaveBeenCalledWith({ [WEEKS[0]!]: 0.55 })
  })

  it('clears an override when the field is emptied', () => {
    const { onOverridesChange } = mount({ overrides: { [WEEKS[0]!]: 8000 } })
    open()
    fireEvent.blur(screen.getAllByPlaceholderText('—')[0]!, { target: { value: '' } })
    expect(onOverridesChange).toHaveBeenCalledWith({})
  })

  it('removes the event a planner asked to remove', () => {
    const events = [
      { id: 'e1', name: 'Campaign', fromWeek: WEEKS[0]!, toWeek: WEEKS[0]!, upliftPct: 40 },
      { id: 'e2', name: 'Outage', fromWeek: WEEKS[2]!, toWeek: WEEKS[2]!, upliftPct: -20 },
    ]
    const { onEventsChange } = mount({ events })
    open()
    fireEvent.click(screen.getByRole('button', { name: /remove outage/i }))
    expect(onEventsChange).toHaveBeenCalledWith([events[0]])
  })

  it('clears events and overrides together', () => {
    const { onEventsChange, onOverridesChange } = mount({
      events: [{ id: 'e1', name: 'Campaign', fromWeek: WEEKS[0]!, toWeek: WEEKS[0]!, upliftPct: 40 }],
      overrides: { [WEEKS[1]!]: 1200 },
    })
    open()
    fireEvent.click(screen.getByRole('button', { name: /clear all adjustments/i }))
    expect(onEventsChange).toHaveBeenCalledWith([])
    expect(onOverridesChange).toHaveBeenCalledWith({})
  })

  it('locks every control while a forecast is running', () => {
    mount({ disabled: true })
    open()
    for (const input of screen.getAllByRole('textbox')) {
      expect((input as HTMLInputElement).disabled).toBe(true)
    }
  })
})
