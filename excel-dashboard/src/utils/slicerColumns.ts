import type { SheetSnapshot } from '../types/dashboard'

export type SlicerRole = 'client' | 'project' | 'du' | 'location' | 'category1'

export type SlicerLayout = 'grid-2' | 'vertical' | 'compact'

export interface SlicerSpec {
  role: SlicerRole
  label: string
  /** Normalized comparison — longer / more specific aliases first within each role */
  aliases: string[]
  layout: SlicerLayout
}

export const SLICER_SPECS: SlicerSpec[] = [
  {
    role: 'client',
    label: 'Client Name',
    aliases: ['client name', 'client', 'customer name', 'customer', 'account name', 'account'],
    layout: 'grid-2',
  },
  {
    role: 'project',
    label: 'Client Code',
    // Prefer code/id over generic "project" to avoid matching date-like columns on ops tabs.
    // NOTE: do NOT include plain "project" here; it can accidentally map to non-code columns.
    aliases: ['client code', 'clientcode', 'project code', 'projectcode', 'project id', 'projectid'],
    layout: 'vertical',
  },
  {
    role: 'du',
    label: 'DU',
    aliases: ['du', 'delivery unit', 'd.u.', 'd u'],
    layout: 'compact',
  },
  {
    role: 'location',
    label: 'Location',
    aliases: ['location', 'loc', 'country', 'site', 'region'],
    layout: 'compact',
  },
  {
    role: 'category1',
    label: 'Category 1',
    aliases: ['category 1', 'category1', 'cat 1', 'category'],
    layout: 'compact',
  },
]

export function normalizeHeaderLabel(s: string): string {
  return s
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[_/]+/g, ' ')
    .trim()
}

/** Alphanumeric only — for fuzzy header match */
export function compactHeaderKey(s: string): string {
  return normalizeHeaderLabel(s).replace(/[^a-z0-9]+/g, '')
}

function tokenSet(s: string): Set<string> {
  return new Set(
    normalizeHeaderLabel(s)
      .split(/\s+/)
      .map((w) => w.replace(/[^a-z0-9]/g, ''))
      .filter((w) => w.length >= 2),
  )
}

function tokenOverlapScore(headerNorm: string, alias: string): number {
  const ht = tokenSet(headerNorm)
  const words = normalizeHeaderLabel(alias)
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ''))
    .filter((w) => w.length >= 2)
  if (words.length === 0) return 0
  let hit = 0
  for (const w of words) {
    if (ht.has(w)) hit++
    else {
      for (const t of ht) {
        if (t.includes(w) || w.includes(t)) {
          hit += 0.75
          break
        }
      }
    }
  }
  return (hit / words.length) * 35
}

/**
 * Map dashboard slicer roles to column keys by matching sheet headers (Excel-style labels).
 * Each column is used at most once; roles are filled in list order.
 */
export function resolveSlicerColumnKeys(
  snapshot: SheetSnapshot,
): Partial<Record<SlicerRole, string>> {
  const out: Partial<Record<SlicerRole, string>> = {}
  const used = new Set<string>()

  for (const spec of SLICER_SPECS) {
    const aliases = [...spec.aliases].map(normalizeHeaderLabel).sort((a, b) => b.length - a.length)
    const aliasesCompact = aliases.map(compactHeaderKey).filter(Boolean)

    const scoreHeader = (col: (typeof snapshot.columns)[number]): number => {
      const headerNorm = normalizeHeaderLabel(col.header)
      const headerCompact = compactHeaderKey(col.header)
      let best = 0
      for (let i = 0; i < aliases.length; i++) {
        const a = aliases[i]!
        const ac = aliasesCompact[i]
        if (headerNorm === a) {
          best = Math.max(best, 100 + a.length)
          continue
        }
        if (ac && headerCompact === ac) {
          best = Math.max(best, 92 + a.length)
          continue
        }
        if (headerNorm === a.replace(/\s/g, '')) {
          best = Math.max(best, 88 + a.length)
          continue
        }
        if (a.length >= 4 && headerNorm.includes(a)) {
          best = Math.max(best, 42 + a.length)
          continue
        }
        if (a.length >= 3 && headerNorm.startsWith(a)) {
          best = Math.max(best, 24 + a.length)
          continue
        }
        if (a.length >= 3 && headerNorm.endsWith(` ${a}`)) {
          best = Math.max(best, 26 + a.length)
          continue
        }
        best = Math.max(best, tokenOverlapScore(headerNorm, a))
      }
      if (best < 15 && col.type !== 'number') {
        for (const a of aliases) {
          if (a.length === 3 && headerNorm.includes(a)) best = Math.max(best, 18)
        }
      }
      return best
    }

    let pick: { key: string; score: number } | null = null
    for (const col of snapshot.columns) {
      if (used.has(col.key)) continue
      const s = scoreHeader(col)
      if (s > 0 && (!pick || s > pick.score)) {
        pick = { key: col.key, score: s }
      }
    }
    if (pick) {
      out[spec.role] = pick.key
      used.add(pick.key)
    }
  }

  return out
}
