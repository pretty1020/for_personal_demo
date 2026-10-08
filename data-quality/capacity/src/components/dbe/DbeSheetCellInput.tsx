import { useRef, type KeyboardEvent } from 'react'

type Props = {
  draftId: string
  value: string
  ariaLabel?: string
  onDraftChange: (draftId: string, value: string) => void
  /** Second arg is live input text so Enter/Tab never commit a stale draft. */
  onCommit: (draftId: string, liveValue: string) => void
  onClear: (draftId: string) => void
}

/** DBE sheet cell — drafts while typing, commits on blur / Enter / Tab. */
export function DbeSheetCellInput({
  draftId,
  value,
  ariaLabel,
  onDraftChange,
  onCommit,
  onClear,
}: Props) {
  const skipBlurCommitRef = useRef(false)

  const commitLive = (liveValue: string) => {
    onDraftChange(draftId, liveValue)
    onCommit(draftId, liveValue)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitLive(event.currentTarget.value)
      skipBlurCommitRef.current = true
      event.currentTarget.blur()
      return
    }
    if (event.key === 'Tab') {
      commitLive(event.currentTarget.value)
      skipBlurCommitRef.current = true
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      skipBlurCommitRef.current = true
      onClear(draftId)
      event.currentTarget.blur()
    }
  }

  return (
    <input
      className="cap-dbe-sheet__input"
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      aria-label={ariaLabel}
      placeholder="—"
      title="Type a number · Enter or Tab to save · Esc to cancel"
      value={value}
      onFocus={(event) => {
        const el = event.currentTarget
        onDraftChange(draftId, el.value)
        el.select()
      }}
      onChange={(event) => {
        const next = event.target.value
        if (next !== '' && !/^\d*\.?\d*$/.test(next)) return
        onDraftChange(draftId, next)
      }}
      onBlur={(event) => {
        if (skipBlurCommitRef.current) {
          skipBlurCommitRef.current = false
          return
        }
        commitLive(event.currentTarget.value)
      }}
      onKeyDown={handleKeyDown}
    />
  )
}
