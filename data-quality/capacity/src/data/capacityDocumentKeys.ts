/**
 * Splits Capacity's stored keys into what belongs in MariaDB and what is ephemeral.
 *
 * Planning data and UI plan preferences are saved to capacity_documents (MariaDB).
 * In production (remote backend) they live in an in-memory session cache only —
 * never as a durable localStorage copy — and every write is pushed to the database.
 *
 * Act-as is the only browser-storage flag: it coordinates which planner's cache is
 * loaded across tabs. It is not planning data and is never uploaded.
 */

/** Planning data + plan UI prefs. Saved to capacity_documents, owned by the user. */
export const DOCUMENT_KEYS = [
  'wfp-planner-scenarios-v2',
  'wfp-roster-store-v1',
  'wfp-roster-sync-meta-v1',
  'wfp-ledger-actual-overrides-v1',
  'wfp-forecast-overrides-v1',
  'wfp-capacity-plan-overrides-v1',
  'wfp-aht-analysis-overrides-v1',
  'wfp-capacity-shrinkage-categories-v1',
  'wfp-capacity-stage-attrition-v1',
  'wfp-capacity-support-roles-v1',
  'wfp-capacity-forecast-modes-v1',
  'wfp-capacity-production-fte-unlock-v1',
  'wfp-capacity-required-production-fte-unlock-v1',
  'wfp-capacity-driver-week-locks-v1',
  'wfp-capacity-plan-previous-publish-v1',
  'wfp-dbe-lines-v3',
  'wfp-capacity-formula-overrides-v1',
  'staffing-capacity-plan-formula-notes',
  // Former "local prefs" — now MariaDB so production never uses localStorage as SoT.
  'wfp-planner-active-v2',
  'wfp-planner-granularity-v1',
  'wfp-capacity-plan-view-v1',
  'wfp-capacity-matrix-view-v4',
  'wfp-capacity-metric-order-v1',
  'wfp-capacity-metric-hidden-v1',
  'wfp-capacity-period-v2',
  'wfp-dbe-period-v1',
] as const

/**
 * Older key names still read on upgrade so an existing browser hands its data over
 * during the one-time backfill. Nothing writes to these.
 */
export const LEGACY_DOCUMENT_KEYS = [
  'wfp-planner-scenarios-v1',
  'wfp-dbe-lines-v2',
  'wfp-dbe-lines-v1',
  'wfp-planner-active-v1',
  'wfp-capacity-matrix-view-v2',
  'wfp-capacity-period-v1',
] as const

/**
 * Ephemeral browser flags only — never uploaded, never treated as plan SoT.
 * Cleared on sign-out. Act-as coordinates cache ownership across tabs.
 */
export const LOCAL_PREFERENCE_KEYS = [
  'wfp-act-as-v1',
] as const

const DOCUMENT_KEY_SET: ReadonlySet<string> = new Set<string>([
  ...DOCUMENT_KEYS,
  ...LEGACY_DOCUMENT_KEYS,
])

export function isDocumentKey(key: string): boolean {
  return DOCUMENT_KEY_SET.has(key)
}

/**
 * Keys whose combined values make up the portfolio Summary. Managers and above read
 * every planner's copy of these; everyone else only reads their own.
 */
export const SUMMARY_DOCUMENT_KEYS = [
  'wfp-planner-scenarios-v2',
  'wfp-capacity-plan-overrides-v1',
  'wfp-ledger-actual-overrides-v1',
  'wfp-forecast-overrides-v1',
  'wfp-capacity-shrinkage-categories-v1',
  'wfp-dbe-lines-v3',
] as const

/**
 * localStorage holds strings; the table holds JSON so the Summary can read across
 * planners without re-parsing every row. Objects and arrays are stored as real JSON;
 * anything else keeps its original text, which is what makes the round trip exact —
 * storing the parsed form of '"hello"' would hand back `hello` and lose the quotes.
 */
export function toDocumentPayload(raw: string): unknown {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed !== null && typeof parsed === 'object') return parsed
  } catch {
    // Not JSON — fall through and keep the original text.
  }
  return raw
}

/** Inverse of toDocumentPayload. null means "no value", i.e. remove the key. */
export function fromDocumentPayload(payload: unknown): string | null {
  if (payload === null || payload === undefined) return null
  if (typeof payload === 'string') return payload
  return JSON.stringify(payload)
}
