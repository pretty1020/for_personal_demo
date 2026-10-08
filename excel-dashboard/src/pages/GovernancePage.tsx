import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CADENCE,
  GOV_SITES,
  GOV_WEEKS,
  KPIS,
  LOOP,
  causeFor,
  kpiTone,
  latestReading,
  loopStep,
  needsRecovery,
  plainStatus,
  tones,
  valueLine,
  weekLabel,
  type CadenceId,
  type GovSite,
  type KpiId,
  type RegionName,
} from '../planner/governance'

const REGIONS: Array<RegionName | 'All'> = ['All', 'APAC', 'India', 'EMEA', 'AMER']

export function GovernancePage() {
  const [cadenceId, setCadenceId] = useState<CadenceId>('weekly')
  const [region, setRegion] = useState<RegionName | 'All'>('All')
  const [kpiId, setKpiId] = useState<KpiId>('staffing')
  const [siteId, setSiteId] = useState('pune')
  const cadence = CADENCE.find((item) => item.id === cadenceId) ?? CADENCE[1]!
  const kpi = KPIS.find((item) => item.id === kpiId) ?? KPIS[1]!
  const visible = useMemo(
    () => GOV_SITES.filter((item) => region === 'All' || item.region === region),
    [region],
  )
  const site = visible.find((item) => item.id === siteId) ?? visible[0] ?? GOV_SITES[0]!
  const step = loopStep(site, kpi.id)
  const recovery = needsRecovery(site, kpi.id)

  return (
    <div className="gov-page">
      <div className="gov-frame">
        <header className="gov-hero">
          <div>
            <p className="gov-kicker">Governance</p>
            <h1>Meet on a rhythm. Read five numbers. Act when one stays red.</h1>
            <p className="gov-lead">
              Week of {weekLabel(GOV_WEEKS[GOV_WEEKS.length - 1]!)}. Eight sites. The same five measures every week.
            </p>
          </div>
          <Link className="gov-back" to="/">Main page</Link>
        </header>

        <p className="gov-plain" role="status">{plainStatus(site, kpi.id)}</p>

        <section className="gov-cadence" aria-label="Governance cadence">
          {CADENCE.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === cadence.id ? 'is-on' : ''}
              onClick={() => setCadenceId(item.id)}
            >
              <em>{item.name}</em>
              <strong>{item.title}</strong>
              <span>{item.plain}</span>
            </button>
          ))}
        </section>

        <section className="gov-score">
          <div className="gov-score__head">
            <div>
              <h2>This week’s scorecard</h2>
              <p>Click a measure, then a site. {cadence.name} looks at {cadence.looksAt.length === 5 ? 'all five' : 'the measures marked in view'}.</p>
            </div>
            <div className="gov-regions" role="tablist" aria-label="Region">
              {REGIONS.map((item) => (
                <button key={item} type="button" className={item === region ? 'is-on' : ''} onClick={() => setRegion(item)}>
                  {item}
                </button>
              ))}
            </div>
          </div>
          <div className="gov-table" role="table">
            <div className="gov-table__row gov-table__row--head" role="row">
              <span>Measure</span>
              <span>Target</span>
              <span>Owner</span>
              <span>Sites on target</span>
            </div>
            {KPIS.map((item) => {
              const onTarget = visible.filter((row) => kpiTone(latestReading(row), item.id) === 'pass').length
              const inView = cadence.looksAt.includes(item.id)
              return (
                <button
                  key={item.id}
                  type="button"
                  role="row"
                  className={`gov-table__row${item.id === kpi.id ? ' is-on' : ''}${inView ? '' : ' is-dim'}`}
                  onClick={() => setKpiId(item.id)}
                >
                  <strong>{item.name}</strong>
                  <span>{item.target}</span>
                  <span>{item.owner}</span>
                  <b>{onTarget} of {visible.length}</b>
                </button>
              )
            })}
          </div>
        </section>

        <section className="gov-detail">
          <div>
            <p className="gov-kicker">{kpi.owner}</p>
            <h2>{kpi.name}</h2>
            <p>{kpi.plain}</p>
            <p className="gov-definition">{kpi.definition} Target: {kpi.target}</p>
          </div>
          <ul className="gov-sites">
            {visible.map((item) => (
              <SiteRow key={item.id} item={item} kpi={kpi.id} selected={item.id === site.id} onPick={() => setSiteId(item.id)} />
            ))}
          </ul>
          <article className={recovery ? 'gov-consequence is-hot' : 'gov-consequence'}>
            <h3>{recovery ? 'Consequence' : 'What happens next'}</h3>
            <p>
              {recovery
                ? `${causeFor(site, kpi.id)} Because this is the second red week, the recovery plan is due in five days and goes to the executives.`
                : kpiTone(latestReading(site), kpi.id) === 'fail'
                  ? `${causeFor(site, kpi.id)} One red week is a review. A second red week becomes a recovery plan.`
                  : 'Nothing is escalated. The number is measured again next week.'}
            </p>
          </article>
        </section>

        <section className="gov-loop" aria-label="Closed feedback loop">
          <h2>The loop</h2>
          <ol>
            {LOOP.map((item, index) => (
              <li key={item.id} className={item.id === step ? 'is-on' : ''}>
                <span>{index + 1}</span>
                <strong>{item.name}</strong>
                <em>{item.plain}</em>
              </li>
            ))}
          </ol>
          <p>A metric that is red for two weeks in a row does not wait for the monthly meeting. The recovery plan is due in five days.</p>
        </section>
      </div>
    </div>
  )
}

function SiteRow({
  item,
  kpi,
  selected,
  onPick,
}: {
  item: GovSite
  kpi: KpiId
  selected: boolean
  onPick: () => void
}) {
  const row = tones(item, kpi)
  const latest = kpiTone(latestReading(item), kpi)
  return (
    <li>
      <button type="button" className={selected ? 'is-on' : ''} onClick={onPick}>
        <span>
          <strong>{item.name}</strong>
          <em>{item.region}</em>
        </span>
        <span className="gov-dots" aria-hidden>
          {row.map((tone, index) => (
            <i key={GOV_WEEKS[index]} className={tone === 'pass' ? 'is-pass' : 'is-fail'} title={weekLabel(GOV_WEEKS[index]!)} />
          ))}
        </span>
        <b className={latest === 'pass' ? 'is-pass' : 'is-fail'}>{valueLine(latestReading(item), kpi)}</b>
      </button>
    </li>
  )
}
