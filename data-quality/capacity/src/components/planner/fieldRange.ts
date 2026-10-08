import { formatPercentInput } from '../../planner/capacityImportWeek'

export type ClampResult = {
  value: number
  /** Set when the entry fell outside the range and was pulled to the nearest bound. */
  notice: string | null
}

function describe(value: number, percent: boolean): string {
  if (percent) return `${formatPercentInput(value)}%`
  return String(Math.round(value * 1000) / 1000)
}

/**
 * Clamp a committed field value and explain the correction.
 *
 * Silently rewriting an out-of-range entry leaves the user staring at a number they
 * did not type, so the caller gets a message naming both what they entered and the
 * limit that was applied. Percent values are stored 0–1 but always described as 0–100.
 */
export function clampWithNotice(
  value: number,
  min: number | undefined,
  max: number | undefined,
  percent = false,
): ClampResult {
  if (min != null && value < min) {
    return {
      value: min,
      notice: `${describe(value, percent)} is below the minimum of ${describe(min, percent)}. Set to ${describe(min, percent)}.`,
    }
  }
  if (max != null && value > max) {
    return {
      value: max,
      notice: `${describe(value, percent)} is above the maximum of ${describe(max, percent)}. Set to ${describe(max, percent)}.`,
    }
  }
  return { value, notice: null }
}

/** Percent fields get "(%)" in the label, unless the caller already said it. */
export function withPercentLabel(label: string, percent: boolean): string {
  if (!percent || label.includes('%')) return label
  return `${label} (%)`
}
