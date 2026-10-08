/** Shared sample projects, clients & weeks (generic workforce planning demo data). */

export type IdealSampleClient = {
  name: string
  code: string
  location: string
  budgetBase: number
}

const IDEAL_SAMPLE_PROJECTS: readonly { code: string; name: string; region: 'IN' | 'PH' | 'RM' }[] = [
  { code: 'PRG|APX-IN-0001', name: 'Retail — India', region: 'IN' },
  { code: 'PRG|MRD-IN-0002', name: 'Meridian Healthcare — India', region: 'IN' },
  { code: 'PRG|NST-IN-0003', name: 'NorthStar Telecom — India', region: 'IN' },
  { code: 'PRG|HZF-IN-0004', name: 'Horizon Financial — India', region: 'IN' },
  { code: 'PRG|SMT-IN-0005', name: 'Summit Travel — India', region: 'IN' },
  { code: 'PRG|BLR-IN-0006', name: 'BlueRiver Insurance — India', region: 'IN' },
  { code: 'PRG|VLC-IN-0007', name: 'Velocity Logistics — India', region: 'IN' },
  { code: 'PRG|CDR-IN-0008', name: 'Cedar Banking — India', region: 'IN' },
  { code: 'PRG|PCU-IN-0009', name: 'Pacific Utilities — India', region: 'IN' },
  { code: 'PRG|NVS-IN-0010', name: 'Nova Cloud Support — India', region: 'IN' },
  { code: 'PRG|GLD-IN-0011', name: 'Goldline E-commerce — India', region: 'IN' },
  { code: 'PRG|PTR-IN-0012', name: 'Pioneer Tech Repair — India', region: 'IN' },
  { code: 'PRG|SLK-IN-0013', name: 'SilverKey Hospitality — India', region: 'IN' },
  { code: 'PRG|ARC-IN-0014', name: 'Arcadia Media — India', region: 'IN' },
  { code: 'PRG|FRT-IN-0015', name: 'Frontier Mobility — India', region: 'IN' },
  { code: 'PRG|QST-IN-0016', name: 'Quest Education — India', region: 'IN' },
  { code: 'PRG|BRG-IN-0017', name: 'BridgePay Fintech — India', region: 'IN' },
  { code: 'PRG|LMT-IN-0018', name: 'Lumen Transit — India', region: 'IN' },
  { code: 'PRG|RVR-IN-0019', name: 'Riverstone Energy — India', region: 'IN' },
  { code: 'PRG|HMP-IN-0020', name: 'HomePro Services — India', region: 'IN' },
  { code: 'PRG|CLD-RM-0001', name: 'CloudNine Gaming — Romania', region: 'RM' },
  { code: 'PRG|JST-PH-0001', name: 'JustAsk Experts — Philippines', region: 'PH' },
  { code: 'PRG|STR-PH-0002', name: 'StreamWave Media — Philippines', region: 'PH' },
  { code: 'PRG|TCL-PH-0003', name: 'TechConnect Support — Philippines', region: 'PH' },
  { code: 'PRG|NVG-PH-0004', name: 'Navico Marine — Philippines', region: 'PH' },
  { code: 'PRG|ECO-PH-0005', name: 'EcoCycle Services — Philippines', region: 'PH' },
  { code: 'PRG|FSV-PH-0006', name: 'FinServe Payments — Philippines', region: 'PH' },
  { code: 'PRG|ELV-PH-0007', name: 'Elevate Wellness — Philippines', region: 'PH' },
  { code: 'PRG|TLC-PH-0009', name: 'Telco — Philippines', region: 'PH' },
  { code: 'PRG|OTT-PH-0008', name: 'Orbit Telecom — Philippines', region: 'PH' },
] as const

function locationForRegion(region: 'IN' | 'PH' | 'RM'): string {
  if (region === 'PH') return 'Philippines'
  if (region === 'RM') return 'Romania'
  return 'India'
}

function budgetBaseForProject(code: string, index: number): number {
  if (/HZF|CDR|FSV|BRG/.test(code)) return 92_000 + (index % 4) * 3_800
  if (/NST|PCU|LMT|HMP/.test(code)) return 64_000 + (index % 5) * 3_100
  if (/CLD|QST|MRD|VLC/.test(code)) return 52_000 + (index % 4) * 2_600
  const hash = [...code].reduce((sum, ch) => sum + ch.charCodeAt(0), 0)
  return 24_000 + (hash % 19) * 1_750 + (index % 6) * 1_100
}

export const IDEAL_SAMPLE_CLIENTS: IdealSampleClient[] = IDEAL_SAMPLE_PROJECTS.map((p, i) => ({
  name: p.name,
  code: p.code,
  location: locationForRegion(p.region),
  budgetBase: budgetBaseForProject(p.code, i),
}))

function formatLocalIso(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Sundays from 4 Jan 2026 — default 12-week trending window */
function buildWeekStarts(): string[] {
  const d = new Date(2026, 0, 4, 12, 0, 0)
  const out: string[] = []
  for (let i = 0; i < 12; i++) {
    out.push(formatLocalIso(d))
    d.setDate(d.getDate() + 7)
  }
  return out
}

export const IDEAL_SAMPLE_WEEKS = buildWeekStarts()
