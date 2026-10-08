export type GapId = 'process' | 'governance' | 'capacity' | 'data'
export type ToolId = 'sop' | 'capacity' | 'forecast' | 'quality' | 'calculator'
export type SopProcessId = 'forecast' | 'capacity' | 'schedule' | 'intraday' | 'report'
export type BusinessModel = 'Voice' | 'Digital' | 'Back office'

export const GAPS: Array<{
  id: GapId
  inheritTitle: string
  inherit: string
  goodTitle: string
  good: string
  mark: string
  tools: ToolId[]
  today: string
  year: string
}> = [
  {
    id: 'process',
    inheritTitle: 'Process fragmentation',
    inherit: 'Every site runs forecasting and scheduling its own way.',
    goodTitle: 'One Global SOP',
    good: '80% of the work is the same in every region. The other 20% is local: public holidays, the language on the floor, and break windows inside a set band.',
    mark: 'P1',
    tools: ['sop', 'forecast'],
    today: '2 of 14 sites follow a written global method. Dublin and Hyderabad are the pilot.',
    year: '12 of 14 sites are on the global SOP. Tampa and Bogotá are still inside their first 90 days.',
  },
  {
    id: 'governance',
    inheritTitle: 'Inconsistent governance',
    inherit: 'No single person owns the process end to end. Sites work in silos.',
    goodTitle: 'Clear decision rights',
    good: 'A weekly scorecard, a named owner for each step, and a written path when a measure stays red.',
    mark: 'P3 · P4',
    tools: ['sop', 'forecast', 'quality'],
    today: '6 of 14 sites can name an owner. Only 4 publish a weekly scorecard.',
    year: 'Every site has an owner. A red measure for two weeks becomes a recovery plan.',
  },
  {
    id: 'capacity',
    inheritTitle: 'Capacity and financial variance',
    inherit: 'The plan, the seats, and the budget are three different conversations.',
    goodTitle: 'One capacity plan',
    good: 'FTE becomes seats, and seats become cost. TA, IT, Operations, Customer Service, and Finance review it once a month.',
    mark: 'P2 · P5',
    tools: ['capacity', 'calculator'],
    today: 'Five sites are short of seats. Manila’s October plan and its seat order were built a week apart.',
    year: 'One chain: workload, FTE, onsite seats, then monthly cost. The same chain is reviewed on the first Monday.',
  },
  {
    id: 'data',
    inheritTitle: 'Data and reporting friction',
    inherit: 'A site manager and an executive often see different numbers.',
    goodTitle: 'One certified number',
    good: 'An automated suite reads one certified dataset. The figure on the floor and the figure in the review are the same.',
    mark: 'P6',
    tools: ['quality', 'forecast'],
    today: '9 of 14 sites still send a Monday spreadsheet. Hyderabad’s ACD was 4.5% off the WFM hours last week.',
    year: 'Spreadsheets are no longer a source. A feed that misses its window never becomes the number on the screen.',
  },
]

export const TOOLS: Array<{ id: ToolId; label: string; mark: string; line: string }> = [
  { id: 'sop', label: 'Global SOP', mark: 'P1', line: 'The blueprint. Eighty percent is fixed. Twenty percent is local, and only when it is written down.' },
  { id: 'capacity', label: 'Capacity Planning', mark: 'P2 · P5', line: 'One plan from workload to seats to cost, reviewed with the same five teams every month.' },
  { id: 'forecast', label: 'Forecasting', mark: 'P3 · P6', line: 'One named forecast method, the same accuracy measure, and one owner of the number.' },
  { id: 'quality', label: 'Data Quality', mark: 'P6', line: 'Files are checked before they become fact. A late or disagreeing feed is held out.' },
  { id: 'calculator', label: 'WFM calculator', mark: 'P2', line: 'The same arithmetic everywhere: contacts and handle time become FTE, then seats, then cost.' },
]

export const SOP_DOCUMENT = {
  code: 'SOP-WFM-001',
  title: 'Global WFM Standard Operating Procedure',
  status: 'Sample blueprint',
  scope: '14 delivery sites across APAC, India, EMEA, and AMER. Three business models: Voice, Digital, and Back office.',
}

/** The reason the SOP exists. Forecasting through reporting are not run the same way. */
export const SOP_FINDING =
  'Forecasting, capacity planning, scheduling, intraday, and reporting exhibit significant gaps and variance across regional delivery sites and business models.'

