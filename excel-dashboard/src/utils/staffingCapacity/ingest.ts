import type { ParsedWorkbookBundle, SheetSnapshot } from '../../types/dashboard'
import { tryCoerceDate } from '../inferTypes'
import {
  isLikelyOwnersSheet,
  isLikelyRatesSheet,
  mapStaffingSheet,
  normalizeSheetTab,
  staffingSheetScore,
  tabHintOwners,
  tabHintRates,
  tabHintStaffing,
  tabHintForecastScenarios,
} from './columnMap'
import { dominantMonthShortFromSundayWeekStart, formatWeekStartIso } from './calendarWeek'
import { enrichStaffingRow, manualRateKey, ownerJoinKey, pickRateForRow, strCell, toNum } from './leakage'
import type {
  ParsedOwnerRow,
  ParsedRateRow,
  StaffingColumnMap,
  StaffingFieldKey,
  StaffingIngestResult,
  StaffingPlanRow,
} from './types'

function pickCol(
  snap: SheetSnapshot,
  aliases: string[],
  used: Set<string>,
): string | null {
  const scored = snap.columns
    .filter((c) => !used.has(c.key))
    .map((c) => {
      const h = c.header.toLowerCase().replace(/\s+/g, ' ').trim()
      let s = 0
      for (const a of aliases) {
        if (h === a) s = Math.max(s, 100)
        else if (h.includes(a) && a.length >= 4) s = Math.max(s, 40 + a.length)
      }
      return { key: c.key, s }
    })
    .filter((x) => x.s >= 40)
    .sort((a, b) => b.s - a.s)[0]
  if (scored) used.add(scored.key)
  return scored?.key ?? null
}

function parseRatesFromSheet(sheetName: string, snap: SheetSnapshot): ParsedRateRow[] {
  const used = new Set<string>()
  const cClient = pickCol(snap, ['client', 'customer', 'account'], used)
  const cCamp = pickCol(snap, ['campaign', 'program', 'queue'], used)
  const cLob = pickCol(snap, ['lob', 'line of business'], used)
  const cBill = pickCol(snap, ['billing type', 'billing', 'bill type'], used)
  const cRate = pickCol(snap, ['rate', 'price', 'cpm', 'revenue rate', 'billing rate'], used)
  const cProj = pickCol(snap, ['project code', 'projectcode', 'project id', 'projectid'], used)
  const cCur = pickCol(snap, ['currency', 'ccy'], used)
  const cStart = pickCol(snap, ['effective start', 'start date', 'valid from'], used)
  const cEnd = pickCol(snap, ['effective end', 'end date', 'valid to'], used)
  if (!cClient || !cLob || !cBill || !cRate) return []

  const out: ParsedRateRow[] = []
  for (const row of snap.rows) {
    const client = strCell(row[cClient])
    const campaign = cCamp ? strCell(row[cCamp]) : ''
    const lob = strCell(row[cLob])
    const billingType = strCell(row[cBill])
    if (!client && !campaign && !lob) continue
    const rate = toNum(row[cRate])
    const currency = cCur ? strCell(row[cCur]) : ''
    const ds = cStart ? tryCoerceDate(row[cStart]) : null
    const de = cEnd ? tryCoerceDate(row[cEnd]) : null
    const projectCode = cProj ? strCell(row[cProj]) : ''
    out.push({
      projectCode,
      client,
      campaign,
      lob,
      billingType,
      rate,
      currency,
      effectiveStart: ds,
      effectiveEnd: de,
      sourceSheet: sheetName,
    })
  }
  return out
}

