import { useMemo, useState } from 'react'
import type { StoredWfmModel } from '../../planner/advancedForecastPersistence'
import {
  applyAdjustments,
  newEventId,
  type ForecastEvent,
  type ForecastOverrides,
} from '../../planner/forecastAdjustments'
import { fmtNum, fmtPct } from '../../planner/format'

/**
 * Where a forecaster applies what the model cannot know.
 *
 * Events carry a reason and a percentage — "Black Friday campaign, +40%, weeks
 * of 24 Nov to 1 Dec" — and survive a re-run, because the reason is still true
 * after refitting. Overrides are absolute: this week is 8,000, full stop.
 *
 * Both sit on top of the model rather than replacing it, so the model's own
 * number stays visible beside the adjusted one and the difference can be
 * explained to whoever signs off the plan.
 */

type Props = {
  model: StoredWfmModel | null
  events: ForecastEvent[]
  overrides: ForecastOverrides
  unit: 'number' | 'percent' | 'seconds'
  disabled?: boolean
  onEventsChange: (events: ForecastEvent[]) => void
  onOverridesChange: (overrides: ForecastOverrides) => void
}

function formatValue(value: number, unit: Props['unit']): string {
  if (unit === 'percent') return fmtPct(value)
  if (unit === 'seconds') return `${fmtNum(value, 1)}`
  return fmtNum(value, 0)
}

export function ForecastAdjustments({
  model,
  events,
  overrides,
  unit,
  disabled,
  onEventsChange,
  onOverridesChange,
}: Props) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Partial<ForecastEvent>>({})

  const weeks = useMemo(() => (model?.weekly ?? []).map((point) => point.week), [model])
  const adjusted = useMemo(
    () => applyAdjustments(model?.weekly ?? [], events, overrides, unit),
    [events, model, overrides, unit],
  )

  const changedCount = adjusted.filter(
    (point) => point.overridden || point.appliedEvents.length,
  ).length

  if (!model) return null

  const addEvent = () => {
    if (!draft.name?.trim() || !draft.fromWeek || !draft.toWeek) return
    const uplift = Number(draft.upliftPct)
    if (!Number.isFinite(uplift)) return
    const [from, to] =
      draft.fromWeek <= draft.toWeek ? [draft.fromWeek, draft.toWeek] : [draft.toWeek, draft.fromWeek]
    onEventsChange([
      ...events,
      { id: newEventId(), name: draft.name.trim(), fromWeek: from, toWeek: to, upliftPct: uplift },
    ])
    setDraft({})
  }

  const setOverride = (week: string, raw: string) => {
    const next = { ...overrides }
    const value = Number(raw.replace(/[, ]/g, ''))
    if (!raw.trim() || !Number.isFinite(value)) delete next[week]
    else next[week] = unit === 'percent' && value > 1 ? value / 100 : value
    onOverridesChange(next)
  }

  return (
    <section className="cap-forecast-adjust">
      <header className="cap-forecast-adjust__head">
        <div>
          <h4 className="cap-forecast-advanced__step-title">Your adjustments</h4>
          <p className="saas-muted m-0 text-xs">
            What the model cannot know — campaigns, launches, contract ramps. Applied on top of the
            forecast, and kept when you re-run.
          </p>
        </div>
        <button
          type="button"
          className="saas-btn saas-btn--ghost"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? 'Hide' : changedCount ? `${changedCount} weeks adjusted` : 'Add an adjustment'}
        </button>
      </header>

      {open ? (
        <>
          <div className="cap-forecast-adjust__event-form">
            <label className="saas-field">
              <span className="saas-field__label">Event</span>
              <input
                className="cap-field__input"
                placeholder="Black Friday campaign"
                value={draft.name ?? ''}
                disabled={disabled}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              />
            </label>
            <label className="saas-field">
              <span className="saas-field__label">From week</span>
              <select
                className="cap-field__input"
                value={draft.fromWeek ?? ''}
                disabled={disabled}
                onChange={(e) => setDraft((d) => ({ ...d, fromWeek: e.target.value }))}
              >
                <option value="">Select…</option>
                {weeks.map((week) => (
                  <option key={week} value={week}>
                    {week}
                  </option>
                ))}
              </select>
            </label>
            <label className="saas-field">
              <span className="saas-field__label">To week</span>
              <select
                className="cap-field__input"
                value={draft.toWeek ?? ''}
                disabled={disabled}
                onChange={(e) => setDraft((d) => ({ ...d, toWeek: e.target.value }))}
              >
                <option value="">Select…</option>
                {weeks.map((week) => (
                  <option key={week} value={week}>
                    {week}
                  </option>
                ))}
              </select>
            </label>
            <label className="saas-field cap-forecast-adjust__uplift">
              <span className="saas-field__label">Change</span>
              <input
                className="cap-field__input"
                type="number"
                placeholder="+40"
                value={draft.upliftPct ?? ''}
                disabled={disabled}
                onChange={(e) => setDraft((d) => ({ ...d, upliftPct: Number(e.target.value) }))}
              />
              <span className="saas-field__hint">% up or down</span>
            </label>
            <button
              type="button"
              className="saas-btn saas-btn--primary"
              disabled={disabled || !draft.name?.trim() || !draft.fromWeek || !draft.toWeek}
              onClick={addEvent}
            >
              Add event
            </button>
          </div>

          {events.length ? (
            <ul className="cap-forecast-adjust__events">
              {events.map((event) => (
                <li key={event.id}>
                  <strong>{event.name}</strong>
                  <span>
                    {event.fromWeek} → {event.toWeek} · {event.upliftPct > 0 ? '+' : ''}
                    {event.upliftPct}%
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${event.name}`}
                    disabled={disabled}
                    onClick={() => onEventsChange(events.filter((e) => e.id !== event.id))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="cap-forecast-advanced__scroll">
            <table className="cap-forecast-models-table">
              <thead>
                <tr>
                  <th>Week</th>
                  <th>Model</th>
                  <th>Events</th>
                  <th>Your number</th>
                  <th>Used</th>
                </tr>
              </thead>
              <tbody>
                {adjusted.map((point) => (
                  <tr
                    key={point.week}
                    className={point.overridden || point.appliedEvents.length ? 'cap-forecast-adjust__row--changed' : undefined}
                  >
                    <td>{point.week}</td>
                    <td className="cap-forecast-models-table__num">
                      {formatValue(point.modelValue, unit)}
                    </td>
                    <td>{point.appliedEvents.join(', ') || '—'}</td>
                    <td>
                      <input
                        className="cap-field__input cap-forecast-adjust__input"
                        placeholder="—"
                        disabled={disabled}
                        defaultValue={
                          overrides[point.week] != null
                            ? unit === 'percent'
                              ? String(overrides[point.week]! * 100)
                              : String(overrides[point.week])
                            : ''
                        }
                        onBlur={(e) => setOverride(point.week, e.target.value)}
                      />
                    </td>
                    <td className="cap-forecast-models-table__num">
                      <strong>{formatValue(point.value, unit)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {changedCount ? (
            <button
              type="button"
              className="saas-btn saas-btn--ghost"
              disabled={disabled}
              onClick={() => {
                onEventsChange([])
                onOverridesChange({})
              }}
            >
              Clear all adjustments
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
