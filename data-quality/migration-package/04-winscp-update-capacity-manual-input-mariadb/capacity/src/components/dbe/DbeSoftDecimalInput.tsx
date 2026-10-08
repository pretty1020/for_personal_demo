import { useRef, useState, type KeyboardEvent } from 'react'

type Props = {
  /** Committed text. Pass '' to show the placeholder (an inherited default). */
  value: string
  onChange: (raw: string) => void
  ariaLabel: string
  placeholder?: string
  title?: string
  className?: string
  disabled?: boolean
}

/**
 * Number cell that keeps what you type until you leave the field.
 *
 * The committed value is a number, so echoing it back on every keystroke would
 * erase a trailing decimal point the moment it is typed — "12." parses to 12 and
 * re-renders as "12", turning 12.5 into 125. Holding a local draft lets partial
 * input like "12." or "0." survive until blur or Enter.
 */
export function DbeSoftDecimalInput({
  value,
  onChange,
  ariaLabel,
  placeholder = '0',
  title = 'Type a number · Enter or Tab to save · Esc to cancel',
  className = 'cap-dbe-sheet__input',
  disabled = false,
}: Props) {
  const [draft, setDraft] = useState<string | null>(null)
  const skipBlurCommitRef = useRef(false)
  const text = draft ?? value

  const commit = (liveValue: string) => {
    if (draft === null && liveValue === value) return
    onChange(liveValue)
    setDraft(null)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit(event.currentTarget.value)
      skipBlurCommitRef.current = true
      event.currentTarget.blur()
      return
    }
    if (event.key === 'Tab') {
      commit(event.currentTarget.value)
      skipBlurCommitRef.current = true
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      skipBlurCommitRef.current = true
      setDraft(null)
      event.currentTarget.blur()
    }
  }

  return (
    <input
      className={className}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      disabled={disabled}
      value={text}
      placeholder={placeholder}
      title={title}
      aria-label={ariaLabel}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => {
        const next = event.target.value
        if (next !== '' && !/^\d*\.?\d*$/.test(next)) return
        setDraft(next)
      }}
      onBlur={(event) => {
        if (skipBlurCommitRef.current) {
          skipBlurCommitRef.current = false
          return
        }
        commit(event.currentTarget.value)
      }}
      onKeyDown={handleKeyDown}
    />
  )
}
