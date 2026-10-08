/**
 * Holiday calendars for the browser forecasting models.
 *
 * Backed by `date-holidays`, which covers 206 countries from official sources.
 * That matters because the hard cases are exactly the ones a hand-written table
 * gets wrong: Easter and Good Friday move every year, Eid and Chinese New Year
 * drift about eleven days a year, US Thanksgiving is the fourth Thursday of
 * November, and a holiday falling on a weekend is often observed on another day.
 *
 * The package is ~10MB unpacked, so it is imported dynamically. A planner who
 * never selects a country never downloads it, and Vite emits it as its own
 * chunk.
 */

export type HolidayMap = Map<string, string[]>

export type HolidayCountry = { code: string; name: string; featured: boolean }

/** Delivery and client geographies this planner sees most, listed first. */
const FEATURED: Record<string, string> = {
  PH: 'Philippines',
  US: 'United States',
  CA: 'Canada',
  GB: 'United Kingdom',
  IN: 'India',
  AU: 'Australia',
  NZ: 'New Zealand',
  MX: 'Mexico',
  CO: 'Colombia',
  SG: 'Singapore',
  MY: 'Malaysia',
  JP: 'Japan',
  ZA: 'South Africa',
  IE: 'Ireland',
  DE: 'Germany',
}

type HolidaysModule = typeof import('date-holidays')

let modulePromise: Promise<HolidaysModule> | null = null

function loadModule(): Promise<HolidaysModule> {
  // Cached so selecting a second country does not re-fetch the chunk.
  modulePromise ??= import('date-holidays')
  return modulePromise
}

export async function listHolidayCountries(): Promise<HolidayCountry[]> {
  const module = await loadModule()
  const Holidays = module.default
  const all = new Holidays().getCountries() as Record<string, string>
  const out: HolidayCountry[] = Object.entries(all).map(([code, name]) => ({
    code,
    name: FEATURED[code] ?? name,
    featured: code in FEATURED,
  }))
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

function isoOf(value: string | Date): string {
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10)
}

/**
 * Public holidays across the given countries, keyed by ISO date.
 *
 * Only `public` and `bank` types are used. The package also reports observances
 * and optional days — "National Pizza Day" is in there — which do not close a
 * contact centre and would only add noise to the model.
 */
export async function resolveHolidays(
  countries: string[],
  fromIso: string,
  toIso: string,
): Promise<HolidayMap> {
  const map: HolidayMap = new Map()
  if (!countries.length) return map

  const module = await loadModule()
  const Holidays = module.default

  const fromYear = Number(fromIso.slice(0, 4))
  const toYear = Number(toIso.slice(0, 4))
  if (!Number.isFinite(fromYear) || !Number.isFinite(toYear)) return map

  for (const code of countries) {
    let calendar: InstanceType<HolidaysModule['default']>
    try {
      calendar = new Holidays(code)
    } catch {
      // An unknown country should not sink the whole forecast.
      continue
    }
    for (let year = fromYear; year <= toYear; year++) {
      let entries: Array<{ date: string; name: string; type: string }> = []
      try {
        entries = (calendar.getHolidays(year) ?? []) as typeof entries
      } catch {
        continue
      }
      for (const entry of entries) {
        if (entry.type !== 'public' && entry.type !== 'bank') continue
        const iso = isoOf(entry.date)
        if (iso < fromIso || iso > toIso) continue
        const names = map.get(iso) ?? []
        // Two countries sharing a holiday should not double-count it.
        if (!names.includes(entry.name)) names.push(entry.name)
        map.set(iso, names)
      }
    }
  }

  return map
}
