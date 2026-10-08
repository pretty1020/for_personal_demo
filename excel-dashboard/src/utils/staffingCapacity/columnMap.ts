import type { SheetSnapshot } from '../../types/dashboard'
import { normalizeTabNameForMatch } from '../datasheetTab'
import { compactHeaderKey, normalizeHeaderLabel } from '../slicerColumns'
import type { StaffingColumnMap, StaffingFieldKey } from './types'

const FIELD_ALIASES: Record<StaffingFieldKey, string[]> = {
  fy: ['fy', 'fiscal year', 'financial year', 'fiscal yr'],
  month: ['month', 'period month', 'calendar month', 'mo'],
  week: ['week', 'week number', 'week no', 'week#', 'iso week'],
  weekStartDate: ['week start date', 'week start', 'week commencing', 'wc date', 'period start', 'start date'],
  projectCode: ['project code', 'projectcode', 'project id', 'projectid', 'engagement code'],
  client: ['client', 'customer', 'account', 'client name'],
  campaign: ['campaign', 'program', 'queue', 'project name'],
  lob: ['lob', 'line of business', 'lineofbusiness', 'business line', 'service line'],
  location: ['location', 'site', 'country', 'geo', 'city'],
  owner: ['owner', 'lob owner', 'business owner', 'capacity owner'],
  requiredHc: [
    'required headcount',
    'req headcount',
    'required hc',
    'req hc',
    'required heads',
    'demand hc',
    'target headcount',
    'required staff',
  ],
  activeProdHc: [
    'active production headcount',
    'active headcount',
    'production headcount',
    'production hc',
    'prod hc',
    'active hc',
    'staffed hc',
    'rostered headcount',
  ],
  activeProdFte: ['active production fte', 'production fte', 'active fte', 'fte', 'billable fte'],
  forecastVolume: ['forecast volume', 'forecasted volume', 'forecast calls', 'forecast', 'proj volume'],
  actualOfferedVolume: ['actual offered volume', 'offered volume', 'offered calls', 'calls offered', 'arrival volume'],
  actualHandledVolume: ['actual handled volume', 'handled volume', 'handled calls', 'calls handled', 'answered volume'],
  plannedShrinkPct: ['planned shrinkage', 'planned shrinkage pct', 'planned shrink', 'shrink plan', 'budget shrinkage'],
  actualShrinkPct: ['actual shrinkage', 'actual shrinkage pct', 'actual shrink', 'shrink actual', 'realized shrinkage'],
  plannedInOfficeShrinkPct: [
    'planned in office shrinkage',
    'planned in-office shrinkage',
    'planned internal shrinkage',
    'planned on floor shrinkage',
    'planned io shrinkage',
  ],
  actualInOfficeShrinkPct: [
    'actual in office shrinkage',
    'actual in-office shrinkage',
    'actual internal shrinkage',
    'actual on floor shrinkage',
    'actual io shrinkage',
  ],
  plannedOutOfficeShrinkPct: [
    'planned out of office shrinkage',
    'planned out-of-office shrinkage',
    'planned external shrinkage',
    'planned ooo shrinkage',
    'planned pto shrinkage',
  ],
  actualOutOfficeShrinkPct: [
    'actual out of office shrinkage',
    'actual out-of-office shrinkage',
    'actual external shrinkage',
    'actual ooo shrinkage',
    'actual absence shrinkage',
  ],
  plannedAttrition: ['planned attrition', 'attrition plan', 'budget attrition', 'forecast attrition'],
  actualAttrition: ['actual attrition', 'attrition actual', 'realized attrition', 'achieved attrition'],
  plannedTrainingAttrition: [
    'planned training attrition',
    'training attrition plan',
    'planned attrition training',
    'budget training attrition',
    'forecast training attrition',
  ],
  actualTrainingAttrition: [
    'actual training attrition',
    'training attrition actual',
    'realized training attrition',
    'achieved training attrition',
  ],
  cappedAht: ['capped aht', 'cap aht', 'aht cap', 'max aht'],
  plannedAht: ['planned aht', 'target aht', 'aht plan', 'goal aht', 'aht budget'],
  actualAht: ['actual aht', 'aht actual', 'achieved aht', 'realized aht'],
  billingType: ['billing type', 'billing', 'bill type', 'pricing model', 'rate type'],
  productionHours: [
    'production hours',
    'productive hours',
    'billable hours',
    'hours per agent',
    'agent hours',
    'total production hours',
  ],
  days: ['days', '# days', 'working days', 'billable days', 'prod days'],
  billingRate: ['billing rate', 'bill rate', 'contract rate', 'usd rate', 'revenue rate override', 'revenue rate', 'rate override'],
  plannedNewHireClassHc: [
    'planned new hire class',
    'planned new hire class headcount',
    'planned nh class',
    'planned nh class hc',
    'planned training class headcount',
    'new hire class planned',
    'planned class size',
  ],
  newHireCount: ['new hire count', 'new hire employee', 'new hires', 'new hire employees', 'new hire hc'],
  trainingCount: ['training count', 'in training', 'employees in training', 'training pipeline'],
  graduateCount: ['graduate count', 'training graduates', 'graduated training', 'graduates'],
  trainingHc: [
    'training hc',
    'training headcount',
    'training fte',
    'heads in training',
    'training workforce',
    'training staff hc',
  ],
  supportHc: [
    'support hc',
    'support headcount',
    'support fte',
    'support workforce',
    'support staff hc',
    'non production support hc',
  ],
  plannedPaidProductionHours: [
    'planned paid production hours',
    'planned productive paid hours',
    'planned production paid hours',
    'budget paid production hours',
  ],
  actualPaidProductionHours: [
    'actual paid production hours',
    'actual productive paid hours',
    'actual production paid hours',
    'realized paid production hours',
  ],
  plannedNewHireTrainingHours: [
    'planned new hire training hours',
    'planned nh training hours',
    'planned new hire training hrs',
    'budget new hire training hours',
  ],
  actualTrainingHours: [
    'actual training hours',
    'training hours actual',
    'realized training hours',
    'actual nh training hours',
  ],
  tlCount: ['team lead count', 'tl count', 'team leads', 'number of team leads'],
  opsManagerCount: ['operations manager count', 'ops manager count', 'operations managers', 'om count'],
  trainerCount: ['trainer count', 'trainers', 'training staff count'],
  qaCount: ['qa count', 'quality analyst count', 'quality analysts', 'qa staff'],
  wfmSupportCount: ['wfm support count', 'wfm count', 'workforce management support', 'wfm staff'],
}

