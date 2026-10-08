/**
 * Who may read what, and which keys are storable. Kept free of database imports so the
 * rules can be tested directly.
 */

/**
 * Planning data that belongs in the database. Anything not listed here — active
 * scenario, column order, period filter and the other view preferences — stays in
 * the browser on purpose, because one person's layout should not follow everyone else.
 *
 * Superseded keys are still accepted so an older browser can hand its data over
 * during the one-time backfill; nothing writes to them going forward.
 */
export const DOCUMENT_KEYS = new Set([
  'wfp-planner-scenarios-v2',
  'wfp-planner-scenarios-v1',
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
  'wfp-dbe-lines-v2',
  'wfp-dbe-lines-v1',
  'wfp-capacity-formula-overrides-v1',
  'staffing-capacity-plan-formula-notes',
])

/**
 * Manager, Director, VP and Admin read every planner's documents — that is what makes
 * the portfolio Summary add up across all clients. Capacity planners, schedulers and
 * analysts only ever see rows they own.
 *
 * 'scheduler' and 'executive' are older stored values for cap_planner and vp; they are
 * normalised here so a session issued before the rename still lands on the right side.
 */
export function normalizeAccessLevel(accessLevel: string | null | undefined): string {
  const value = (accessLevel ?? '').trim().toLowerCase()
  if (value === 'executive') return 'vp'
  if (value === 'scheduler') return 'cap_planner'
  return value
}

export function canReadAllDocuments(accessLevel: string | null | undefined): boolean {
  const normalized = normalizeAccessLevel(accessLevel)
  return (
    normalized === 'manager' ||
    normalized === 'director' ||
    normalized === 'vp' ||
    normalized === 'admin'
  )
}

/**
 * Who may save to a document they do not own.
 *
 * Same four roles that can read everything: a manager who can already see a planner's
 * numbers on the Summary is the person expected to correct them. Ownership does not
 * change — the row stays with the planner, and the audit log records who actually typed.
 */
export function canWriteOthersDocuments(accessLevel: string | null | undefined): boolean {
  return canReadAllDocuments(accessLevel)
}

/**
 * Who may change settings shared by the whole organisation, currently the formulas.
 *
 * Admin only, and deliberately narrower than the rule above. A formula edit silently
 * changes every number on every planner's screen, so it is not a manager-level action.
 */
export function canWriteSharedSettings(accessLevel: string | null | undefined): boolean {
  return normalizeAccessLevel(accessLevel) === 'admin'
}

/** Who may read the activity trail. */
export function canReadAuditLog(accessLevel: string | null | undefined): boolean {
  return normalizeAccessLevel(accessLevel) === 'admin'
}

/**
 * DBE holds client billing and margin, so it is Manager and above only — the same rule
 * the /dbe page enforces in the browser.
 *
 * Repeated here because a route guard only stops the screen from opening. Without a
 * check on the write itself, a planner or analyst could still add a client or LOB by
 * calling the documents endpoint directly.
 */
export const DBE_DOCUMENT_KEYS = new Set([
  'wfp-dbe-lines-v3',
  'wfp-dbe-lines-v2',
  'wfp-dbe-lines-v1',
])

export function isDbeDocumentKey(key: string): boolean {
  return DBE_DOCUMENT_KEYS.has(key)
}

/**
 * Whether this person may create or change DBE lines.
 *
 * Judged on the actor, not the owner of the row: a manager standing in for a planner is
 * allowed, and a planner is not — even when the row would be their own.
 */
export function canWriteDbeDocuments(accessLevel: string | null | undefined): boolean {
  return canReadAllDocuments(accessLevel)
}