export const SOP_PROCESSES: Array<{
  id: SopProcessId
  title: string
  gap: string
  spread: string
  standard: string
  local: string
  rows: Array<{
    site: string
    region: string
    model: BusinessModel
    today: string
    variance: string
  }>
}> = [
  {
    id: 'forecast',
    title: 'Forecasting',
    gap: 'The method and the accuracy change with the site and with the business model.',
    spread: 'Accuracy runs from 78% to 91%. Some sites name a method and lock it. Others copy last month.',
    standard: 'Every site uses one named forecast method. The forecast locks on Monday. A person cannot edit it after the lock. Accuracy is measured the same way everywhere.',
    local: 'Public holidays stay on the local calendar. A different method is allowed only as a written exception.',
    rows: [
      { site: 'Manila', region: 'APAC', model: 'Voice', today: 'Named method in NICE, locked Monday. Accuracy 91%.', variance: 'The method is named, the lock holds, and accuracy is measured.' },
      { site: 'Bengaluru', region: 'India', model: 'Voice', today: 'Last month is copied into Excel. A director then edits by feel. Accuracy 78%.', variance: 'No named method, and the number can change after it should be locked.' },
      { site: 'Dublin', region: 'EMEA', model: 'Digital', today: 'Email and chat share one sheet. Accuracy is not measured the same way as voice.', variance: 'Chat needs the global method. A separate email method is allowed only if it is written down.' },
      { site: 'Cairo', region: 'EMEA', model: 'Back office', today: 'Case volume is built by hand. No named method, and accuracy is not scored.', variance: 'Back office still needs a named method and the same accuracy measure. There is no owner and no lock date.' },
    ],
  },
  {
    id: 'capacity',
    title: 'Capacity planning',
    gap: 'Workload, seats, and cost are planned apart. Shrinkage and the onsite mix swing by site and by model.',
    spread: 'Shrinkage runs from 22% to 35%. Five sites are short of seats. One site orders seats a week after the FTE plan.',
    standard: 'One chain: workload hours, then FTE on a 40-hour week after shrinkage, then onsite seats, then monthly cost. TA, IT, Operations, Customer Service, and Finance review it on the first Monday.',
    local: 'The shrinkage rate is the site’s own, reviewed each month. It is not copied from another country.',
    rows: [
      { site: 'Manila', region: 'APAC', model: 'Voice', today: 'FTE is calculated. The seat order is placed a week later.', variance: 'The formula is right. The plan and the seats are still two conversations.' },
      { site: 'Hyderabad', region: 'India', model: 'Digital', today: 'Shrinkage 35%, mostly work-from-home. Seats are planned as if everyone were onsite.', variance: 'Work-from-home does not take a seat. The seat plan is too high.' },
      { site: 'Dallas', region: 'AMER', model: 'Voice', today: 'Shrinkage 22%, 90% onsite. A longer shift is used to cut the seat count.', variance: 'The seat cut uses a pattern the contract does not allow.' },
      { site: 'Bogotá', region: 'AMER', model: 'Back office', today: 'Staffed to last month’s closed cases. No FTE formula.', variance: 'Back office still needs the same chain. A copy of last month is not a plan.' },
    ],
  },
  {
    id: 'schedule',
    title: 'Scheduling',
    gap: 'The shift model, the tool, and the day the roster is published are local choices. Some of them break a labor rule.',
    spread: 'Rosters land on Sunday, Thursday, or inside one vendor tool. One site uses a 10-hour shift the state does not allow.',
    standard: 'The contract names the model: single shift, two shifts, or 24×7. Labor rules win over a cheaper pattern. The roster is locked before the week starts.',
    local: 'Break windows may move by 30 minutes so they fit the local rush hour.',
    rows: [
      { site: 'Tampa', region: 'AMER', model: 'Voice', today: 'The schedule is rebuilt every Sunday.', variance: 'There is no locked pattern. The week starts before the roster is finished.' },
      { site: 'Cebu', region: 'APAC', model: 'Voice', today: 'An Excel roster is shared on Thursday.', variance: 'The tool can stay Excel. Thursday is too late to be the plan for that week.' },
      { site: 'Warsaw', region: 'EMEA', model: 'Digital', today: 'The roster exists only as a Verint macro.', variance: 'A schedule that runs in one tool cannot be the global method.' },
      { site: 'Bogotá', region: 'AMER', model: 'Back office', today: 'A fixed day shift, with breaks set by the supervisor that morning.', variance: 'A day shift fits back office. Breaks still have to sit inside the 30-minute band.' },
    ],
  },
  {
    id: 'intraday',
    title: 'Intraday',
    gap: 'Some floors move people inside the interval. Others have no owner, and back office does not run on an interval at all.',
    spread: 'Warsaw has a written playbook. Pune has no intraday owner. Back office reallocates cases at midday.',
    standard: 'Voice and digital use one playbook: who may move people, and by how much, when an interval falls behind. Every site names an owner.',
    local: 'Back office reallocates work at midday, not every 15 minutes. The huddle is in the language of the site.',
    rows: [
      { site: 'Warsaw', region: 'EMEA', model: 'Digital', today: 'People are moved inside the interval from a written playbook.', variance: 'This is the method to copy, once it is written so it is not trapped in Verint.' },
      { site: 'Pune', region: 'India', model: 'Voice', today: 'No intraday owner. The floor waits until the next day.', variance: 'A missed interval is left until tomorrow. That is the widest gap.' },
      { site: 'Singapore', region: 'APAC', model: 'Digital', today: 'A 15-minute read, and moves stay inside a local cap.', variance: 'The rhythm is right. The cap is local and not the same number as other sites.' },
      { site: 'Cairo', region: 'EMEA', model: 'Back office', today: 'Cases are reassigned at midday. There is no interval.', variance: 'Midday fits back office. It still needs a named owner and a written limit.' },
    ],
  },
  {
    id: 'report',
    title: 'Reporting',
    gap: 'The metric and the source change by site and by model, so a site manager and an executive can read two numbers.',
    spread: '9 of 14 sites still send a Monday spreadsheet. One digital site was 4.5% off between ACD hours and WFM hours.',
    standard: 'Voice and digital report service level, handle time, and shrinkage from the certified dataset. Back office reports cases closed from that same set. A spreadsheet is not a source.',
    local: 'A site may add a note. The note cannot replace the certified figure.',
    rows: [
      { site: 'Cebu', region: 'APAC', model: 'Voice', today: 'Service level comes from a Thursday spreadsheet, and the client pack uses another file.', variance: 'Two files, two numbers, for the same week.' },
      { site: 'Hyderabad', region: 'India', model: 'Digital', today: 'WFM hours 28,110. ACD hours 26,840. They disagree by 4.5%.', variance: 'Above the 1% band, so the week cannot be the number an executive reads.' },
      { site: 'Dallas', region: 'AMER', model: 'Voice', today: 'Occupancy comes from Verint. Shrinkage is taken from a chart on the wall.', variance: 'Two sources for two measures that belong in the same certified set.' },
      { site: 'Cairo', region: 'EMEA', model: 'Back office', today: 'Cases closed are typed into the client pack by hand.', variance: 'The measure can be cases closed. The source still has to be the certified set.' },
    ],
  },
]