/** Map ambiguous “attrition” / “shrinkage” / “aht” columns after planned vs actual disambiguation. */
const FIELD_MAP_ORDER: StaffingFieldKey[] = [
  'fy',
  'month',
  'weekStartDate',
  'week',
  'projectCode',
  'client',
  'campaign',
  'lob',
  'location',
  'owner',
  'requiredHc',
  'activeProdHc',
  'activeProdFte',
  'forecastVolume',
  'actualOfferedVolume',
  'actualHandledVolume',
  'plannedShrinkPct',
  'actualShrinkPct',
  'plannedInOfficeShrinkPct',
  'actualInOfficeShrinkPct',
  'plannedOutOfficeShrinkPct',
  'actualOutOfficeShrinkPct',
  'plannedAttrition',
  'actualAttrition',
  'plannedTrainingAttrition',
  'actualTrainingAttrition',
  'cappedAht',
  'plannedAht',
  'actualAht',
  'billingType',
  'productionHours',
  'days',
  'plannedNewHireClassHc',
  'newHireCount',
  'trainingCount',
  'graduateCount',
  'tlCount',
  'opsManagerCount',
  'trainerCount',
  'qaCount',
  'wfmSupportCount',
  'trainingHc',
  'supportHc',
  'plannedPaidProductionHours',
  'actualPaidProductionHours',
  'plannedNewHireTrainingHours',
  'actualTrainingHours',
  'billingRate',
]

const REQUIRED_STAFFING_FIELDS: StaffingFieldKey[] = [
  'requiredHc',
  'activeProdHc',
  'forecastVolume',
  'actualOfferedVolume',
  'actualHandledVolume',
]

function scoreHeaderAgainstAliases(headerNorm: string, headerCompact: string, aliases: string[]): number {
  let best = 0
  for (const a of aliases) {
    const an = normalizeHeaderLabel(a)
    const ac = compactHeaderKey(a)
    if (!an) continue
    if (headerNorm === an) best = Math.max(best, 120 + an.length)
    else if (headerCompact === ac && ac.length >= 4) best = Math.max(best, 110)
    else if (headerNorm.includes(an) && an.length >= 6) best = Math.max(best, 70 + an.length)
    else if (an.length >= 4 && headerNorm.includes(an)) best = Math.max(best, 45 + an.length)
    else if (headerNorm.startsWith(an) && an.length >= 5) best = Math.max(best, 38 + an.length)
  }
  return best
}

function headerLooksLikeWeekStartDate(hn: string): boolean {
  return hn.includes('week') && hn.includes('start') && (hn.includes('date') || hn.includes('commencing'))
}

export function pickBestColumnForField(
  snap: SheetSnapshot,
  field: StaffingFieldKey,
  usedKeys: Set<string>,
): { key: string; score: number } | null {
  const aliases = FIELD_ALIASES[field]
  let best: { key: string; score: number } | null = null
  for (const col of snap.columns) {
    if (usedKeys.has(col.key)) continue
    const h = col.header
    const hn = normalizeHeaderLabel(h)
    const hc = compactHeaderKey(h)
    if (field === 'week' && headerLooksLikeWeekStartDate(hn)) continue
    const sc = scoreHeaderAgainstAliases(hn, hc, aliases)
    if (sc > 0 && (!best || sc > best.score)) best = { key: col.key, score: sc }
  }
  return best && best.score >= 38 ? best : null
}

