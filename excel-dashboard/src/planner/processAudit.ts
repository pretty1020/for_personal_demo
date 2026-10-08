/** Sample process audit. Regional scores match the illustrative heatmap. */

export const PRACTICES = ['Forecasting', 'Capacity', 'Scheduling', 'Intraday', 'Reporting'] as const
export const REGIONS = ['APAC', 'India', 'EMEA', 'AMER'] as const

export type Practice = (typeof PRACTICES)[number]
export type Region = (typeof REGIONS)[number]
export type PhaseId = 'discover' | 'diagnose' | 'reconcile' | 'codify' | 'deploy'

export type SiteAudit = {
  id: string
  name: string
  region: Region
  city: string
  agents: number
  tool: 'NICE IEX' | 'Verint' | 'Excel'
  cadence: string
  owner: string
  scores: Record<Practice, number>
}

export const SITES: SiteAudit[] = [
  site('manila', 'Manila', 'APAC', 'Manila', 860, 'NICE IEX', 'Forecast locked every Monday', 'A. Cruz', [2, 1, 4, 3, 2]),
  site('cebu', 'Cebu', 'APAC', 'Cebu', 640, 'Excel', 'Sheet shared on Thursday', 'L. Reyes', [3, 2, 5, 2, 1]),
  site('singapore', 'Singapore', 'APAC', 'Singapore', 220, 'Verint', 'Daily 15-minute read', 'M. Tan', [3, 2, 4, 4, 3]),
  site('sydney', 'Sydney', 'APAC', 'Sydney', 180, 'NICE IEX', 'Weekly with the client', 'P. Walsh', [4, 3, 3, 3, 2]),
  site('bengaluru', 'Bengaluru', 'India', 'Bengaluru', 1100, 'Excel', 'Copied from last month', 'R. Iyer', [2, 1, 3, 2, 2]),
  site('hyderabad', 'Hyderabad', 'India', 'Hyderabad', 740, 'Excel', 'Updated when asked', 'S. Reddy', [2, 1, 4, 2, 3]),
  site('pune', 'Pune', 'India', 'Pune', 510, 'Verint', 'Two owners, no calendar', 'N. Kulkarni', [1, 1, 2, 1, 2]),
  site('chennai', 'Chennai', 'India', 'Chennai', 390, 'NICE IEX', 'Friday lock, often late', 'K. Nair', [3, 2, 3, 3, 1]),
  site('dublin', 'Dublin', 'EMEA', 'Dublin', 260, 'NICE IEX', 'Same steps in all three tools', 'C. Byrne', [4, 2, 3, 4, 1]),
  site('warsaw', 'Warsaw', 'EMEA', 'Warsaw', 340, 'Verint', 'Verint macro only', 'A. Nowak', [5, 3, 3, 5, 1]),
  site('cairo', 'Cairo', 'EMEA', 'Cairo', 480, 'Excel', 'Client pack built by hand', 'H. Farouk', [4, 1, 3, 4, 2]),
  site('dallas', 'Dallas', 'AMER', 'Dallas', 410, 'Verint', 'State rules written on the wall', 'J. Hale', [3, 4, 2, 3, 2]),
  site('tampa', 'Tampa', 'AMER', 'Tampa', 290, 'NICE IEX', 'Schedule rebuilt every Sunday', 'D. Brooks', [3, 3, 2, 4, 1]),
  site('bogota', 'Bogotá', 'AMER', 'Bogotá', 360, 'Excel', 'Bilingual pack, one owner', 'L. Gómez', [3, 2, 2, 2, 3]),
]

