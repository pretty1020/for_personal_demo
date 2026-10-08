import { describe, expect, it } from 'vitest'
import {
  DOCUMENT_KEYS,
  LEGACY_DOCUMENT_KEYS,
  LOCAL_PREFERENCE_KEYS,
  SUMMARY_DOCUMENT_KEYS,
  fromDocumentPayload,
  isDocumentKey,
  toDocumentPayload,
} from './capacityDocumentKeys'

describe('document key split', () => {
  it('never treats a key as both database data and a local preference', () => {
    const stored = new Set<string>([...DOCUMENT_KEYS, ...LEGACY_DOCUMENT_KEYS])
    for (const key of LOCAL_PREFERENCE_KEYS) {
      expect(stored.has(key)).toBe(false)
    }
  })

  it('recognises stored keys, including superseded ones', () => {
    expect(isDocumentKey('wfp-planner-scenarios-v2')).toBe(true)
    expect(isDocumentKey('wfp-dbe-lines-v1')).toBe(true)
    expect(isDocumentKey('wfp-capacity-period-v2')).toBe(false)
    expect(isDocumentKey('wfp-auth-token')).toBe(false)
  })

  it('builds the Summary only from keys that are actually stored', () => {
    for (const key of SUMMARY_DOCUMENT_KEYS) {
      expect(isDocumentKey(key)).toBe(true)
    }
  })

  it('has no duplicate entries', () => {
    const all = [...DOCUMENT_KEYS, ...LEGACY_DOCUMENT_KEYS, ...LOCAL_PREFERENCE_KEYS]
    expect(new Set(all).size).toBe(all.length)
  })
})

describe('payload round trip', () => {
  const roundTrip = (raw: string) => fromDocumentPayload(toDocumentPayload(raw))

  it('keeps objects and arrays byte-identical', () => {
    expect(roundTrip('{"scenarios":[{"id":"a","fte":12.5}]}')).toBe(
      '{"scenarios":[{"id":"a","fte":12.5}]}',
    )
    expect(roundTrip('[1,2,3]')).toBe('[1,2,3]')
  })

  it('stores objects as real JSON so the Summary can read across planners', () => {
    expect(toDocumentPayload('{"a":1}')).toEqual({ a: 1 })
  })

  it('preserves plain text that is not JSON', () => {
    expect(roundTrip('monday')).toBe('monday')
  })

  it('preserves a quoted string instead of unwrapping it', () => {
    // JSON.parse('"hello"') is `hello`; storing that would drop the quotes on the way back.
    expect(roundTrip('"hello"')).toBe('"hello"')
  })

  it('preserves bare numbers and booleans as written', () => {
    expect(roundTrip('42')).toBe('42')
    expect(roundTrip('true')).toBe('true')
  })

  it('treats a missing payload as "remove this key"', () => {
    expect(fromDocumentPayload(null)).toBeNull()
    expect(fromDocumentPayload(undefined)).toBeNull()
  })
})
