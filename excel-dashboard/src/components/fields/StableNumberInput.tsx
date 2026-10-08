import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { isIncompleteNumericDraft, sanitizeNumericDraft } from '../../planner/capacityMatrixInput'

export type StableNumberInputProps = {
  value: string | number | null | undefined
  onChange?: (raw: string) => void
  onCommit?: (parsed: number | null, raw: string) => void
  className?: string
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  placeholder?: string
  'aria-label'?: string
  name?: string
  id?: string
  allowEmpty?: boolean
  allowNegative?: boolean
  invalid?: boolean
  title?: string
}

function toDisplay(value: string | number | null | undefined): string {
  if (value == null) return ''
  return String(value)
}

export function parseStableNumber(
  raw: string,
  options?: { min?: number; max?: number; allowNegative?: boolean },
): number | null {
  const sanitized = sanitizeNumericDraft(raw)
  if (sanitized === '' || isIncompleteNumericDraft(sanitized)) return null
  const parsed = Number(sanitized)
  if (!Number.isFinite(parsed)) return null
  if (!options?.allowNegative && parsed < 0) return null
  let next = parsed
  if (options?.min != null && next < options.min) next = options.min
  if (options?.max != null && next > options.max) next = options.max
  return next
}

/** Text numeric field that keeps in-progress typing (empty, decimals) and does not use browser steppers. */
export function StableNumberInput({
  value,
  onChange,
  onCommit,
  className,
  min,
  max,
  step,
  disabled,
  placeholder,
  name,
  id,
  allowEmpty = true,
  allowNegative = false,
  invalid = false,
  title,
  'aria-label': ariaLabel,
}: StableNumberInputProps) {
  const focusedRef = useRef(false)
  const [draft, setDraft] = useState(() => toDisplay(value))

  useEffect(() => {
    if (focusedRef.current) return
    setDraft(toDisplay(value))
  }, [value])

  const applyDraft = (raw: string) => {
    let next = sanitizeNumericDraft(raw)
    if (!allowNegative && next.startsWith('-')) next = next.slice(1)
    setDraft(next)
    onChange?.(next)
  }

  const commit = () => {
    const trimmed = draft.trim()
    if (trimmed === '') {
      if (!allowEmpty) {
        setDraft(toDisplay(value))
        return
      }
      onCommit?.(null, '')
      return
    }
    const parsed = parseStableNumber(draft, { min, max, allowNegative })
    if (parsed == null) {
      setDraft(toDisplay(value))
      return
    }
    const asText = String(parsed)
    setDraft(asText)
    onCommit?.(parsed, asText)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
      event.currentTarget.blur()
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      focusedRef.current = false
      setDraft(toDisplay(value))
      event.currentTarget.blur()
    }
  }

  return (
    <input
      className={`cap-stable-num${invalid ? ' cap-stable-num--invalid' : ''}${className ? ` ${className}` : ''}`}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      name={name}
      id={id}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      disabled={disabled}
      value={draft}
      aria-label={ariaLabel}
      aria-invalid={invalid}
      title={title ?? 'Type a number · Enter commits · Esc cancels'}
      onFocus={(event) => {
        focusedRef.current = true
        event.currentTarget.select()
      }}
      onChange={(event) => applyDraft(event.target.value)}
      onBlur={() => {
        focusedRef.current = false
        commit()
      }}
      onKeyDown={onKeyDown}
    />
  )
}