function parseOwnersFromSheet(sheetName: string, snap: SheetSnapshot): ParsedOwnerRow[] {
  const used = new Set<string>()
  const cClient = pickCol(snap, ['client'], used)
  const cCamp = pickCol(snap, ['campaign', 'program'], used)
  const cLob = pickCol(snap, ['lob', 'line of business'], used)
  const cOwner = pickCol(snap, ['owner', 'capacity owner', 'capacity lead'], used)
  const cOps = pickCol(snap, ['operations leader', 'ops leader', 'operations manager'], used)
  const cWfm = pickCol(snap, ['wfm lead', 'workforce', 'wfm'], used)
  const cFin = pickCol(snap, ['finance partner', 'finance'], used)
  if (!cClient || !cLob) return []

  const out: ParsedOwnerRow[] = []
  for (const row of snap.rows) {
    const client = strCell(row[cClient])
    const campaign = cCamp ? strCell(row[cCamp]) : ''
    const lob = strCell(row[cLob])
    if (!client && !campaign && !lob) continue
    out.push({
      client,
      campaign,
      lob,
      owner: cOwner ? strCell(row[cOwner]) : '',
      operationsLeader: cOps ? strCell(row[cOps]) : '',
      wfmLead: cWfm ? strCell(row[cWfm]) : '',
      financePartner: cFin ? strCell(row[cFin]) : '',
      sourceSheet: sheetName,
    })
  }
  return out
}

function readRowField(row: Record<string, unknown>, key: string | undefined): unknown {
  if (!key) return null
  return row[key]
}

function extractPlanRows(sheetName: string, snap: SheetSnapshot, cmap: StaffingColumnMap): StaffingPlanRow[] {
  const { byField } = cmap
  const rows: StaffingPlanRow[] = []

  const g = (f: StaffingFieldKey) => byField[f]

  for (const row of snap.rows) {
    const client = strCell(readRowField(row, g('client')))
    const campaign = strCell(readRowField(row, g('campaign')))
    const lob = strCell(readRowField(row, g('lob')))
    const projectCode = strCell(readRowField(row, g('projectCode')))
    const hasDims = Boolean(client || campaign || lob || projectCode)
    const hasNums =
      toNum(readRowField(row, g('requiredHc'))) != null ||
      toNum(readRowField(row, g('activeProdHc'))) != null ||
      toNum(readRowField(row, g('forecastVolume'))) != null
    if (!hasDims && !hasNums) continue

    const weekCol = g('weekStartDate') ?? g('week')
    const weekRaw = readRowField(row, weekCol)
    const weekStartDate = formatWeekStartIso(weekRaw) || strCell(weekRaw)
    const dominantMonth = dominantMonthShortFromSundayWeekStart(weekStartDate)
    const sheetMonth = strCell(readRowField(row, g('month')))

    rows.push({
      sourceSheet: sheetName,
      fy: strCell(readRowField(row, g('fy'))),
      month: dominantMonth ?? sheetMonth,
      week: strCell(readRowField(row, g('week'))),
      weekStartDate,
      projectCode: strCell(readRowField(row, g('projectCode'))),
      client,
      campaign,
      lob,
      location: strCell(readRowField(row, g('location'))),
      owner: strCell(readRowField(row, g('owner'))),
      requiredHc: toNum(readRowField(row, g('requiredHc'))),
      activeProdHc: toNum(readRowField(row, g('activeProdHc'))),
      activeProdFte: toNum(readRowField(row, g('activeProdFte'))),
      forecastVolume: toNum(readRowField(row, g('forecastVolume'))),
      actualOfferedVolume: toNum(readRowField(row, g('actualOfferedVolume'))),
      actualHandledVolume: toNum(readRowField(row, g('actualHandledVolume'))),
      plannedShrinkPct: toNum(readRowField(row, g('plannedShrinkPct'))),
      actualShrinkPct: toNum(readRowField(row, g('actualShrinkPct'))),
      plannedInOfficeShrinkPct: toNum(readRowField(row, g('plannedInOfficeShrinkPct'))),
      actualInOfficeShrinkPct: toNum(readRowField(row, g('actualInOfficeShrinkPct'))),
      plannedOutOfficeShrinkPct: toNum(readRowField(row, g('plannedOutOfficeShrinkPct'))),
      actualOutOfficeShrinkPct: toNum(readRowField(row, g('actualOutOfficeShrinkPct'))),
      plannedAttrition: toNum(readRowField(row, g('plannedAttrition'))),
      actualAttrition: toNum(readRowField(row, g('actualAttrition'))),
      plannedTrainingAttrition: toNum(readRowField(row, g('plannedTrainingAttrition'))),
      actualTrainingAttrition: toNum(readRowField(row, g('actualTrainingAttrition'))),
      cappedAht: toNum(readRowField(row, g('cappedAht'))),
      plannedAht: toNum(readRowField(row, g('plannedAht'))),
      actualAht: toNum(readRowField(row, g('actualAht'))),
      billingType: strCell(readRowField(row, g('billingType'))),
      productionHours: toNum(readRowField(row, g('productionHours'))),
      days: toNum(readRowField(row, g('days'))),
      billingRate: toNum(readRowField(row, g('billingRate'))),
      rate: null,
      currency: null,
      plannedNewHireClassHc: toNum(readRowField(row, g('plannedNewHireClassHc'))),
      newHireCount: toNum(readRowField(row, g('newHireCount'))),
      trainingCount: toNum(readRowField(row, g('trainingCount'))),
      graduateCount: toNum(readRowField(row, g('graduateCount'))),
      tlCount: toNum(readRowField(row, g('tlCount'))),
      opsManagerCount: toNum(readRowField(row, g('opsManagerCount'))),
      trainerCount: toNum(readRowField(row, g('trainerCount'))),
      qaCount: toNum(readRowField(row, g('qaCount'))),
      wfmSupportCount: toNum(readRowField(row, g('wfmSupportCount'))),
      trainingHc: toNum(readRowField(row, g('trainingHc'))),
      supportHc: toNum(readRowField(row, g('supportHc'))),
      plannedPaidProductionHours: toNum(readRowField(row, g('plannedPaidProductionHours'))),
      actualPaidProductionHours: toNum(readRowField(row, g('actualPaidProductionHours'))),
      plannedNewHireTrainingHours: toNum(readRowField(row, g('plannedNewHireTrainingHours'))),
      actualTrainingHours: toNum(readRowField(row, g('actualTrainingHours'))),
    })
  }
  return rows
}

