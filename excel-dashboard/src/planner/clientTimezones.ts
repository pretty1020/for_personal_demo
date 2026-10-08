/** IANA timezones commonly used for BPO / WFM capacity planning. */
export const CLIENT_TIMEZONE_OPTIONS = [
  { value: 'Asia/Manila', label: 'Philippines (Manila)' },
  { value: 'Asia/Kolkata', label: 'India (IST)' },
  { value: 'Asia/Dubai', label: 'UAE (Dubai)' },
  { value: 'Asia/Singapore', label: 'Singapore' },
  { value: 'Australia/Sydney', label: 'Australia East (Sydney)' },
  { value: 'Europe/London', label: 'United Kingdom (London)' },
  { value: 'Europe/Berlin', label: 'Central Europe (Berlin)' },
  { value: 'America/New_York', label: 'US Eastern' },
  { value: 'America/Chicago', label: 'US Central' },
  { value: 'America/Denver', label: 'US Mountain' },
  { value: 'America/Los_Angeles', label: 'US Pacific' },
  { value: 'America/Mexico_City', label: 'Mexico Central' },
  { value: 'America/Costa_Rica', label: 'Costa Rica' },
] as const

export type ClientTimezoneOption = (typeof CLIENT_TIMEZONE_OPTIONS)[number]['value']

/** Default for new Peak clients (sample site is Manila). */
export const DEFAULT_CLIENT_TIMEZONE: ClientTimezoneOption = 'Asia/Manila'

const OPTION_SET = new Set<string>(CLIENT_TIMEZONE_OPTIONS.map((item) => item.value))

export function isValidTimeZone(value: string | null | undefined): boolean {
  const trimmed = value?.trim()
  if (!trimmed) return false
  try {
    Intl.DateTimeFormat('en-US', { timeZone: trimmed }).format(new Date())
    return true
  } catch {
    return false
  }
}

/** Normalize to a valid IANA zone; unknown/empty → Manila. */
export function normalizeTimeZone(value?: string | null): string {
  const trimmed = value?.trim()
  if (trimmed && isValidTimeZone(trimmed)) return trimmed
  return DEFAULT_CLIENT_TIMEZONE
}

export function formatTimeZoneLabel(value?: string | null): string {
  const zone = normalizeTimeZone(value)
  const known = CLIENT_TIMEZONE_OPTIONS.find((item) => item.value === zone)
  return known ? `${known.label} · ${zone}` : zone
}

export function resolvePlanTimeZone(plan?: { timezone?: string | null } | null): string {
  return normalizeTimeZone(plan?.timezone)
}

/** Calendar YYYY-MM-DD for "today" in the given IANA timezone. */
export function todayIsoInTimeZone(timeZone?: string | null): string {
  const zone = normalizeTimeZone(timeZone)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970'
  const month = parts.find((part) => part.type === 'month')?.value ?? '01'
  const day = parts.find((part) => part.type === 'day')?.value ?? '01'
  return `${year}-${month}-${day}`
}

export function timezoneSelectOptions(current?: string | null): Array<{ value: string; label: string }> {
  const zone = current?.trim()
  const options: Array<{ value: string; label: string }> = CLIENT_TIMEZONE_OPTIONS.map((item) => ({
    value: item.value,
    label: `${item.label} (${item.value})`,
  }))
  if (zone && !OPTION_SET.has(zone) && isValidTimeZone(zone)) {
    options.unshift({ value: zone, label: `${zone} (custom)` })
  }
  return options
}