export const PHASES: Array<{
  id: PhaseId
  n: string
  title: string
  when: string
  plain: string
  points: string[]
}> = [
  {
    id: 'discover',
    n: '1',
    title: 'Discover',
    when: 'Weeks 1–4',
    plain: 'Visit how the work is done today. Write down the tool, the rhythm, and the person who owns it. Do not change anything yet.',
    points: ['Look at all 14 sites, not the loudest ones', 'Collect the tool, the template, the cadence, and the owner'],
  },
  {
    id: 'diagnose',
    n: '2',
    title: 'Diagnose',
    when: 'Weeks 3–6',
    plain: 'Score each site from 1 to 5. One means messy. Five means the method is ready to copy. Then price the gap in people, service, and money.',
    points: ['1 is messy, 5 is ready to copy', 'A low score has a cost: extra people, missed service, and dollars'],
  },
  {
    id: 'reconcile',
    n: '3',
    title: 'Reconcile',
    when: 'Weeks 6–8',
    plain: 'Put the regions side by side. Keep the method with the better result. Rank does not decide it.',
    points: ['Compare regions on the same practice', 'The green cell is the one to copy'],
  },
  {
    id: 'codify',
    n: '4',
    title: 'Codify',
    when: 'Weeks 8–12',
    plain: 'Write the winning method as one standard, plus a short dictionary of the metrics. Each region signs it.',
    points: ['One global way of working', 'A metric means the same thing in every site', 'Regional leaders sign before it is used'],
  },
  {
    id: 'deploy',
    n: '5',
    title: 'Deploy and sustain',
    when: 'Months 4–9',
    plain: 'Do not switch every site in one week. Try two sites, then move in waves. Score the work again every quarter.',
    points: ['Pilot two sites', 'Roll out in waves', 'Check again every quarter'],
  },
]

export const CONFLICTS: Array<{
  id: string
  rule: string
  title: string
  plain: string
  left: { label: string; detail: string }
  right: { label: string; detail: string }
  winner: 'left' | 'right'
  because: string
}> = [
  {
    id: 'evidence',
    rule: 'Evidence wins',
    title: 'Two forecast methods',
    plain: 'Keep the method that is more accurate, holds service, and costs less. A senior title does not win.',
    left: { label: 'Manila model', detail: '91% accuracy, service held, lower overtime' },
    right: { label: 'Bengaluru override', detail: 'A director adjusts the sheet by feel. 78% accuracy' },
    winner: 'left',
    because: 'Manila is more accurate and cheaper. The director’s edit does not beat the result.',
  },
  {
    id: 'compliance',
    rule: 'Client and compliance',
    title: 'A cheaper schedule that breaks a rule',
    plain: 'Contracts, labor laws, and data rules are not a vote. If a method breaks one, it is out.',
    left: { label: 'Dallas 10-hour shift', detail: 'Saves 6 seats, but it breaks the state daily-hour rule' },
    right: { label: 'Current 8-hour pattern', detail: 'Costs more seats, and it follows the labor rule' },
    winner: 'right',
    because: 'The cheaper pattern is not allowed. Compliance ends the discussion.',
  },
  {
    id: 'scalable',
    rule: 'Works in any tool',
    title: 'A clever macro that only one tool can run',
    plain: 'The standard has to run in NICE IEX, Verint, or Excel. A trick that lives in only one tool stays local.',
    left: { label: 'Dublin steps', detail: 'The same weekly steps are written for all three tools' },
    right: { label: 'Warsaw macro', detail: 'Fast, but it runs only inside Verint' },
    winner: 'left',
    because: 'Dublin can be used at every site. Warsaw cannot.',
  },
  {
    id: 'exception',
    rule: 'Exceptions are written',
    title: 'A client pack that cannot match the standard',
    plain: 'A site may differ only with a written reason, a date to revisit, and a named owner.',
    left: { label: 'Cairo client pack', detail: 'Business case signed, review on 30 June, owner H. Farouk' },
    right: { label: 'Unwritten local habit', detail: '“We have always done it this way.” No date, no owner' },
    winner: 'left',
    because: 'Cairo wrote the exception down. A habit with no owner is not an exception.',
  },
]

export const WAVES: Array<{
  id: string
  name: string
  when: string
  sites: string[]
  plain: string
}> = [
  {
    id: 'pilot',
    name: 'Pilot',
    when: 'Month 4',
    sites: ['Dublin', 'Hyderabad'],
    plain: 'Dublin already works well. Hyderabad is manual. Try the standard in both before anyone else moves.',
  },
  {
    id: 'wave-1',
    name: 'Wave 1',
    when: 'Months 5–6',
    sites: ['Bengaluru', 'Pune', 'Chennai'],
    plain: 'India capacity is the weakest cell on the map. Fix that practice at these three sites next.',
  },
  {
    id: 'wave-2',
    name: 'Wave 2',
    when: 'Month 7',
    sites: ['Cairo', 'Warsaw'],
    plain: 'EMEA reporting is still by hand. Bring those two sites onto the signed standard.',
  },
  {
    id: 'wave-3',
    name: 'Wave 3',
    when: 'Months 8–9',
    sites: ['Dallas', 'Tampa', 'Bogotá'],
    plain: 'Americas scheduling is the remaining red. Roll it out only after the earlier waves are steady.',
  },
  {
    id: 'quarter',
    name: 'Quarterly check',
    when: 'Every quarter',
    sites: ['All 14 sites'],
    plain: 'Score the same five practices again. If a green site slips, treat it like a site that still needs help.',
  },
]

