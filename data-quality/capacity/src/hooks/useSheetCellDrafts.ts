import { useCallback, useRef, useState } from 'react'

export function useSheetCellDrafts() {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const draftsRef = useRef(drafts)
  draftsRef.current = drafts

  const getValue = useCallback(
    (draftId: string, committed: string) => (draftId in drafts ? drafts[draftId]! : committed),
    [drafts],
  )

  const setDraft = useCallback((draftId: string, value: string) => {
    setDrafts((prev) => ({ ...prev, [draftId]: value }))
  }, [])

  const commitDraft = useCallback(
    (draftId: string, committed: string, onCommit: (value: string) => void, liveValue?: string) => {
      const raw =
        liveValue !== undefined ? liveValue : draftsRef.current[draftId] ?? committed
      onCommit(raw)
      setDrafts((prev) => {
        if (!(draftId in prev)) return prev
        const next = { ...prev }
        delete next[draftId]
        return next
      })
    },
    [],
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
