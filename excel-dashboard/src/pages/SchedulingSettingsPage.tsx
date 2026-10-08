import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ScenarioPicker } from '../components/planner/ScenarioPicker'
import { UnsavedChangesDialog } from '../components/UnsavedChangesDialog'
import { StableNumberInput } from '../components/fields/StableNumberInput'
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard'
import { usePlanner } from '../context/PlannerContext'
import { BlockScheduleEditor } from '../components/scheduling/BlockScheduleEditor'
import { uniqueSupervisors } from '../planner/rosterHistory'
import { eligibleRosterAgentsForScheduling } from '../planner/scheduling/scheduleRosterAgents'
import { formatScenarioLabel } from '../planner/scenarioDisplay'
import {
  createDefaultSchedulingSettings,
  createSchedulingRuleTemplate,
  duplicateTemplate,
  settingsToSchedulingRules,
} from '../planner/scheduling/defaultSchedulingSettings'
import {
  applyTemplateToWorkspace,
  createDefaultSchedulingWorkspace,
  loadSchedulingWorkspace,
  saveSchedulingWorkspace,
} from '../planner/scheduling/persistence'
import type { RestDayLayout, SchedulingRuleTemplate, SchedulingSettings, WeekDayKey, WorkingDayCount } from '../planner/scheduling/schedulingSettingsTypes'
import { BREAK_LUNCH_PATTERN_OPTIONS } from '../planner/scheduling/schedulingSettingsTypes'
import { formatSlackRangeLabel } from '../planner/scheduling/breakSlackWindows'
import type { WeekStart } from '../planner/types'
import {
  ALL_WEEK_DAYS,
  formatRestDaysRange,
  formatWorkingDaysRange,
  migrateSchedulingSettings,
  resolveRestDays,
  resolveWorkingDays,
  restDayCountFromSettings,
  syncWorkingDaysFromSchedule,
  WEEK_DAY_LABELS,
  WEEK_DAY_SHORT,
} from '../planner/scheduling/workingDaysUtils'
import {
  deleteSchedulingTemplate,
  exportTemplatesForScenario,
  getDefaultTemplateForScenario,
  importTemplatesFromJson,
  listTemplatesForScenario,
  setDefaultTemplate,
  upsertSchedulingTemplate,
} from '../planner/scheduling/schedulingTemplatePersistence'

const DAY_LABELS = WEEK_DAY_SHORT

function selectMinutes(options: number[], current: number): number[] {
  if (options.includes(current)) return options
  return [...options, current].sort((a, b) => a - b)
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="sched-settings-section">
      <legend>{title}</legend>
      {children}
    </fieldset>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="cap-field sched-settings-field">
      <span className="cap-field__label">{label}</span>
      {children}
      {hint ? <span className="sched-settings-field__hint">{hint}</span> : null}
    </label>
  )
}

function snapshotSettings(settings: SchedulingSettings, name: string) {
  return JSON.stringify({ settings, name })
}

