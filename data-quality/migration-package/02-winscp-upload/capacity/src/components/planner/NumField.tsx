import { useEffect, useState } from 'react'
import { HelpTip } from './HelpTip'
import { formatPercentInput, parsePercentInput } from '../../planner/capacityImportWeek'
import { clampWithNotice, withPercentLabel } from './fieldRange'

type NumFieldProps = {
  label: string
  fieldKey?: string
  help?: string
  value: number
  onChange: (v: number) => void
  step?: number
  min?: number
  max?: number
  /** When true, value is stored 0–1 but shown/edited as 0–100. */
  percent?: boolean
  placeholder?: string
  disabled?: boolean
  /** Short hint under the field (e.g. “Enter to save”). */
  hint?: string
}

function displayValue(value: number, percent?: boolean): string {
  if (!Number.isFinite(value)) return ''
  if (percent) return formatPercentInput(value)
  const rounded = Math.round(value * 1000) / 1000
  return String(rounded)
}

export function NumField({
  label,
  help,
  value,
  onChange,
  // `step` is accepted for call-site compatibility but unused: the control is a text
  // input, where the attribute has no effect. Range is enforced by min/max on commit.
  min,
  max,
  percent = false,
  placeholder,
  disabled = false,
  hint,
}: NumFieldProps) {
  const [text, setText] = useState(displayValue(value, percent))
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    setText(displayValue(value, percent))
  }, [value, percent])

  // A percent is always 0–100 unless the caller narrows it. parsePercentInput no
  // longer clamps, so without these defaults an unbounded field would accept 500%.
  const effectiveMin = percent ? (min ?? 0) : min
  const effectiveMax = percent ? (max ?? 1) : max

  const commit = (raw: string) => {
    if (raw.trim() === '' || raw === '-' || raw === '.') {
      setText(displayValue(value, percent))
      setNotice(null)
      return
    }
    const parsed = percent ? parsePercentInput(raw) : Number(raw)
    if (parsed == null || !Number.isFinite(parsed)) {
      setText(displayValue(value, percent))
      setNotice(null)
      return
    }
    const { value: next, notice: rangeNotice } = clampWithNotice(
      parsed,
      effectiveMin,
      effectiveMax,
      percent,
    )
    setText(percent ? formatPercentInput(next) : displayValue(next, percent))
    setNotice(rangeNotice)
    onChange(next)
  }

  return (
    <label className={`cap-field block text-sm${disabled ? ' is-disabled' : ''}`}>
      <span className="cap-field__label-row">
        <span className="cap-field__label">{withPercentLabel(label, percent)}</span>
        {help ? <HelpTip text={help} /> : null}
      </span>
      <span className={`cap-field__control${percent ? ' cap-field__control--percent' : ''}`}>
        <input
          type="text"
          inputMode="decimal"
          className="cap-field__input w-full"
          value={text}
          placeholder={placeholder ?? (percent ? 'e.g. 12.5' : undefined)}
          disabled={disabled}
          title={
            percent
              ? 'Enter a percent from 0 to 100 (for example 12.5). Press Enter to save.'
              : 'Press Enter to save.'
          }
          onChange={(e) => setText(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit(text)
              ;(e.target as HTMLInputElement).blur()
            }
          }}
        />
        {percent ? <span className="cap-field__suffix" aria-hidden="true">%</span> : null}
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
