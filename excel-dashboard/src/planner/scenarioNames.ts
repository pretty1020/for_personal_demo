/** Default reference scenario shown across Capacity Plan and Planning Simulator. */
export const DEFAULT_REFERENCE_SCENARIO_NAME = 'Scenario 1'

const LEGACY_REFERENCE_NAMES = new Set(['Test', 'Baseline', 'test', 'baseline'])

export function isLegacyReferenceName(name: string): boolean {
  return LEGACY_REFERENCE_NAMES.has(name.trim())
}

export function toReferenceScenarioName(name: string): string {
  return isLegacyReferenceName(name) ? DEFAULT_REFERENCE_SCENARIO_NAME : name
}
