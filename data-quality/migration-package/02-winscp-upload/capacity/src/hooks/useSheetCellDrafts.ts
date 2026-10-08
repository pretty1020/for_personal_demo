import { useCallback, useState } from 'react'

export function useSheetCellDrafts() {
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  const getValue = useCallback(
    (draftId: string, committed: string) => (draftId in drafts ? drafts[draftId]! : committed),
    [drafts],
  )

  const setDraft = useCallback((draftId: string, value: string) => {
    setDrafts((prev) => ({ ...prev, [draftId]: value }))
  }, [])

  const commitDraft = useCallback(
    (draftId: string, committed: string, onCommit: (value: string) => void) => {
      const raw = draftId in drafts ? drafts[draftId]! : committed
      onCommit(raw)
      setDrafts((prev) => {
        if (!(draftId in prev)) return prev
        const next = { ...prev }
        delete next[draftId]
        return next
      })
    },
    [drafts],
  )

  const clearDraft = useCallback((draftId: string) => {
    setDrafts((prev) => {
      if (!(draftId in prev)) return prev
      const next = { ...prev }
      delete next[draftId]
      return next
    })
  }, [])

  return { getValue, setDraft, commitDraft, clearDraft }
}
