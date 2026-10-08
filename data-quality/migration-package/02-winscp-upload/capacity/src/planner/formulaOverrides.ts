import {
  FORMULA_NOTES_STORAGE_KEY,
  FORMULA_SECTIONS,
  type FormulaSection,
  type FormulaSectionId,
} from '../utils/staffingCapacity/formulaReference'
import {
  ACTUAL_PRODUCTION_HC_FORMULA as DEFAULT_ACTUAL_PRODUCTION_HC_FORMULA,
  PLANNED_PRODUCTION_HC_FORMULA as DEFAULT_PLANNED_PRODUCTION_HC_FORMULA,
} from './capacityMetricFormulas'

export const CAPACITY_FORMULA_OVERRIDES_KEY = 'wfp-capacity-formula-overrides-v1'

export type MetricFormulaId = 'planned_production_hc' | 'actual_production_hc'

export type MetricFormulaDef = {
  id: MetricFormulaId
  title: string
  defaultText: string
}

export const METRIC_FORMULA_DEFS: MetricFormulaDef[] = [
  {
    id: 'planned_production_hc',
    title: 'Planned Production HC',
    defaultText: DEFAULT_PLANNED_PRODUCTION_HC_FORMULA,
  },
  {
    id: 'actual_production_hc',
    title: 'Actual Production HC',
    defaultText: DEFAULT_ACTUAL_PRODUCTION_HC_FORMULA,
  },
]

export type FormulaOverridesState = {
  /** Editable copies of FORMULA_SECTIONS lines/summary (by section id). */
  sections: Partial<Record<FormulaSectionId, { summary?: string; lines?: string[] }>>
  /** Editable metric formula bodies. */
  metrics: Partial<Record<MetricFormulaId, string>>
  /** Free-form admin notes (legacy key also supported). */
  notes: string
  updatedAt: string | null
}

function emptyState(): FormulaOverridesState {
  return { sections: {}, metrics: {}, notes: '', updatedAt: null }
}

export function loadFormulaOverrides(): FormulaOverridesState {
  try {
    const raw = localStorage.getItem(CAPACITY_FORMULA_OVERRIDES_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<FormulaOverridesState>
      return {
        sections: parsed.sections ?? {},
        metrics: parsed.metrics ?? {},
        notes: typeof parsed.notes === 'string' ? parsed.notes : '',
        updatedAt: parsed.updatedAt ?? null,
      }
    }
    // Migrate legacy notes-only key if present.
    const legacyNotes = localStorage.getItem(FORMULA_NOTES_STORAGE_KEY)
    if (legacyNotes) {
      return { ...emptyState(), notes: legacyNotes }
    }
  } catch {
    // ignore
  }
  return emptyState()
}

export function saveFormulaOverrides(state: FormulaOverridesState): void {
  const next: FormulaOverridesState = {
    ...state,
    updatedAt: new Date().toISOString(),
  }
  localStorage.setItem(CAPACITY_FORMULA_OVERRIDES_KEY, JSON.stringify(next))
  if (next.notes.trim()) {
    localStorage.setItem(FORMULA_NOTES_STORAGE_KEY, next.notes)
  } else {
    localStorage.removeItem(FORMULA_NOTES_STORAGE_KEY)
  }
}

export function resetFormulaOverrides(): void {
  localStorage.removeItem(CAPACITY_FORMULA_OVERRIDES_KEY)
  localStorage.removeItem(FORMULA_NOTES_STORAGE_KEY)
}

export function resolveFormulaSections(overrides?: FormulaOverridesState | null): FormulaSection[] {
  const state = overrides ?? loadFormulaOverrides()
  return FORMULA_SECTIONS.map((section) => {
    const patch = state.sections[section.id]
    if (!patch) return section
    return {
      ...section,
      summary: patch.summary?.trim() ? patch.summary : section.summary,
      lines: patch.lines?.length ? patch.lines : section.lines,
    }
  })
}

export function resolveMetricFormula(id: MetricFormulaId, overrides?: FormulaOverridesState | null): string {
  const state = overrides ?? loadFormulaOverrides()
  const custom = state.metrics[id]?.trim()
  if (custom) return custom
  return METRIC_FORMULA_DEFS.find((item) => item.id === id)?.defaultText ?? ''
}

/** Runtime helpers used by HelpTips / matrix display. */
export function getPlannedProductionHcFormulaText(): string {
  return resolveMetricFormula('planned_production_hc')
}

export function getActualProductionHcFormulaText(): string {
  return resolveMetricFormula('actual_production_hc')
}
