import { useEffect, useState } from 'react'
import { HelpTip } from './HelpTip'
import { formatPercentInput, parsePercentInput } from '../../planner/capacityImportWeek'

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
}

function clamp(n: number, min?: number, max?: number): number {
  let v = n
  if (min != null && v < min) v = min
  if (max != null && v > max) v = max
  return v
}

function displayValue(value: number, percent?: boolean): string {
  if (!Number.isFinite(value)) return ''
  if (percent) return formatPercentInput(value)
  const rounded = Math.round(value * 1000) / 1000
  return String(rounded)
}

export function NumField({ label, help, value, onChange, step = 1, min, max, percent = false }: NumFieldProps) {
  const [text, setText] = useState(displayValue(value, percent))

  useEffect(() => {
    setText(displayValue(value, percent))
  }, [value, percent])

  const commit = (raw: string) => {
    if (raw.trim() === '' || raw === '-' || raw === '.') {
      setText(displayValue(value, percent))
      return
    }
    if (percent) {
      const rate = parsePercentInput(raw)
      if (rate == null) {
        setText(displayValue(value, percent))
        return
      }
      const next = clamp(rate, min, max)
      setText(formatPercentInput(next))
      onChange(next)
      return
    }
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) {
      setText(displayValue(value, percent))
      return
    }
    const next = clamp(parsed, min, max)
    setText(displayValue(next, percent))
    onChange(next)
  }

  return (
    <label className="cap-field block text-sm">
      <span className="cap-field__label-row">
        <span className="cap-field__label">{label}</span>
        {help ? <HelpTip text={help} /> : null}
      </span>
      <input
        type="text"
        inputMode="decimal"
        className="cap-field__input mt-1 w-full"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(text)
        }}
        aria-valuemin={percent && min != null ? min * 100 : min}
        aria-valuemax={percent && max != null ? max * 100 : max}
        aria-valuenow={percent ? value * 100 : value}
        step={step}
      />
    </label>
  )
}
