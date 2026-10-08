/** Suggested call-center / BPO industry sectors. Users can add custom labels. */
export const DEFAULT_INDUSTRY_OPTIONS = [
  'Telecom',
  'Retail',
  'Travel',
  'Hospitality',
  'Financial',
  'Healthcare',
  'Technology',
  'Utilities',
  'Insurance',
  'Government',
  'Other',
] as const

const STORAGE_KEY = 'wfp-industry-options-v1'
export const MAX_INDUSTRY_LENGTH = 48

export function normalizeIndustryLabel(raw: unknown): string {
  const trimmed = String(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, MAX_INDUSTRY_LENGTH)
  if (!trimmed) return ''
  const match = DEFAULT_INDUSTRY_OPTIONS.find((item) => item.toLowerCase() === trimmed.toLowerCase())
  return match ?? trimmed
}

export function loadIndustryOptions(): string[] {
  const base = [...DEFAULT_INDUSTRY_OPTIONS]
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return base
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return base
    const extras: string[] = []
    for (const item of parsed) {
      const label = normalizeIndustryLabel(item)
      if (!label) continue
      if (base.some((option) => option.toLowerCase() === label.toLowerCase())) continue
      if (extras.some((option) => option.toLowerCase() === label.toLowerCase())) continue
      extras.push(label)
    }
    return [...base, ...extras].sort((a, b) => a.localeCompare(b))
  } catch {
    return base
  }
}

/** Persist a custom industry so it appears in future dropdowns. */
export function rememberIndustryOption(raw: string): string[] {
  const label = normalizeIndustryLabel(raw)
  if (!label) return loadIndustryOptions()
  const current = loadIndustryOptions()
  if (current.some((option) => option.toLowerCase() === label.toLowerCase())) return current
  const next = [...current, label].sort((a, b) => a.localeCompare(b))
  try {
    const customOnly = next.filter(
      (option) =>
        !DEFAULT_INDUSTRY_OPTIONS.some((item) => item.toLowerCase() === option.toLowerCase()),
    )
    localStorage.setItem(STORAGE_KEY, JSON.stringify(customOnly))
  } catch {
    /* ignore quota */
  }
  return next
}
