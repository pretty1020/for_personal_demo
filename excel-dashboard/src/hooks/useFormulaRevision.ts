import { useEffect, useState } from 'react'
import { FORMULA_STORAGE_KEY } from '../planner/formulas/formulaRegistry'

/** Bumps when an admin saves formula overrides so live pages recompute. */
export function useFormulaRevision(): number {
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1)
    const onStorage = (event: StorageEvent) => {
      if (event.key && event.key !== FORMULA_STORAGE_KEY) return
      refresh()
    }
    window.addEventListener('formula-registry-changed', refresh)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('formula-registry-changed', refresh)
      window.removeEventListener('storage', onStorage)
    }
  }, [])
  return revision
}
