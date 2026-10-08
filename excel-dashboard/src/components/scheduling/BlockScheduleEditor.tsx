import { useEffect, useMemo, useState } from 'react'
import { StableNumberInput } from '../fields/StableNumberInput'
import type { BlockSchedule } from '../../planner/scheduling/blockSchedulePersistence'
import {
  createBlockScheduleId,
  deleteBlockSchedule,
  listBlockSchedules,
  upsertBlockSchedule,
} from '../../planner/scheduling/blockSchedulePersistence'
import { ALL_WEEK_DAYS, WEEK_DAY_SHORT } from '../../planner/scheduling/workingDaysUtils'
import type { WeekDayKey } from '../../planner/scheduling/schedulingSettingsTypes'
import { parseTimeToMinutes } from '../../planner/scheduling/schedulingTimeUtils'
import { minutesToInterval } from '../../planner/scheduling/intervalSlots'

function emptyDraft(supervisor = ''): Omit<BlockSchedule, 'updatedAt'> {
  return {
    id: createBlockScheduleId(),
    name: '',
    supervisor,
    startMinutes: 8 * 60,
    durationHours: 9,
    workingDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
    notes: '',
  }
}

export function BlockScheduleEditor({
  scenarioId,
  supervisors,
}: {
  scenarioId: string
  supervisors: string[]
}) {
  const [blocks, setBlocks] = useState(() => listBlockSchedules(scenarioId))
  const [draft, setDraft] = useState(emptyDraft(supervisors[0] ?? ''))
  const [editingId, setEditingId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    setBlocks(listBlockSchedules(scenarioId))
    setDraft(emptyDraft(supervisors[0] ?? ''))
    setEditingId(null)
  }, [scenarioId, supervisors])

  const refresh = () => setBlocks(listBlockSchedules(scenarioId))

  const startTime = useMemo(() => minutesToInterval(draft.startMinutes), [draft.startMinutes])

  const handleSave = () => {
    if (!draft.name.trim() || !draft.supervisor.trim()) {
      setMessage('Block name and supervisor are required.')
      return
    }
    if (!draft.workingDays.length) {
      setMessage('Select at least one working day for this block.')
      return
    }
    upsertBlockSchedule(scenarioId, { ...draft, updatedAt: new Date().toISOString() })
    setMessage(`Saved block schedule "${draft.name.trim()}" for ${draft.supervisor}.`)
    setDraft(emptyDraft(draft.supervisor))
    setEditingId(null)
    refresh()
  }

  const handleEdit = (block: BlockSchedule) => {
    setDraft({ ...block })
    setEditingId(block.id)
    setMessage(null)
  }

  const handleDelete = (block: BlockSchedule) => {
    if (!window.confirm(`Delete block schedule "${block.name}"? Teams will no longer use this locked start.`)) return
    deleteBlockSchedule(scenarioId, block.id)
    if (editingId === block.id) {
      setDraft(emptyDraft(supervisors[0] ?? ''))
      setEditingId(null)
    }
    refresh()
  }

  const toggleDay = (day: WeekDayKey) => {
    setDraft((prev) => ({
      ...prev,
      workingDays: prev.workingDays.includes(day)
        ? prev.workingDays.filter((item) => item !== day)
        : [...prev.workingDays, day],
    }))
  }

  return (
    <div className="sched-block-editor">
      <p className="saas-muted m-0 text-xs">
        Block schedules lock every agent under a supervisor to the same start time on selected days. Create a block,
        then generate by team on the Scheduling page. Existing assignments are not overwritten in roster history.
      </p>
      {blocks.length ? (
        <ul className="sched-block-editor__list">
          {blocks.map((block) => (
            <li key={block.id} className="sched-block-editor__item">
              <div>
                <strong>{block.name}</strong>
                <span className="saas-muted">
                  {' '}
                  · {block.supervisor} · {minutesToInterval(block.startMinutes)} · {block.durationHours}h ·{' '}
                  {block.workingDays.map((day) => WEEK_DAY_SHORT[day]).join(', ')}
                </span>
              </div>
              <div className="sched-block-editor__actions">
                <button type="button" className="cap-link" onClick={() => handleEdit(block)}>
                  Edit
                </button>
                <button type="button" className="cap-link cap-link--danger" onClick={() => handleDelete(block)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="saas-muted m-0 text-xs">No block schedules yet for this LOB.</p>
      )}

      <div className="sched-block-editor__form">
        <label className="cap-field">
          <span className="cap-field__label">Block name</span>
          <input
            className="cap-field__input"
            value={draft.name}
            onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
            placeholder="Morning team A"
          />
        </label>
        <label className="cap-field">
          <span className="cap-field__label">Supervisor / team</span>
          <input
            className="cap-field__input"
            list="sched-block-supervisors"
            value={draft.supervisor}
            onChange={(event) => setDraft((prev) => ({ ...prev, supervisor: event.target.value }))}
            placeholder="Supervisor name"
          />
          <datalist id="sched-block-supervisors">
            {supervisors.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </label>
        <label className="cap-field">
          <span className="cap-field__label">Shift start</span>
          <input
            className="cap-field__input"
            type="time"
            value={startTime}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, startMinutes: parseTimeToMinutes(event.target.value) }))
            }
          />
        </label>
        <label className="cap-field">
          <span className="cap-field__label">Duration (hours)</span>
          <StableNumberInput
            className="cap-field__input"
            min={8}
            max={12}
            step={1}
            value={draft.durationHours}
            allowEmpty={false}
            onCommit={(parsed) => {
              if (parsed == null) return
              setDraft((prev) => ({ ...prev, durationHours: parsed }))
            }}
            aria-label="Duration hours"
          />
        </label>
      </div>
      <div className="sched-block-editor__days">
        {ALL_WEEK_DAYS.map((day) => (
          <label key={day} className="sched-checkbox">
            <input type="checkbox" checked={draft.workingDays.includes(day)} onChange={() => toggleDay(day)} />
            {WEEK_DAY_SHORT[day]}
          </label>
        ))}
      </div>
      <label className="cap-field">
        <span className="cap-field__label">Notes</span>
        <input
          className="cap-field__input"
          value={draft.notes ?? ''}
          onChange={(event) => setDraft((prev) => ({ ...prev, notes: event.target.value }))}
          placeholder="Optional coordination notes"
        />
      </label>
      {message ? <p className="sched-settings-message m-0">{message}</p> : null}
      <div className="sched-block-editor__actions">
        <button type="button" className="saas-btn saas-btn--secondary" onClick={handleSave}>
          {editingId ? 'Update block schedule' : 'Save block schedule'}
        </button>
        {editingId ? (
          <button
            type="button"
            className="saas-btn saas-btn--ghost"
            onClick={() => {
              setDraft(emptyDraft(supervisors[0] ?? ''))
              setEditingId(null)
            }}
          >
            Cancel edit
          </button>
        ) : null}
      </div>
    </div>
  )
}