export function SchedulingSettingsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { scenarios, updateScenarioPlan, getScenarioRoster } = usePlanner()
  const importRef = useRef<HTMLInputElement>(null)

  const [scenarioId, setScenarioId] = useState(searchParams.get('scenarioId') ?? scenarios[0]?.id ?? '')
  const [templates, setTemplates] = useState<SchedulingRuleTemplate[]>([])
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null)
  const [settings, setSettings] = useState<SchedulingSettings>(() => migrateSchedulingSettings(createDefaultSchedulingSettings()))
  const [templateName, setTemplateName] = useState('Default template')
  const [saveToTemplate, setSaveToTemplate] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const [savedSnapshot, setSavedSnapshot] = useState(() =>
    snapshotSettings(migrateSchedulingSettings(createDefaultSchedulingSettings()), 'Default template'),
  )

  const scenario = useMemo(() => scenarios.find((item) => item.id === scenarioId) ?? null, [scenarioId, scenarios])
  const supervisors = useMemo(
    () => (scenario ? uniqueSupervisors(eligibleRosterAgentsForScheduling(getScenarioRoster(scenario.id))) : []),
    [getScenarioRoster, scenario],
  )
  const activeTemplate = templates.find((item) => item.id === activeTemplateId) ?? null

  const refreshTemplates = useCallback(() => {
    if (!scenario) {
      setTemplates([])
      return
    }
    const list = listTemplatesForScenario(scenario)
    setTemplates(list)
    const preferred = getDefaultTemplateForScenario(scenario)
    if (preferred) {
      const nextSettings = migrateSchedulingSettings(preferred.settings)
      setActiveTemplateId(preferred.id)
      setSettings(nextSettings)
      setTemplateName(preferred.name)
      setSavedSnapshot(snapshotSettings(nextSettings, preferred.name))
    }
  }, [scenario])

  useEffect(() => {
    refreshTemplates()
  }, [refreshTemplates])

  const settingsDirty = snapshotSettings(settings, templateName) !== savedSnapshot
  const { isBlocked: navigationBlocked, proceed: proceedNavigation, cancel: cancelNavigation } =
    useUnsavedChangesGuard({ when: settingsDirty })

  const updateSettings = <K extends keyof SchedulingSettings>(key: K, value: SchedulingSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  const resolvedWorkingDays = useMemo(() => resolveWorkingDays(settings), [settings])
  const resolvedRestDays = useMemo(() => resolveRestDays(settings), [settings])
  const restDayCount = useMemo(() => restDayCountFromSettings(settings), [settings])

  const workingDaysPreview = useMemo(
    () => formatWorkingDaysRange(settings.workingDayCount === 'custom' ? settings.workingDays : resolvedWorkingDays),
    [resolvedWorkingDays, settings.workingDayCount, settings.workingDays],
  )
  const restDaysPreview = useMemo(
    () => formatRestDaysRange(settings.workingDayCount === 'custom' ? resolvedRestDays : resolvedRestDays),
    [resolvedRestDays, settings.workingDayCount],
  )

  const updateWorkingDayCount = (count: WorkingDayCount) => {
    setSettings((prev) => {
      if (count === 'custom') {
        return { ...prev, workingDayCount: count }
      }
      return syncWorkingDaysFromSchedule({
        ...prev,
        workingDayCount: count,
      })
    })
  }

  const updateWorkingWeekStartDay = (startDay: WeekDayKey) => {
    setSettings((prev) => {
      const next = syncWorkingDaysFromSchedule({
        ...prev,
        workingWeekStartDay: startDay,
      })
      // Sun/Mon first working day also drives calendar week start for requirements columns.
      if (startDay === 'sun') return { ...next, weekStartDay: 'sunday' as WeekStart }
      if (startDay === 'mon') return { ...next, weekStartDay: 'monday' as WeekStart }
      return next
    })
  }

  const updateCalendarWeekStart = (weekStartDay: WeekStart) => {
    setSettings((prev) =>
      syncWorkingDaysFromSchedule({
        ...prev,
        weekStartDay,
        workingWeekStartDay: weekStartDay === 'sunday' ? 'sun' : 'mon',
      }),
    )
  }

  const toggleCustomWorkingDay = (day: WeekDayKey) => {
    setSettings((prev) => {
      const has = prev.workingDays.includes(day)
      const workingDays = has ? prev.workingDays.filter((item) => item !== day) : [...prev.workingDays, day]
      return { ...prev, workingDayCount: 'custom' as const, workingDays }
    })
  }

  const handleSave = (confirmForGeneration = true, navigateAfter = confirmForGeneration) => {
    if (!scenario) return
    let template = activeTemplate
    if (!template || !saveToTemplate) {
      template = createSchedulingRuleTemplate(scenario, templateName, settings)
    } else {
      template = {
        ...template,
        name: templateName,
        settings,
        updatedAt: new Date().toISOString(),
      }
    }
    const syncedSettings = migrateSchedulingSettings(settings)
    const saved = upsertSchedulingTemplate({
      ...template,
      settings: syncedSettings,
    })
    if (template.isDefault || templates.length === 0) setDefaultTemplate(saved)

    const workspace = loadSchedulingWorkspace() ?? createDefaultSchedulingWorkspace(scenario.id, undefined, scenario)
    if (syncedSettings.weekStartDay !== scenario.plan.weekStart) {
      updateScenarioPlan(scenario.id, { ...scenario.plan, weekStart: syncedSettings.weekStartDay })
    }
    saveSchedulingWorkspace(
      applyTemplateToWorkspace(
        { ...workspace, scenarioId: scenario.id },
        saved.id,
        settingsToSchedulingRules(syncedSettings),
        confirmForGeneration,
      ),
    )
    setMessage(confirmForGeneration ? 'Settings saved and confirmed for generation.' : 'Settings saved to template.')
    setSavedSnapshot(snapshotSettings(syncedSettings, templateName))
    refreshTemplates()
    if (navigateAfter) navigate('/scheduling')
  }

  const handleDuplicate = () => {
    if (!activeTemplate) return
    const copy = duplicateTemplate(activeTemplate, `${activeTemplate.name} (copy)`)
    const saved = upsertSchedulingTemplate(copy)
    setActiveTemplateId(saved.id)
    setTemplateName(saved.name)
    refreshTemplates()
  }

  const handleDelete = () => {
    if (!activeTemplate) return
    deleteSchedulingTemplate(activeTemplate.id)
    refreshTemplates()
    setMessage('Template deleted.')
  }

  const handleExport = () => {
    if (!scenario) return
    const blob = new Blob([exportTemplatesForScenario(scenario)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `scheduling-templates-${scenario.plan.client}-${scenario.plan.location}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = async (file: File) => {
    if (!scenario) return
    const text = await file.text()
    importTemplatesFromJson(text, scenario)
    refreshTemplates()
    setMessage('Templates imported.')
  }

  return (
    <div className="sched-page sched-settings-page">
      <section className="exec-dashboard__hero sched-page__hero">
        <h1 className="exec-dashboard__title">Scheduling settings</h1>
      </section>

      <section className="sched-panel saas-card">
        <div className="sched-settings-toolbar">
          <ScenarioPicker value={scenarioId} onChange={setScenarioId} label="Client / LOB" />
          <div className="sched-settings-template-bar">
            <Field label="Template">
              <select
                className="cap-field__input"
                value={activeTemplateId ?? ''}
                onChange={(event) => {
                  const template = templates.find((item) => item.id === event.target.value)
                  if (!template) return
                  setActiveTemplateId(template.id)
                  setSettings(migrateSchedulingSettings(template.settings))
                  setTemplateName(template.name)
                  setSavedSnapshot(snapshotSettings(migrateSchedulingSettings(template.settings), template.name))
                }}
              >
                {templates.length === 0 ? <option value="">No templates — create on save</option> : null}
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                    {template.isDefault ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Template name">
              <input className="cap-field__input" value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
            </Field>
          </div>
        </div>

        {scenario ? (
          <p className="saas-muted sched-context m-0">
            Scope: <strong>{formatScenarioLabel(scenario)}</strong>
          </p>
        ) : null}

        <div className="sched-settings-actions">
          <button
            type="button"
            className="saas-btn saas-btn--ghost"
            onClick={() => {
              const defaults = migrateSchedulingSettings(createDefaultSchedulingSettings(scenario))
              setSettings(defaults)
              setMessage('Restored default scheduling settings.')
            }}
          >
            Default
          </button>
          <button type="button" className="saas-btn saas-btn--ghost" onClick={handleDuplicate} disabled={!activeTemplate}>
            Duplicate
          </button>
          <button type="button" className="saas-btn saas-btn--ghost" onClick={handleDelete} disabled={!activeTemplate}>
            Delete
          </button>
          <button type="button" className="saas-btn saas-btn--ghost" onClick={handleExport} disabled={!scenario}>
            Export
          </button>
          <button type="button" className="saas-btn saas-btn--ghost" onClick={() => importRef.current?.click()}>
            Import
          </button>
          <input ref={importRef} type="file" accept=".json" className="sched-upload__input" onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleImport(file)
            e.target.value = ''
          }} />
          {activeTemplate ? (
            <button type="button" className="saas-btn saas-btn--ghost" onClick={() => setDefaultTemplate(activeTemplate)}>
              Set as default
            </button>
          ) : null}
        </div>
      </section>

      <div className="sched-settings-grid">
        <Section title="General">
          <div className="sched-settings-row">
            <Field label="Calendar week starts on">
              <select
                className="cap-field__input"
                value={settings.weekStartDay}
                onChange={(e) => updateCalendarWeekStart(e.target.value as WeekStart)}
              >
                <option value="sunday">Sunday</option>
                <option value="monday">Monday</option>
              </select>
            </Field>
            <Field label="Shift length">
              <select className="cap-field__input" value={settings.shiftLengthHours} onChange={(e) => updateSettings('shiftLengthHours', Number(e.target.value) as SchedulingSettings['shiftLengthHours'])}>
                {[8, 9, 10, 12].map((hours) => (
                  <option key={hours} value={hours}>{hours} hours</option>
                ))}
              </select>
            </Field>
            <Field label="Interval">
              <select className="cap-field__input" value={settings.scheduleIntervalMinutes} onChange={(e) => updateSettings('scheduleIntervalMinutes', Number(e.target.value) as 15 | 30)}>
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
              </select>
            </Field>
          </div>
          <div className="sched-settings-row">
            <Field label="Working days per agent">
              <select
                className="cap-field__input"
                value={String(settings.workingDayCount)}
                onChange={(e) => {
                  const value = e.target.value
                  updateWorkingDayCount(value === 'custom' ? 'custom' : (Number(value) as 5 | 6 | 7))
                }}
              >
                <option value="5">5 working days</option>
                <option value="6">6 working days</option>
                <option value="7">7 working days (no rest)</option>
                <option value="custom">Custom selection</option>
              </select>
            </Field>
            {settings.workingDayCount !== 'custom' ? (
              <>
                <Field label="First working day">
                  <select
                    className="cap-field__input"
                    value={settings.workingWeekStartDay}
                    onChange={(e) => updateWorkingWeekStartDay(e.target.value as WeekDayKey)}
                  >
                    {ALL_WEEK_DAYS.map((day) => (
                      <option key={day} value={day}>
                        {WEEK_DAY_LABELS[day]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Rest day layout">
                  <select
                    className="cap-field__input"
                    value={settings.restDayLayout}
                    onChange={(e) =>
                      setSettings((prev) =>
                        syncWorkingDaysFromSchedule({
                          ...prev,
                          restDayLayout: e.target.value as RestDayLayout,
                        }),
                      )
                    }
                  >
                    <option value="consecutive">Consecutive rest days</option>
                    <option value="scattered">Scattered rest days</option>
                  </select>
                </Field>
              </>
            ) : null}
          </div>
          <p className="sched-settings-working-preview m-0">
            <strong>Working days:</strong> {workingDaysPreview}
            <span className="saas-muted"> · Rest ({restDayCount}): {restDaysPreview}</span>
          </p>
          {settings.workingDayCount === 'custom' ? (
            <div className="sched-settings-day-pills">
              {ALL_WEEK_DAYS.map((day) => (
                <button
                  key={day}
                  type="button"
                  className={`sched-settings-day-pill${settings.workingDays.includes(day) ? ' sched-settings-day-pill--active' : ''}`}
                  onClick={() => toggleCustomWorkingDay(day)}
                >
                  {DAY_LABELS[day]}
                </button>
              ))}
            </div>
          ) : (
            <div className="sched-settings-day-pills sched-settings-day-pills--readonly">
              {resolvedWorkingDays.map((day) => (
                <span key={day} className="sched-settings-day-pill sched-settings-day-pill--active">
                  {DAY_LABELS[day]}
                </span>
              ))}
            </div>
          )}
        </Section>

        <Section title="Break & lunch">
          <div className="sched-settings-row">
            <Field label="Unpaid lunch">
              <select className="cap-field__input" value={settings.unpaidLunchMinutes} onChange={(e) => updateSettings('unpaidLunchMinutes', Number(e.target.value) || 0)}>
                {[0, 30, 45, 60].map((minutes) => (
                  <option key={minutes} value={minutes}>{minutes} min</option>
                ))}
              </select>
            </Field>
            <Field label="Paid breaks">
              <select className="cap-field__input" value={settings.breakCount} onChange={(e) => updateSettings('breakCount', Number(e.target.value) || 0)}>
                {[0, 1, 2].map((count) => (
                  <option key={count} value={count}>{count}</option>
                ))}
              </select>
            </Field>
            <Field label="Break length">
              <select className="cap-field__input" value={settings.breakDurationMinutes} onChange={(e) => updateSettings('breakDurationMinutes', Number(e.target.value) || 0)}>
                {[10, 15, 20].map((minutes) => (
                  <option key={minutes} value={minutes}>{minutes} min</option>
                ))}
              </select>
            </Field>
            <Field label="Order">
              <select
                className="cap-field__input"
                value={settings.constraints.followBreakLunchPattern ? settings.constraints.breakLunchPattern : 'off'}
                onChange={(e) => {
                  const value = e.target.value
                  setSettings((prev) => ({
                    ...prev,
                    constraints: {
                      ...prev.constraints,
                      followBreakLunchPattern: value !== 'off',
                      breakLunchPattern:
                        value === 'off'
                          ? prev.constraints.breakLunchPattern
                          : (value as typeof prev.constraints.breakLunchPattern),
                    },
                  }))
                }}
              >
                <option value="off">No fixed order</option>
                {BREAK_LUNCH_PATTERN_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="sched-settings-row">
            <Field label="First break after shift" hint="Preferred time from shift start">
              <select
                className="cap-field__input"
                value={settings.minMinutesBeforeFirstBreak}
                onChange={(e) => updateSettings('minMinutesBeforeFirstBreak', Number(e.target.value) || 0)}
              >
                {[...selectMinutes([60, 90, 120, 150, 180], settings.minMinutesBeforeFirstBreak)].map((minutes) => (
                  <option key={minutes} value={minutes}>{minutes / 60} hours</option>
                ))}
              </select>
            </Field>
            <Field label="Break slack" hint="Can start earlier or later to protect coverage">
              <select
                className="cap-field__input"
                value={settings.breakSlackMinutes ?? 30}
                onChange={(e) => updateSettings('breakSlackMinutes', Number(e.target.value) || 0)}
              >
                {selectMinutes([0, 15, 30, 45, 60, 90], settings.breakSlackMinutes ?? 30).map((minutes) => (
                  <option key={minutes} value={minutes}>{minutes === 0 ? 'None' : `± ${minutes} min`}</option>
                ))}
              </select>
            </Field>
            <Field label="Lunch after shift" hint="Preferred time from shift start">
              <select
                className="cap-field__input"
                value={settings.minMinutesBeforeLunch}
                onChange={(e) => updateSettings('minMinutesBeforeLunch', Number(e.target.value) || 60)}
              >
                {[...selectMinutes([90, 120, 150, 180, 210, 240, 270, 300], settings.minMinutesBeforeLunch)].map((minutes) => (
                  <option key={minutes} value={minutes}>{minutes / 60} hours</option>
                ))}
              </select>
            </Field>
            <Field label="Lunch slack" hint="Can start earlier or later to protect coverage">
              <select
                className="cap-field__input"
                value={settings.lunchSlackMinutes ?? 30}
                onChange={(e) => updateSettings('lunchSlackMinutes', Number(e.target.value) || 0)}
              >
                {selectMinutes([0, 15, 30, 45, 60, 90], settings.lunchSlackMinutes ?? 30).map((minutes) => (
                  <option key={minutes} value={minutes}>{minutes === 0 ? 'None' : `± ${minutes} min`}</option>
                ))}
              </select>
            </Field>
          </div>
          <p className="sched-settings-slack-preview m-0">
            First break: <strong>{formatSlackRangeLabel(settings.minMinutesBeforeFirstBreak, settings.breakSlackMinutes)}</strong> after shift start
            {' · '}
            Lunch: <strong>{formatSlackRangeLabel(settings.minMinutesBeforeLunch, settings.lunchSlackMinutes)}</strong> after shift start.
            The engine picks a time in that range that best matches interval staffing.
          </p>
          <div className="sched-settings-row">
            <Field label="Min gap (break ↔ lunch)">
              <select
                className="cap-field__input"
                value={settings.minMinutesBetweenBreaksAndLunch}
                onChange={(e) => updateSettings('minMinutesBetweenBreaksAndLunch', Number(e.target.value) || 0)}
              >
                {[30, 45, 60, 75, 90].map((minutes) => (
                  <option key={minutes} value={minutes}>{minutes} min</option>
                ))}
              </select>
            </Field>
            <Field label="Max time on phones">
              <select
                className="cap-field__input"
                value={settings.maxConsecutiveWorkingMinutes}
                onChange={(e) => updateSettings('maxConsecutiveWorkingMinutes', Number(e.target.value) || 240)}
              >
                {[120, 150, 180, 210, 240, 270, 300].map((minutes) => (
                  <option key={minutes} value={minutes}>{minutes / 60} hours</option>
                ))}
              </select>
            </Field>
          </div>
          {(
            [
              ['evenlyDistributeLunches', 'Stagger lunches across the team'],
              ['evenlyDistributeBreaks', 'Stagger breaks across the team'],
              ['preventBreakLunchOverlapShortages', 'Avoid coverage gaps when several agents are on break'],
              ['enforceMinLunchBreakGap', 'Keep the minimum gap between lunch and breaks'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="sched-checkbox">
              <input
                type="checkbox"
                checked={Boolean(settings.constraints[key])}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    constraints: { ...prev.constraints, [key]: e.target.checked },
                  }))
                }
              />
              {label}
            </label>
          ))}
        </Section>

        <Section title="Shift rules">
          <div className="sched-settings-row">
            <Field label="Earliest start">
              <input className="cap-field__input" type="time" value={settings.earliestShiftStart} onChange={(e) => updateSettings('earliestShiftStart', e.target.value)} />
            </Field>
            <Field label="Latest start">
              <input className="cap-field__input" type="time" value={settings.latestShiftStart} onChange={(e) => updateSettings('latestShiftStart', e.target.value)} />
            </Field>
            <Field
              label="Start times"
              hint={settings.shiftStartMode === 'fixed' ? 'Same start every working day' : 'Start may change by day to cover demand'}
            >
              <select className="cap-field__input" value={settings.shiftStartMode} onChange={(e) => updateSettings('shiftStartMode', e.target.value as SchedulingSettings['shiftStartMode'])}>
                <option value="fixed">Fixed</option>
                <option value="flexible">Flexible</option>
              </select>
            </Field>
            <Field label="Max agents on the same start">
              <StableNumberInput
                className="cap-field__input"
                min={1}
                value={settings.maxEmployeesPerShiftTemplate}
                allowEmpty={false}
                onCommit={(parsed) => {
                  if (parsed == null) return
                  updateSettings('maxEmployeesPerShiftTemplate', parsed)
                }}
                aria-label="Max agents on the same start"
              />
            </Field>
          </div>
          <div className="sched-settings-row">
            <Field label="Minimum coverage" hint="How much of required staffing to aim for">
              <select
                className="cap-field__input"
                value={Math.round(settings.minStaffingCoverage * 100)}
                onChange={(e) => updateSettings('minStaffingCoverage', (Number(e.target.value) || 85) / 100)}
              >
                {selectMinutes([70, 75, 80, 85, 90, 95, 100], Math.round(settings.minStaffingCoverage * 100)).map((pct) => (
                  <option key={pct} value={pct}>{pct}%</option>
                ))}
              </select>
            </Field>
          </div>
        </Section>

        <Section title="Coverage rules">
          {(
            [
              ['followUploadedPattern', 'Follow the uploaded interval pattern'],
              ['minimizeOverUnder', 'Minimize overstaffing and understaffing'],
              ['useTeamBlockSchedules', 'Apply saved team / supervisor block schedules'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="sched-checkbox">
              <input
                type="checkbox"
                checked={Boolean(settings.constraints[key])}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    constraints: { ...prev.constraints, [key]: e.target.checked },
                  }))
                }
              />
              {label}
            </label>
          ))}
        </Section>

        <Section title="Team / block schedules">
          <BlockScheduleEditor scenarioId={scenarioId} supervisors={supervisors} />
        </Section>
      </div>

      <section className="sched-panel saas-card sched-settings-footer">
        <label className="sched-checkbox">
          <input type="checkbox" checked={saveToTemplate} onChange={(e) => setSaveToTemplate(e.target.checked)} />
          Save changes to template
        </label>
        {message ? <p className="sched-settings-message m-0">{message}</p> : null}
        <div className="sched-settings-footer__actions">
          <Link to="/scheduling" className="saas-btn saas-btn--ghost">Back to scheduling</Link>
          <button type="button" className="saas-btn saas-btn--secondary" onClick={() => handleSave(false)}>
            Save template only
          </button>
          <button type="button" className="saas-btn saas-btn--primary" onClick={() => handleSave(true)}>
            Save Setup
          </button>
        </div>
      </section>

      {navigationBlocked ? (
        <UnsavedChangesDialog
          title="Save Setup?"
          message="You have unsaved scheduling settings. Save Setup before leaving this page?"
          saveLabel="Save Setup"
          onSave={() => {
            handleSave(true, false)
            proceedNavigation()
          }}
          onDiscard={proceedNavigation}
          onCancel={cancelNavigation}
        />
      ) : null}
    </div>
  )
}
