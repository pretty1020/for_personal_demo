import { Link } from 'react-router-dom'

const DATA_QUALITY_URL =
  import.meta.env.VITE_DATA_QUALITY_URL ?? (import.meta.env.DEV ? 'http://127.0.0.1:3001/dashboard' : '/dashboard')

const MODULES = [
  {
    index: '01',
    kicker: 'Workforce planning',
    title: 'Capacity Plan',
    copy: 'Forecast the demand, set the headcount, schedule the week, and keep the margin in view.',
    points: ['Weekly capacity matrix', 'Roster, forecast, and schedule', 'Scenarios and financials'],
    href: '/workspace',
    external: false,
  },
  {
    index: '02',
    kicker: 'File intake',
    title: 'Data Quality',
    copy: 'Take files in, check them against the schema, and move them through checklist, workflow, and audit.',
    points: ['Upload and validation', 'Workflows and reports', 'Audit trail and settings'],
    href: DATA_QUALITY_URL,
    external: true,
  },
  {
    index: '03',
    kicker: 'Ways of working',
    title: 'Process Audit',
    copy: 'See how 14 sites do the same work, score the gaps, and choose one method to roll out.',
    points: ['Five steps, from discovery to quarterly check', 'A score for every region', 'A plain rule when two sites disagree'],
    href: '/process-audit',
    external: false,
  },
  {
    index: '04',
    kicker: 'How the work is run',
    title: 'Governance',
    copy: 'A daily, weekly, monthly, and quarterly rhythm, five measures that cannot slip, and a consequence when one stays red.',
    points: ['Cadence from the floor to the council', 'A weekly scorecard by site', 'Two red weeks become a recovery plan'],
    href: '/governance',
    external: false,
  },
  {
    index: '05',
    kicker: 'One certified number',
    title: 'Certified Data',
    copy: 'Follow a number from the source system to the dashboard, and see why a late or disagreeing feed never becomes fact.',
    points: ['Scheduled feeds, no manual extracts', 'Hours must agree within 1%', 'Executives and sites read the same table'],
    href: '/certified-data',
    external: false,
  },
  {
    index: '06',
    kicker: 'Unusual points',
    title: 'Anomaly Detection',
    copy: 'See which days, weeks, or months break the usual pattern, including a weekend that is supposed to be quieter.',
    points: ['Daily, weekly, and monthly series', 'A downloadable sample template', 'Click a point to see why it was flagged'],
    href: '/anomaly-detection',
    external: false,
  },
  {
    index: '07',
    kicker: 'One way of working',
    title: 'Global WFM',
    copy: 'See the move from 14 local operating models to one blueprint, and the tools that keep 80% of the work the same.',
    points: ['What we inherit, and the twelve-month picture', 'A Global SOP with a written local exception', 'FTE, seats, and cost from one calculator'],
    href: '/global-wfm',
    external: false,
  },
] as const

export function ModuleLandingPage() {
  return (
    <div className="portal">
      <div className="portal__frame">
        <header className="portal__hero">
          <p className="portal__kicker">Workspace</p>
          <h1 className="portal__title">
            Plan the work.
            <br />
            Trust the data.
          </h1>
          <p className="portal__lead">
            Seven modules, kept separate. Capacity planning holds the forecast and the schedule. Data quality holds the
            files. Process audit scores the local habits. Global WFM is the blueprint those habits move toward. Governance
            keeps that standard honest every week. Certified data carries a number from the source to the screen. Anomaly
            detection marks the point that breaks the pattern.
          </p>
        </header>

        <ol className="portal__modules">
          {MODULES.map((module) => (
            <li key={module.index} className="portal__module">
              <div className="portal__module-index">{module.index}</div>
              <div className="portal__module-copy">
                <p className="portal__module-kicker">{module.kicker}</p>
                <h2>{module.title}</h2>
                <p>{module.copy}</p>
                <ul>
                  {module.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </div>
              <div className="portal__module-action">
                {module.external ? (
                  <a className="portal__open" href={module.href}>
                    Open module
                  </a>
                ) : (
                  <Link className="portal__open" to={module.href}>
                    Open module
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
