import type { SheetSnapshot } from '../types/dashboard'
import { normalizeHeaderLabel } from './slicerColumns'

/**
 * Find the column on `target` that corresponds to `sourceKey` on `source`
 * (same sanitized header label, or same stable key if present on both).
 */
export function mapSourceColumnKeyToTarget(
  sourceKey: string,
  source: SheetSnapshot,
  target: SheetSnapshot,
): string | undefined {
  if (source === target) return sourceKey
  if (target.columns.some((c) => c.key === sourceKey)) return sourceKey

  const srcCol = source.columns.find((c) => c.key === sourceKey)
  if (!srcCol) return undefined

  const nh = normalizeHeaderLabel(srcCol.header)
  return target.columns.find((c) => normalizeHeaderLabel(c.header) === nh)?.key
}