const METHOD: Record<Practice, Record<number, string>> = {
  Forecasting: {
    1: 'Last month is copied forward',
    2: 'A shared sheet, updated late',
    3: 'A weekly forecast with one owner',
    4: 'A measured model, checked against actuals',
    5: 'The same model, written so any site can run it',
  },
  Capacity: {
    1: 'Headcount is guessed in a private file',
    2: 'Seats and people are tracked apart',
    3: 'A weekly plan, still rebuilt by hand',
    4: 'Demand, people, and seats in one view',
    5: 'One plan other sites can copy without a specialist',
  },
  Scheduling: {
    1: 'Shifts are drawn the night before',
    2: 'A pattern that ignores the labor rule',
    3: 'A fixed pattern that meets the rule',
    4: 'Shifts follow the forecast and the rule',
    5: 'The pattern is documented for every tool',
  },
  Intraday: {
    1: 'Changes happen in chat, with no record',
    2: 'A lead moves people when the queue spikes',
    3: 'A midday check with a written move',
    4: 'Moves follow a threshold everyone can see',
    5: 'The same thresholds work in every region',
  },
  Reporting: {
    1: 'Numbers are pasted into slides by hand',
    2: 'Each site uses a different definition',
    3: 'A weekly pack, definitions still local',
    4: 'One dictionary, checked before it is sent',
    5: 'Leaders in every region sign the same pack',
  },
}

export function methodFor(practice: Practice, score: number): string {
  return METHOD[practice][score] ?? 'Not scored'
}

export function sitesIn(region: Region): SiteAudit[] {
  return SITES.filter((item) => item.region === region)
}

export function regionScore(region: Region, practice: Practice): number {
  const rows = sitesIn(region)
  const avg = rows.reduce((sum, item) => sum + item.scores[practice], 0) / rows.length
  return Math.round(avg)
}

export function bestRegion(practice: Practice): Region {
  return REGIONS.slice().sort((a, b) => regionScore(b, practice) - regionScore(a, practice))[0]!
}

export function scoreBand(score: number): 'strong' | 'steady' | 'weak' {
  if (score >= 4) return 'strong'
  if (score <= 2) return 'weak'
  return 'steady'
}

/** Extra people, service, and monthly cost of doing the work the hard way. */
export function varianceCost(agents: number, score: number): { extraFte: number; serviceLevel: number; monthlyCostUsd: number } {
  const gap = Math.max(0, 5 - score)
  return {
    extraFte: Math.round(agents * 0.012 * gap),
    serviceLevel: Math.round((0.9 - gap * 0.035) * 1000) / 1000,
    monthlyCostUsd: Math.round((agents * 22 * gap) / 10) * 10,
  }
}

export function plainCell(region: Region, practice: Practice): string {
  const score = regionScore(region, practice)
  const band = scoreBand(score)
  const best = bestRegion(practice)
  if (band === 'strong') {
    return `${region} ${practice.toLowerCase()} scores ${score}. This is a method worth copying.`
  }
  if (band === 'weak') {
    return `${region} ${practice.toLowerCase()} scores ${score}. This is manual or uneven. Copy the ${best} method here first.`
  }
  return `${region} ${practice.toLowerCase()} scores ${score}. It works, but it is not the one to copy.`
}

function site(
  id: string,
  name: string,
  region: Region,
  city: string,
  agents: number,
  tool: SiteAudit['tool'],
  cadence: string,
  owner: string,
  scores: number[],
): SiteAudit {
  return {
    id,
    name,
    region,
    city,
    agents,
    tool,
    cadence,
    owner,
    scores: {
      Forecasting: scores[0]!,
      Capacity: scores[1]!,
      Scheduling: scores[2]!,
      Intraday: scores[3]!,
      Reporting: scores[4]!,
    },
  }
}
