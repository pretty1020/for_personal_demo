import { describe, expect, it } from 'vitest'
import {
  applyClipboardGridToDrafts,
  cellDraftId,
  collectInvalidDraftMessages,
  finalizeCellDrafts,
  finalizeNumericDraft,
  mergePlannedOverridesWithDrafts,
  normalizeMetricInput,
  parseClipboardGrid,
  parseMetricDraft,
  sanitizeNumericDraft,
  storedValueFromDraft,
  toInputString,
} from './capacityMatrixInput'

describe('capacityMatrixInput', () => {
  it('sanitizes commas, spaces, and extra decimals while allowing in-progress typing', () => {
    expect(sanitizeNumericDraft('1,234')).toBe('1234')
    expect(sanitizeNumericDraft(' 12.5 ')).toBe('12.5')
    expect(sanitizeNumericDraft('12.3.4')).toBe('12.34')
    expect(sanitizeNumericDraft('-')).toBe('-')
    expect(sanitizeNumericDraft('12.')).toBe('12.')
    expect(sanitizeNumericDraft('abc')).toBe('')
  })

  it('treats blank as a clear, zero as a real value, and rejects negatives', () => {
    expect(parseMetricDraft('callVolume', '')).toEqual({ status: 'empty' })
    expect(parseMetricDraft('callVolume', '0')).toMatchObject({ status: 'ok', storedValue: 0, clamped: false })
    expect(parseMetricDraft('productionHc', '-1')).toMatchObject({ status: 'invalid' })
    expect(parseMetricDraft('occupancy', '12.')).toEqual({ status: 'incomplete' })
  })

  it('stores percents as fractions and caps occupancy at 99.9%', () => {
    const occupancy = parseMetricDraft('occupancy', '85')
    expect(occupancy).toMatchObject({ status: 'ok', storedValue: 0.85, clamped: false })
    const capped = parseMetricDraft('occupancy', '150')
    expect(capped).toMatchObject({ status: 'ok', storedValue: 0.999, clamped: true })
    expect(toInputString(0.85, { percent: true })).toBe('85')
  })

  it('caps shrinkage and rounds headcount', () => {
    expect(parseMetricDraft('shrinkage:ooo', '200')).toMatchObject({ status: 'ok', storedValue: 1.25, clamped: true })
    expect(parseMetricDraft('productionHc', '12.6')).toMatchObject({ status: 'ok', storedValue: 13 })
    expect(normalizeMetricInput('ahtSeconds', -40)).toBe(0)
    expect(normalizeMetricInput('callVolume', 12.2)).toBe(12)
  })

  it('clears planned overrides on blank drafts instead of writing zero', () => {
    const merged = mergePlannedOverridesWithDrafts(
      { '2026-08-16': { callVolume: 1000, shrinkageById: { ooo: 0.1 } } },
      {
        [cellDraftId('planned', '2026-08-16', 'callVolume')]: '',
        [cellDraftId('planned', '2026-08-16', 'shrinkage:ooo')]: '',
        [cellDraftId('planned', '2026-08-16', 'occupancy')]: '12.',
      },
    )
    expect(merged['2026-08-16']?.callVolume).toBeNull()
    expect(merged['2026-08-16']?.shrinkageById?.ooo).toBeUndefined()
    expect(merged['2026-08-16']?.occupancy).toBeUndefined()
    expect(storedValueFromDraft('callVolume', '')).toBeNull()
    expect(storedValueFromDraft('callVolume', '12.')).toBeUndefined()
  })

  it('parses Excel TSV paste and maps it across weeks and metrics', () => {
    const grid = parseClipboardGrid('10\t20\n30\t40\n')
    expect(grid).toEqual([
      ['10', '20'],
      ['30', '40'],
    ])
    const drafts = applyClipboardGridToDrafts(
      {},
      { kind: 'planned', week: '2026-08-16', metricId: 'callVolume' },
      ['2026-08-09', '2026-08-16', '2026-08-23'],
      ['ahtSeconds', 'callVolume', 'occupancy'],
      grid,
    )
    expect(drafts[cellDraftId('planned', '2026-08-16', 'callVolume')]).toBe('10')
    expect(drafts[cellDraftId('planned', '2026-08-23', 'callVolume')]).toBe('20')
    expect(drafts[cellDraftId('planned', '2026-08-16', 'occupancy')]).toBe('30')
    expect(drafts[cellDraftId('planned', '2026-08-23', 'occupancy')]).toBe('40')
  })

  it('reports invalid drafts without blocking empty cells', () => {
    const messages = collectInvalidDraftMessages({
      [cellDraftId('planned', '2026-08-16', 'callVolume')]: '',
      [cellDraftId('planned', '2026-08-23', 'productionHc')]: 'abc',
      [cellDraftId('actual', '2026-08-16', 'occupancy')]: '-',
    })
    expect(messages.some((message) => message.includes('Enter a number'))).toBe(true)
  })

  it('finalizes trailing decimals so Save can succeed on first click', () => {
    expect(finalizeNumericDraft('12.')).toBe('12')
    expect(finalizeNumericDraft('.')).toBe('')
    expect(finalizeNumericDraft('')).toBe('')
    const finalized = finalizeCellDrafts({
      [cellDraftId('planned', '2026-08-16', 'offRosterLoaHc')]: '3.',
      [cellDraftId('planned', '2026-08-16', 'shrinkage:ooo')]: '5.',
    })
    expect(finalized[cellDraftId('planned', '2026-08-16', 'offRosterLoaHc')]).toBe('3')
    expect(finalized[cellDraftId('planned', '2026-08-16', 'shrinkage:ooo')]).toBe('5')
    expect(collectInvalidDraftMessages(finalized)).toEqual([])
  })
})
