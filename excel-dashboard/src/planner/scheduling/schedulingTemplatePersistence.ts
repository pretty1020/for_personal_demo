import type { PlannerScenario } from '../types'
import type { SchedulingRuleTemplate, SchedulingTemplateStore } from './schedulingSettingsTypes'
import { templateScopeKey } from './schedulingSettingsTypes'
import { createDefaultSchedulingSettings } from './defaultSchedulingSettings'
import { createSchedulingRuleTemplate } from './defaultSchedulingSettings'
import { migrateSchedulingSettings } from './workingDaysUtils'

export const SCHEDULING_TEMPLATES_STORAGE_KEY = 'wfp-scheduling-templates-v1'

const EMPTY_STORE: SchedulingTemplateStore = { templates: [], defaults: {} }

export function loadSchedulingTemplateStore(): SchedulingTemplateStore {
  try {
    const raw = localStorage.getItem(SCHEDULING_TEMPLATES_STORAGE_KEY)
    if (!raw) return { ...EMPTY_STORE, templates: [], defaults: {} }
    const parsed = JSON.parse(raw) as SchedulingTemplateStore
    return {
      templates: parsed.templates ?? [],
      defaults: parsed.defaults ?? {},
    }
  } catch {
    return { ...EMPTY_STORE }
  }
}

export function saveSchedulingTemplateStore(store: SchedulingTemplateStore): void {
  localStorage.setItem(SCHEDULING_TEMPLATES_STORAGE_KEY, JSON.stringify(store))
}

export function listTemplatesForScenario(scenario: PlannerScenario): SchedulingRuleTemplate[] {
  const store = loadSchedulingTemplateStore()
  const scope = templateScopeKey(scenario.plan.clientId ?? scenario.id, scenario.plan.location)
  return store.templates.filter(
    (template) =>
      templateScopeKey(template.clientId, template.lobName) === scope || template.scenarioId === scenario.id,
  )
}

export function getDefaultTemplateForScenario(scenario: PlannerScenario): SchedulingRuleTemplate | null {
  const store = loadSchedulingTemplateStore()
  const scope = templateScopeKey(scenario.plan.clientId ?? scenario.id, scenario.plan.location)
  const defaultId = store.defaults[scope]
  if (defaultId) {
    const found = store.templates.find((template) => template.id === defaultId)
    if (found) return found
  }
  const scoped = listTemplatesForScenario(scenario)
  return scoped.find((template) => template.isDefault) ?? scoped[0] ?? null
}

export function upsertSchedulingTemplate(template: SchedulingRuleTemplate): SchedulingRuleTemplate {
  const store = loadSchedulingTemplateStore()
  const index = store.templates.findIndex((item) => item.id === template.id)
  const next = { ...template, updatedAt: new Date().toISOString() }
  if (index >= 0) store.templates[index] = next
  else store.templates.push(next)
  saveSchedulingTemplateStore(store)
  return next
}

export function deleteSchedulingTemplate(templateId: string): void {
  const store = loadSchedulingTemplateStore()
  store.templates = store.templates.filter((template) => template.id !== templateId)
  for (const [key, value] of Object.entries(store.defaults)) {
    if (value === templateId) delete store.defaults[key]
  }
  saveSchedulingTemplateStore(store)
}

export function setDefaultTemplate(template: SchedulingRuleTemplate): void {
  const store = loadSchedulingTemplateStore()
  const scope = templateScopeKey(template.clientId, template.lobName)
  store.defaults[scope] = template.id
  store.templates = store.templates.map((item) => {
    const sameScope = templateScopeKey(item.clientId, item.lobName) === scope
    if (!sameScope) return item
    return { ...item, isDefault: item.id === template.id }
  })
  saveSchedulingTemplateStore(store)
}

export function ensureDefaultTemplateForScenario(scenario: PlannerScenario): SchedulingRuleTemplate {
  const existing = getDefaultTemplateForScenario(scenario)
  if (existing) return existing
  const template = createSchedulingRuleTemplate(
    scenario,
    `${scenario.plan.client} · ${scenario.plan.location} — Default`,
    createDefaultSchedulingSettings(scenario),
  )
  template.isDefault = true
  const saved = upsertSchedulingTemplate(template)
  setDefaultTemplate(saved)
  return saved
}

export function exportTemplatesForScenario(scenario: PlannerScenario): string {
  return JSON.stringify(listTemplatesForScenario(scenario), null, 2)
}

export function importTemplatesFromJson(json: string, scenario: PlannerScenario): SchedulingRuleTemplate[] {
  const parsed = JSON.parse(json) as SchedulingRuleTemplate[]
  if (!Array.isArray(parsed)) throw new Error('Invalid template file.')
  const imported: SchedulingRuleTemplate[] = []
  for (const item of parsed) {
    const template = createSchedulingRuleTemplate(scenario, item.name ?? 'Imported template', item.settings)
    template.settings = migrateSchedulingSettings({ ...createDefaultSchedulingSettings(scenario), ...item.settings })
    imported.push(upsertSchedulingTemplate(template))
  }
  return imported
}
