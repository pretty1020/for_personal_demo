import { useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { ModulePageHeader } from '../components/shell/ModulePageHeader'
import { useDemoSession } from '../context/DemoSessionContext'
import {
  loadFormulaOverrides,
  METRIC_FORMULA_DEFS,
  resetFormulaOverrides,
  resolveFormulaSections,
  saveFormulaOverrides,
  type FormulaOverridesState,
  type MetricFormulaId,
} from '../planner/formulaOverrides'
import type { FormulaSectionId } from '../utils/staffingCapacity/formulaReference'

export function FormulaReferencePage() {
  const { canEditFormulas, canViewPortfolioSummary } = useDemoSession()
  const [draft, setDraft] = useState<FormulaOverridesState>(() => loadFormulaOverrides())
  const [message, setMessage] = useState('')
  const [activeSection, setActiveSection] = useState<FormulaSectionId | 'metrics' | 'notes'>('metrics')

  const sections = useMemo(() => resolveFormulaSections(draft), [draft])

  if (!canViewPortfolioSummary) {
    return <Navigate to="/capacity-plan" replace />
  }

  const editable = canEditFormulas

  const save = () => {
    // Drop the blank lines left at the ends of editing, keeping any inside the block.
    const trimmed = {
      ...draft,
      sections: Object.fromEntries(
        Object.entries(draft.sections).map(([id, section]) => {
          if (!section?.lines) return [id, section]
          const lines = [...section.lines]
          while (lines.length && lines[0]!.trim() === '') lines.shift()
          while (lines.length && lines[lines.length - 1]!.trim() === '') lines.pop()
          return [id, { ...section, lines }]
        }),
      ),
    }
    setDraft(trimmed)
    saveFormulaOverrides(trimmed)
    setMessage('Formula reference saved for this workspace.')
  }

  const reset = () => {
    if (!window.confirm('Reset all formula text to the built-in defaults?')) return
    resetFormulaOverrides()
    setDraft(loadFormulaOverrides())
    setMessage('Formulas reset to defaults.')
  }

  const patchSection = (id: FormulaSectionId, partial: { summary?: string; linesText?: string }) => {
    setDraft((prev) => {
      const current = prev.sections[id] ?? {}
      const nextSection = { ...current }
      if (partial.summary != null) nextSection.summary = partial.summary
      if (partial.linesText != null) {
        // Keep exactly what was typed. Trimming and dropping blank lines here made the
        // textarea round-trip to the same value, so Enter never inserted a line break
        // and leading spaces vanished as you typed. Blank lines are tidied up on save.
        nextSection.lines = partial.linesText.split('\n')
      }
      return {
        ...prev,
        sections: { ...prev.sections, [id]: nextSection },
      }
    })
    setMessage('')
  }

  const patchMetric = (id: MetricFormulaId, text: string) => {
    setDraft((prev) => ({
      ...prev,
      metrics: { ...prev.metrics, [id]: text },
    }))
    setMessage('')
  }

  return (
    <div className="plan-settings formula-ref">
      <ModulePageHeader
        title="Capacity formulas"
        description={
          editable
            ? 'Admin: edit the formula text shown across Capacity Help tips and this reference.'
            : 'Read-only formula reference for Manager and above. Ask an Admin to change wording.'
        }
        actions={
          editable ? (
            <div className="plan-settings__actions">
              <button type="button" className="saas-btn saas-btn--secondary" onClick={reset}>
                Reset defaults
              </button>
              <button type="button" className="saas-btn" onClick={save}>
                Save formulas
              </button>
            </div>
          ) : null
        }
      />

      {message ? <p className="plan-settings__flash">{message}</p> : null}
      {draft.updatedAt ? (
        <p className="saas-muted m-0 text-sm">Last saved {new Date(draft.updatedAt).toLocaleString()}</p>
      ) : null}

      <div className="formula-ref__layout">
        <nav className="formula-ref__nav saas-card" aria-label="Formula sections">
          <button
            type="button"
            className={`formula-ref__nav-item${activeSection === 'metrics' ? ' is-active' : ''}`}
            onClick={() => setActiveSection('metrics')}
          >
            Core matrix formulas
          </button>
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              className={`formula-ref__nav-item${activeSection === section.id ? ' is-active' : ''}`}
              onClick={() => setActiveSection(section.id)}
            >
              {section.title}
            </button>
          ))}
          <button
            type="button"
            className={`formula-ref__nav-item${activeSection === 'notes' ? ' is-active' : ''}`}
            onClick={() => setActiveSection('notes')}
          >
            Admin notes
          </button>
        </nav>

        <section className="formula-ref__panel saas-card">
          {activeSection === 'metrics' ? (
            <div className="formula-ref__stack">
              <header>
                <p className="plan-settings__eyebrow">Staffing matrix</p>
                <h3 className="m-0">Core production HC formulas</h3>
                <p className="saas-muted m-0 mt-2 text-sm">
                  These texts appear in matrix Help tips for Planned / Actual Production HC.
                </p>
              </header>
              {METRIC_FORMULA_DEFS.map((metric) => {
                const value = draft.metrics[metric.id] ?? metric.defaultText
                return (
                  <label key={metric.id} className="saas-field">
                    <span className="saas-field__label">{metric.title}</span>
                    <textarea
                      className="cap-field__input formula-ref__textarea"
                      rows={10}
                      value={value}
                      disabled={!editable}
                      onChange={(event) => patchMetric(metric.id, event.target.value)}
                    />
                  </label>
                )
              })}
            </div>
          ) : null}

          {activeSection !== 'metrics' && activeSection !== 'notes'
            ? (() => {
                const section = sections.find((item) => item.id === activeSection)
                if (!section) return null
                const linesText = (draft.sections[section.id]?.lines ?? section.lines).join('\n')
                const summary = draft.sections[section.id]?.summary ?? section.summary
                return (
                  <div className="formula-ref__stack">
                    <header>
                      <p className="plan-settings__eyebrow">Reference</p>
                      <h3 className="m-0">{section.title}</h3>
                    </header>
                    <label className="saas-field">
                      <span className="saas-field__label">Summary</span>
                      <textarea
                        className="cap-field__input formula-ref__textarea"
                        rows={3}
                        value={summary}
                        disabled={!editable}
                        onChange={(event) => patchSection(section.id, { summary: event.target.value })}
                      />
                    </label>
                    <label className="saas-field">
                      <span className="saas-field__label">Formula lines (one per line)</span>
                      <textarea
                        className="cap-field__input formula-ref__textarea"
                        rows={12}
                        value={linesText}
                        disabled={!editable}
                        onChange={(event) => patchSection(section.id, { linesText: event.target.value })}
                      />
                    </label>
                  </div>
                )
              })()
            : null}

          {activeSection === 'notes' ? (
            <div className="formula-ref__stack">
              <header>
                <p className="plan-settings__eyebrow">Notes</p>
                <h3 className="m-0">Admin notes</h3>
                <p className="saas-muted m-0 mt-2 text-sm">
                  Free-form notes for your team. Saved to your workspace when you are signed in.
                </p>
              </header>
              <label className="saas-field">
                <span className="saas-field__label">Notes</span>
                <textarea
                  className="cap-field__input formula-ref__textarea"
                  rows={14}
                  value={draft.notes}
                  disabled={!editable}
                  onChange={(event) => {
                    setDraft((prev) => ({ ...prev, notes: event.target.value }))
                    setMessage('')
                  }}
                  placeholder="Document any local calculation conventions…"
                />
              </label>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}