export function applyRateAndOwnerLookup(
  rows: StaffingPlanRow[],
  rates: ParsedRateRow[],
  owners: ParsedOwnerRow[],
): StaffingPlanRow[] {
  const ownerMap = new Map<string, ParsedOwnerRow>()
  for (const o of owners) {
    ownerMap.set(ownerJoinKey(o.client, o.campaign, o.lob), o)
  }

  return rows.map((r) => {
    const ws = r.weekStartDate ? tryCoerceDate(r.weekStartDate) : null
    const { rate, currency } = pickRateForRow(rates, r, ws)
    const ok = ownerMap.get(ownerJoinKey(r.client, r.campaign, r.lob))
    let owner = r.owner
    if (!owner && ok?.owner) owner = ok.owner
    return { ...r, owner, rate, currency }
  })
}

export function ingestStaffingCapacityWorkbook(bundle: ParsedWorkbookBundle): StaffingIngestResult {
  const errors: string[] = []
  const warnings: string[] = []
  const { sheetNames, snapshots, fileName } = bundle

  const ratesSheetCandidates: string[] = []
  const ownersSheetCandidates: string[] = []
  const staffingCandidates: string[] = []

  for (const name of sheetNames) {
    const snap = snapshots[name]
    if (!snap) continue
    const norm = normalizeSheetTab(name)
    const staffScore = staffingSheetScore(snap)
    const forecastScenario = tabHintForecastScenarios(norm)
    const likelyRates = tabHintRates(norm) || isLikelyRatesSheet(snap)
    const likelyOwners = tabHintOwners(norm) || isLikelyOwnersSheet(snap)
    /* Prefer staffing when columns look like a capacity grid; otherwise rate/owner heuristics
       can steal sheets that have Client + Billing Type + Billing Rate. */
    if (forecastScenario && staffScore < 40) {
      /* Reference-only scenario tab */
    } else if (tabHintStaffing(norm) || staffScore >= 50) {
      staffingCandidates.push(name)
    } else if (likelyOwners && staffScore < 40) {
      ownersSheetCandidates.push(name)
    } else if (likelyRates && staffScore < 40) {
      ratesSheetCandidates.push(name)
    } else if (staffScore >= 35) {
      staffingCandidates.push(name)
    } else if (likelyOwners) {
      ownersSheetCandidates.push(name)
    } else if (likelyRates) {
      ratesSheetCandidates.push(name)
    }
  }

  if (!staffingCandidates.length) {
    let best: { name: string; score: number } | null = null
    for (const name of sheetNames) {
      const snap = snapshots[name]
      if (!snap) continue
      const norm = normalizeSheetTab(name)
      if (tabHintForecastScenarios(norm) && staffingSheetScore(snap) < 40) continue
      const sc = staffingSheetScore(snap)
      if (!best || sc > best.score) best = { name, score: sc }
    }
    if (best && best.score >= 35) staffingCandidates.push(best.name)
  }

  const ratesSheetUsed =
    ratesSheetCandidates.find((n) => tabHintRates(normalizeSheetTab(n))) ??
    ratesSheetCandidates.find((n) => isLikelyRatesSheet(snapshots[n]!)) ??
    ratesSheetCandidates[0] ??
    null

  const ownersSheetUsed =
    ownersSheetCandidates.find((n) => tabHintOwners(normalizeSheetTab(n))) ??
    ownersSheetCandidates.find((n) => isLikelyOwnersSheet(snapshots[n]!)) ??
    ownersSheetCandidates[0] ??
    null

  let rates: ParsedRateRow[] = []
  if (ratesSheetUsed && snapshots[ratesSheetUsed]) {
    rates = parseRatesFromSheet(ratesSheetUsed, snapshots[ratesSheetUsed]!)
  }

  let owners: ParsedOwnerRow[] = []
  if (ownersSheetUsed && snapshots[ownersSheetUsed]) {
    owners = parseOwnersFromSheet(ownersSheetUsed, snapshots[ownersSheetUsed]!)
  }

  const columnMaps: StaffingColumnMap[] = []
  const planRows: StaffingPlanRow[] = []

  for (const name of staffingCandidates) {
    const snap = snapshots[name]
    if (!snap) continue
    const cmap = mapStaffingSheet(name, snap)
    columnMaps.push(cmap)
    warnings.push(...cmap.warnings)
    if (cmap.missingRequired.length) {
      warnings.push(
        `Skipping “${name}” until required columns are mapped: ${cmap.missingRequired.join(', ')}.`,
      )
      continue
    }
    planRows.push(...extractPlanRows(name, snap, cmap))
  }

  if (!staffingCandidates.length) {
    errors.push(
      'No workbook tab looks like a staffing / capacity plan. Add a sheet named like “Staffing Plan” or align columns to the sample template.',
    )
  }

  if (!planRows.length && !errors.length) {
    errors.push(
      'No usable staffing rows: every candidate sheet failed required column mapping, or tables are empty. Use Download Sample Data as a guide.',
    )
  }

  const withLookups = applyRateAndOwnerLookup(planRows, rates, owners)
  const ratesFound = rates.length > 0
  if (!ratesFound && planRows.length) {
    warnings.push(
      'Rates were not found. Upload a rate card tab to calculate revenue leakage.',
    )
  }

  const enrichedRows = withLookups.map((r) => enrichStaffingRow(r))

  return {
    planRows: withLookups,
    enrichedRows,
    rates,
    owners,
    staffingSheetsUsed: [...staffingCandidates],
    ratesSheetUsed,
    ownersSheetUsed,
    columnMaps,
    errors,
    warnings: [...new Set(warnings)],
    ratesFound,
    snapshots,
    sheetNames,
    fileName,
  }
}

export function mergeManualRates(rows: StaffingPlanRow[], manual: Map<string, number>): StaffingPlanRow[] {
  return rows.map((r) => {
    const m = manual.get(manualRateKey(r))
    if (m != null && Number.isFinite(m)) {
      return { ...r, billingRate: m }
    }
    return r
  })
}
