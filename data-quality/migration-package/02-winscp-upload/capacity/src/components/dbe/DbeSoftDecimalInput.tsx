import { useState, type KeyboardEvent } from 'react'

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
  title = 'Type a number · Enter or click away to save · Esc to cancel',
  className = 'cap-dbe-sheet__input',
  disabled = false,
}: Props) {
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? value

  const commit = () => {
    if (draft === null) return
    onChange(draft)
    setDraft(null)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
      event.currentTarget.blur()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
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
        // These fields are all non-negative, so a minus sign is simply not accepted
        // rather than being silently dropped when the value is saved.
        if (next !== '' && !/^\d*\.?\d*$/.test(next)) return
        setDraft(next)
      }}
      onBlur={commit}
      onKeyDown={handleKeyDown}
    />
  )
}
