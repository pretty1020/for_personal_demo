import type { KeyboardEvent } from 'react'

type Props = {
  draftId: string
  value: string
  ariaLabel?: string
  onDraftChange: (draftId: string, value: string) => void
  onCommit: (draftId: string) => void
  onClear: (draftId: string) => void
}

/** DBE sheet cell — drafts while typing, commits on blur / Enter (avoids laggy saves). */
export function DbeSheetCellInput({
  draftId,
  value,
  ariaLabel,
  onDraftChange,
  onCommit,
  onClear,
}: Props) {
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      onCommit(draftId)
      event.currentTarget.blur()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
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
      title="Type a number · Enter to save · Esc to cancel"
      value={value}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => {
        const next = event.target.value
        // No minus sign: every DBE metric is non-negative, and the save step used to
        // reject negatives by silently reverting the cell with no explanation.
        if (next !== '' && !/^\d*\.?\d*$/.test(next)) return
        onDraftChange(draftId, next)
      }}
      onBlur={() => onCommit(draftId)}
      onKeyDown={handleKeyDown}
    />
  )
}
