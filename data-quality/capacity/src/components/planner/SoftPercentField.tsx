import { useEffect, useState } from 'react'
import { formatPercentInput, parsePercentInput } from '../../planner/capacityImportWeek'
import { clampWithNotice, withPercentLabel } from './fieldRange'

type SoftPercentFieldProps = {
  label: string
  /** Stored rate 0–1, or null when unset. */
  value: number | null
  onChange: (rate: number | null) => void
  placeholder?: string
  disabled?: boolean
  min?: number
  max?: number
  hint?: string
}

/**
 * Nullable percent editor for optional overrides (shrinkage categories, stage attrition).
 * Empty clears the override; value shown as 0–100 with a % suffix.
 */
export function SoftPercentField({
  label,
  value,
  onChange,
  placeholder = 'e.g. 8.5',
  disabled = false,
  min = 0,
  max = 1,
  hint,
}: SoftPercentFieldProps) {
  const [text, setText] = useState(value != null ? formatPercentInput(value) : '')
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    setText(value != null ? formatPercentInput(value) : '')
  }, [value])

  const commit = (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) {
      setText('')
      setNotice(null)
      onChange(null)
      return
    }
    const parsed = parsePercentInput(trimmed)
    if (parsed == null) {
      setText(value != null ? formatPercentInput(value) : '')
      setNotice(null)
      return
    }
    const { value: next, notice: rangeNotice } = clampWithNotice(parsed, min, max, true)
    setText(formatPercentInput(next))
    setNotice(rangeNotice)
    onChange(next)
  }

  return (
    <label className={`saas-field cap-soft-percent${disabled ? ' is-disabled' : ''}`}>
      <span className="saas-field__label">{withPercentLabel(label, true)}</span>
      <span className="cap-field__control cap-field__control--percent">
        <input
          type="text"
          inputMode="decimal"
          className="cap-field__input"
          value={text}
          placeholder={placeholder}
          disabled={disabled}
          title="Enter a percent from 0 to 100 (for example 8.5). Leave blank to use the default. Enter to save."
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setText(event.target.value)}
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit(text)
              event.currentTarget.blur()
            }
            if (event.key === 'Escape') {
              setText(value != null ? formatPercentInput(value) : '')
              event.currentTarget.blur()
            }
          }}
        />
        <span className="cap-field__suffix" aria-hidden="true">
          %
        </span>
      </span>
      {notice ? (
        <span className="cap-field__notice" role="status">
          {notice}
        </span>
      ) : null}
      {hint ? <span className="cap-field__hint">{hint}</span> : null}
    </label>
  )
}
