import { useRef, type KeyboardEvent } from 'react'

type Props = {
  draftId: string
  value: string
  min?: number
  max?: number
  step?: number
  onDraftChange: (draftId: string, value: string) => void
  /** Second arg is the live input text so Enter/Tab never commit a stale draft. */
  onCommit: (draftId: string, liveValue: string) => void
  onClear: (draftId: string) => void
  'aria-label'?: string
}

/**
 * Editable matrix cell — drafts while typing, commits on blur / Enter / Tab.
 * Uses text + decimal inputMode so intermediate edits (empty, partial decimals) stay usable.
 */
export function CapacityMatrixCellInput({
  draftId,
  value,
  min,
  max,
  step = 1,
  onDraftChange,
  onCommit,
  onClear,
  'aria-label': ariaLabel,
}: Props) {
  const skipBlurCommitRef = useRef(false)

  const commitLive = (liveValue: string) => {
    onDraftChange(draftId, liveValue)
    onCommit(draftId, liveValue)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      commitLive(event.currentTarget.value)
      // Blur would otherwise commit again — harmless, but skip to avoid extra work.
      skipBlurCommitRef.current = true
      event.currentTarget.blur()
      return
    }
    if (event.key === 'Tab') {
      // Commit before focus moves; do not preventDefault so Tab still advances.
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
      className="cap-ledger-matrix__input"
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      aria-label={ariaLabel}
      placeholder="—"
      title="Type a number · Enter or Tab to save · Esc to cancel"
      data-draft-id={draftId}
      data-min={min}
      data-max={max}
      data-step={step}
      value={value}
      onFocus={(event) => {
        const el = event.currentTarget
        // Seed draft immediately so the first commit never reads a missing draft key.
        onDraftChange(draftId, el.value)
        el.select()
      }}
      onChange={(event) => {
        const next = event.target.value
        // Allow empty, digits, one decimal point, and optional leading minus while typing
        if (next !== '' && !/^-?\d*\.?\d*$/.test(next)) return
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
