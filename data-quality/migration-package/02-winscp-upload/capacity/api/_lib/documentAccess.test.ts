import { describe, expect, it } from 'vitest'
import {
  DOCUMENT_KEYS,
  canReadAllDocuments,
  canWriteDbeDocuments,
  isDbeDocumentKey,
} from './documentAccess'

describe('canReadAllDocuments', () => {
  it('lets manager and above read every planner’s documents', () => {
    for (const level of ['manager', 'director', 'vp', 'admin']) {
      expect(canReadAllDocuments(level)).toBe(true)
    }
  })

  it('keeps planners, schedulers and analysts to their own documents', () => {
    for (const level of ['cap_planner', 'scheduler', 'analyst']) {
      expect(canReadAllDocuments(level)).toBe(false)
    }
  })

  it('accepts the legacy names for renamed roles', () => {
    // 'executive' became 'vp' and can still see everything.
    expect(canReadAllDocuments('executive')).toBe(true)
    // 'scheduler' became 'cap_planner' and still cannot.
    expect(canReadAllDocuments('scheduler')).toBe(false)
  })

  it('denies unknown, empty and missing access levels', () => {
    for (const level of ['', '   ', 'guest', null, undefined]) {
      expect(canReadAllDocuments(level)).toBe(false)
    }
  })

  it('ignores casing and padding from stored sessions', () => {
    expect(canReadAllDocuments('  Manager ')).toBe(true)
    expect(canReadAllDocuments('ADMIN')).toBe(true)
  })
})

describe('DOCUMENT_KEYS', () => {
  it('stores planning data', () => {
    for (const key of [
      'wfp-planner-scenarios-v2',
      'wfp-dbe-lines-v3',
      'wfp-capacity-plan-overrides-v1',
      'wfp-roster-store-v1',
      'wfp-capacity-formula-overrides-v1',
      'wfp-capacity-production-fte-unlock-v1',
    ]) {
      expect(DOCUMENT_KEYS.has(key)).toBe(true)
    }
  })

  it('refuses the retired scheduling keys', () => {
    for (const key of [
      'wfp-scheduling-v1',
      'wfp-scheduling-templates-v1',
      'wfp-scheduling-artifacts-v1',
    ]) {
      expect(DOCUMENT_KEYS.has(key)).toBe(false)
    }
  })

  it('refuses view preferences, so one person’s layout cannot follow everyone else', () => {
    for (const key of [
      'wfp-planner-active-v2',
      'wfp-capacity-metric-order-v1',
      'wfp-capacity-metric-hidden-v1',
      'wfp-capacity-period-v2',
      'wfp-dbe-period-v1',
    ]) {
      expect(DOCUMENT_KEYS.has(key)).toBe(false)
    }
  })

  it('refuses session and credential keys', () => {
    for (const key of ['wfp-movate-session-v2', 'wfp-movate-users-v1', 'wfp-auth-token']) {
      expect(DOCUMENT_KEYS.has(key)).toBe(false)
    }
  })

  it('still accepts superseded keys so an old browser can hand its data over', () => {
    for (const key of ['wfp-planner-scenarios-v1', 'wfp-dbe-lines-v2', 'wfp-dbe-lines-v1']) {
      expect(DOCUMENT_KEYS.has(key)).toBe(true)
    }
  })
})

describe('DBE writes', () => {
  it('lets manager and above add or change clients and LOBs', () => {
    for (const level of ['manager', 'director', 'vp', 'admin', 'executive']) {
      expect(canWriteDbeDocuments(level)).toBe(true)
    }
  })

  it('refuses planners and analysts, even on a document they own', () => {
    for (const level of ['cap_planner', 'scheduler', 'analyst', '', null, undefined]) {
      expect(canWriteDbeDocuments(level)).toBe(false)
    }
  })

  it('recognises every DBE key, current and superseded', () => {
    for (const key of ['wfp-dbe-lines-v3', 'wfp-dbe-lines-v2', 'wfp-dbe-lines-v1']) {
      expect(isDbeDocumentKey(key)).toBe(true)
    }
  })

  it('leaves the rest of the planning keys open to their owner', () => {
    for (const key of [
      'wfp-planner-scenarios-v2',
      'wfp-capacity-plan-overrides-v1',
      'wfp-roster-store-v1',
    ]) {
      expect(isDbeDocumentKey(key)).toBe(false)
    }
  })
})