export const SOP_EXCEPTION = {
  title: 'Written exception: Dublin email',
  rule: 'One named method, locked on Monday, with accuracy measured the same way. That part is not open to a local vote.',
  exception: 'Dublin email may keep its own method until 1 December 2026. Owner: C. Byrne, Dublin WFM lead. Chat uses the global method now, and accuracy is reported on the same measure as voice.',
}

export const STANDARD_SHARE = 0.8

export function localShare(standard = STANDARD_SHARE): number {
  return Math.round((1 - standard) * 100) / 100
}

/** Workload hours ÷ (40 × (1 − shrinkage)). Shrinkage is a fraction, such as 0.28. */
export function requiredFte(weeklyContacts: number, ahtSeconds: number, shrinkage: number): number {
  const workloadHours = (weeklyContacts * ahtSeconds) / 3600
  const productive = 40 * (1 - shrinkage)
  if (productive <= 0) return 0
  return workloadHours / productive
}

/** Onsite agents take a seat. WAH does not. Peak is the share of onsite HC on the seat at once. */
export function seatDemand(fte: number, onsiteShare: number, peakShare: number): number {
  const onsite = Math.max(0, fte) * onsiteShare
  const support = onsite / 12
  return onsite * peakShare + support
}

export function monthlyCost(fte: number, monthlyRate: number): number {
  return Math.round(Math.max(0, fte) * monthlyRate)
}

export const CALCULATOR_DEFAULTS = {
  weeklyContacts: 42000,
  ahtSeconds: 410,
  shrinkage: 0.28,
  onsiteShare: 0.86,
  peakShare: 0.6,
  monthlyRate: 1850,
}