export function mapStaffingSheet(sheetName: string, snap: SheetSnapshot): StaffingColumnMap {
  const used = new Set<string>()
  const byField: Partial<Record<StaffingFieldKey, string>> = {}
  const warnings: string[] = []

  for (const f of FIELD_MAP_ORDER) {
    const hit = pickBestColumnForField(snap, f, used)
    if (hit) {
      byField[f] = hit.key
      used.add(hit.key)
    }
  }

  const missingRequired = REQUIRED_STAFFING_FIELDS.filter((f) => !byField[f])
  if (missingRequired.length) {
    warnings.push(
      `Sheet “${sheetName}” is missing or could not map: ${missingRequired.join(', ')}. Upload a template-aligned file or rename columns.`,
    )
  }

  return { sheetName, byField, missingRequired, warnings }
}

export function staffingSheetScore(snap: SheetSnapshot): number {
  const m = mapStaffingSheet(snap.name, snap)
  let s = 0
  for (const f of REQUIRED_STAFFING_FIELDS) {
    if (m.byField[f]) s += 25
  }
  for (const f of [
    'projectCode',
    'productionHours',
    'billingRate',
    'plannedShrinkPct',
    'actualShrinkPct',
    'plannedInOfficeShrinkPct',
    'actualInOfficeShrinkPct',
    'plannedOutOfficeShrinkPct',
    'actualOutOfficeShrinkPct',
    'plannedAttrition',
    'actualAttrition',
    'plannedTrainingAttrition',
    'actualTrainingAttrition',
    'plannedAht',
    'actualAht',
    'billingType',
    'days',
    'activeProdFte',
    'plannedNewHireClassHc',
  ] as StaffingFieldKey[]) {
    if (m.byField[f]) s += 5
  }
  return s
}

/** True when headers look like an operational staffing / capacity grid (not a slim rate card). */
function headersLookLikeStaffingGrid(headers: string[]): boolean {
  const joined = headers.join(' | ')
  const hasHc =
    joined.includes('headcount') ||
    joined.includes(' hc') ||
    joined.includes('fte') ||
    joined.includes('roster')
  const hasVol =
    joined.includes('volume') ||
    joined.includes('forecast') ||
    joined.includes('handled') ||
    joined.includes('offered') ||
    joined.includes('calls')
  const hasWeek = joined.includes('week') && (joined.includes('start') || joined.includes('date'))
  return Boolean((hasHc && hasVol) || (hasHc && hasWeek))
}

export function isLikelyRatesSheet(snap: SheetSnapshot): boolean {
  const headers = snap.columns.map((c) => normalizeHeaderLabel(c.header))
  if (headersLookLikeStaffingGrid(headers)) return false
  const hasRate = headers.some((h) => h.includes('rate') && !h.includes('corporate'))
  const hasClient = headers.some((h) => h.includes('client'))
  const hasBill = headers.some((h) => h.includes('billing'))
  return Boolean(hasRate && hasClient && hasBill)
}

export function isLikelyOwnersSheet(snap: SheetSnapshot): boolean {
  const headers = snap.columns.map((c) => normalizeHeaderLabel(c.header))
  const joined = headers.join('|')
  if (headersLookLikeStaffingGrid(headers)) return false
  const hasClient = headers.some((h) => h.includes('client'))
  const hasLob = headers.some((h) => h.includes('lob'))
  const hasStakeholderCols =
    joined.includes('wfm') || joined.includes('operations') || joined.includes('finance')
  return Boolean(hasClient && hasLob && hasStakeholderCols)
}

const STAFFING_TAB_HINTS = [
  'staffingplan',
  'staffing',
  'capacityplan',
  'capacity',
  'wfm',
  'wfmcapacity',
  'headcountplan',
  'volumecapacity',
  'campaignmap',
  'lobmap',
]

const RATES_TAB_HINTS = ['rates', 'ratecard', 'rate', 'pricing', 'billrate', 'commercial']
const OWNERS_TAB_HINTS = ['owners', 'ownership', 'raci', 'stakeholder']

export function tabHintStaffing(norm: string): boolean {
  return STAFFING_TAB_HINTS.some((h) => norm.includes(h) || norm === h)
}

export function tabHintRates(norm: string): boolean {
  return RATES_TAB_HINTS.some((h) => norm === h || norm.startsWith(h) || norm.includes(h))
}

export function tabHintOwners(norm: string): boolean {
  return OWNERS_TAB_HINTS.some((h) => norm === h || norm.includes(h))
}

/** Reference-only scenario tabs (not a generic “Forecast” workload sheet). */
export function tabHintForecastScenarios(norm: string): boolean {
  return (
    norm.includes('forecastscenario') ||
    norm.includes('forecastingscenario') ||
    (norm.includes('forecast') && norm.includes('scenario'))
  )
}

export function normalizeSheetTab(name: string): string {
  return normalizeTabNameForMatch(name)
}
