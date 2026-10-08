export type UserGuideSection = {
  id: string
  title: string
  summary: string
  /** Short module tags for search */
  tags: string[]
  steps: string[]
  tips: string[]
}

export const USER_GUIDE_INTRO =
  'Capacity Planning helps you set up clients, build weekly capacity plans, forecast demand, schedule agents, and review financial impact. This guide is for every role — schedulers, supervisors, managers, and admins.'

export const USER_GUIDE_SECTIONS: UserGuideSection[] = [
  {
    id: 'getting-started',
    title: 'Getting started',
    summary: 'Sign in, pick a plan, and navigate the workspace.',
    tags: ['home', 'login', 'navigation', 'setup'],
    steps: [
      'Sign in with your work email (one-time code or password). First-time users must set a new password when prompted.',
      'From Home, open an existing client · LOB or use New client to run the setup wizard.',
      'Use the top navigation: Capacity, Roster, Forecasting, Scheduling, and Planning Scenario.',
      'Your role controls which menus appear (e.g. Executive and Financial for supervisor+).',
    ],
    tips: [
      'After sign-in, wait a few seconds for your plans to load before editing.',
      'Use Home anytime to return to your portfolio list.',
    ],
  },
  {
    id: 'capacity-plan',
    title: 'Capacity plan matrix',
    summary: 'Edit weekly drivers, headcount, and hours in the matrix.',
    tags: ['capacity', 'matrix', 'fte', 'drivers', 'editable'],
    steps: [
      'Open Capacity from the nav or click a LOB on Home.',
      'Editable cells have a teal left edge and warm background — click to type a value.',
      'Tab moves to the next cell; Enter confirms and moves down in many grids.',
      'Week 1 drivers propagate forward when you use carry-forward or publish flows.',
      'Save or publish when you are done — unsaved work can be lost on refresh.',
    ],
    tips: [
      'Red borders mean the value failed validation — fix before leaving the cell.',
      'Planned vs actual weeks use different editable tones; check the matrix legend.',
      'Collapse the sidebar for more horizontal space on smaller screens.',
    ],
  },
  {
    id: 'forecasting',
    title: 'Forecasting',
    summary: 'Project volume, AHT, and attrition from history.',
    tags: ['forecast', 'volume', 'aht', 'models'],
    steps: [
      'Select the same capacity plan you use for staffing.',
      'Upload or use sample actuals, then choose a forecast model.',
      'Compare scenarios before applying drivers back to the capacity plan.',
      'Review diagnostics when a model looks flat or unstable.',
    ],
    tips: [
      'Long history improves seasonal models; short history may default to simpler fits.',
      'Apply forecast to plan only when you intend to overwrite planned weeks.',
    ],
  },
  {
    id: 'scheduling',
    title: 'Scheduling',
    summary: 'Generate interval schedules, shrinkage, and agent grids.',
    tags: ['schedule', 'shrinkage', 'interval', 'roster', 'generate'],
    steps: [
      'Confirm pattern upload, FTE source, and production HC, then Generate schedule.',
      'Apply Shrinkage updates Net FTE after shrinkage only — Scheduled and Net FTE stay fixed.',
      'Unlock the agent grid to edit shifts; click Save changes before export or library save.',
      'Requirement grid edits regenerate assignments — save grid edits first if both are open.',
      'Use Scheduling settings for shift templates, break rules, and interval length.',
    ],
    tips: [
      'First schedule generation may take longer; subsequent shrinkage changes are fast.',
      'Volume/AHT upload unlocks Erlang-style service level in the staffing matrix.',
    ],
  },
  {
    id: 'roster-users',
    title: 'Roster & users',
    summary: 'Staff roster, supervisors, and account access.',
    tags: ['roster', 'users', 'admin', 'access', 'grants'],
    steps: [
      'Roster holds agent names and supervisor team assignments used by Scheduling.',
      'Admins manage Users: add email, set role, and click Save before leaving the page.',
      'Grant plan access so schedulers can open LOBs they do not own.',
      'Supervisors and above see company-wide plans without individual grants.',
    ],
    tips: [
      'If a new user cannot sign in, ask an admin to re-save them and confirm a green success message.',
      'Deactivate users from the directory — do not delete your own admin account.',
    ],
  },
  {
    id: 'editing-tips',
    title: 'Editing cells & avoiding errors',
    summary: 'Smooth editing across all modules.',
    tags: ['editable', 'cells', 'errors', 'save', 'keyboard'],
    steps: [
      'Only highlighted cells are editable; calculated cells are read-only.',
      'Click once to focus; use Tab / Shift+Tab to move without mouse.',
      'Dirty cells (teal highlight) mean unsaved local changes — save the page action when offered.',
      'If export or save is blocked, finish or discard open schedule grid edits first.',
      'Hard refresh (Ctrl+Shift+R) reloads the page — save important work first.',
    ],
    tips: [
      'Connection errors on Users or plans usually clear after sign out and sign in again.',
      'Ask the AI Assistant when enabled for help interpreting metrics on the current page.',
    ],
  },
  {
    id: 'financials-leakage',
    title: 'Financials & revenue leakages',
    summary: 'Review revenue, cost, and leakage drivers with shared Period, Client, and LOB filters.',
    tags: ['financial', 'leakage', 'overview', 'month', 'quarter', 'mom'],
    steps: [
      'Open Financials → Overview for KPI cards, revenue & cost trend, and leakages.',
      'Use Period to switch Full year, Monthly, or Quarterly — Overview and Leakages stay aligned.',
      'Select the same Client and LOB on Overview and Leakages to compare identical totals.',
      'On Leakages, choose Week on week, Month on month, or Quarter on quarter for the leakage trend chart.',
      'Month on month shows each month’s lost revenue and the change versus the prior month.',
      'Drivers are understaffing, overstaffing, non-billable shrinkages, AHT, attrition, and volume shortfall.',
    ],
    tips: [
      'Leakage totals use Capacity Plan bill rates — the same source as Overview revenue leakages.',
      'Download this guide as a PDF from Home for offline reference.',
    ],
  },
]

export function filterUserGuideSections(query: string): UserGuideSection[] {
  const q = query.trim().toLowerCase()
  if (!q) return USER_GUIDE_SECTIONS
  return USER_GUIDE_SECTIONS.filter(
    (section) =>
      section.title.toLowerCase().includes(q) ||
      section.summary.toLowerCase().includes(q) ||
      section.tags.some((tag) => tag.includes(q)) ||
      section.steps.some((step) => step.toLowerCase().includes(q)) ||
      section.tips.some((tip) => tip.toLowerCase().includes(q)),
  )
}

/** @deprecated Prefer downloadUserGuidePdf — kept for callers expecting text. */
export function buildUserGuideDownloadText(): string {
  const lines: string[] = [
    'Capacity Planning — User Guide',
    '='.repeat(42),
    '',
    USER_GUIDE_INTRO,
    '',
  ]
  for (const section of USER_GUIDE_SECTIONS) {
    lines.push(section.title)
    lines.push('-'.repeat(section.title.length))
    lines.push(section.summary)
    lines.push('')
    lines.push('Steps:')
    section.steps.forEach((step, index) => {
      lines.push(`  ${index + 1}. ${step}`)
    })
    if (section.tips.length) {
      lines.push('')
      lines.push('Tips:')
      section.tips.forEach((tip) => {
        lines.push(`  • ${tip}`)
      })
    }
    lines.push('')
  }
  return `${lines.join('\n').trim()}\n`
}

export function downloadUserGuide(): void {
  void import('./userGuidePdf').then(({ downloadUserGuidePdf }) => {
    downloadUserGuidePdf()
  })
}
