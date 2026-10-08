import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ANOMALY,
  CERTIFIED,
  FEEDS,
  HYGIENE,
  METRICS,
  PERSON,
  STAGES,
  WORKED_HOURS,
  feedTone,
  gapRatio,
  hoursAgree,
  type Feed,
  type MetricId,
  type StageId,
} from '../planner/certifiedData'

export function CertifiedDataPage() {
  const [stageId, setStageId] = useState<StageId>('ingest')
  const [feedId, setFeedId] = useState('acd')
  const [hygieneId, setHygieneId] = useState<(typeof HYGIENE)[number]['id']>('reconcile')
  const [metricId, setMetricId] = useState<MetricId>('aht')
  const stage = STAGES.find((item) => item.id === stageId) ?? STAGES[0]!
  const selected = FEEDS.find((item) => item.id === feedId) ?? FEEDS[0]!
  const hygiene = HYGIENE.find((item) => item.id === hygieneId) ?? HYGIENE[2]!
  const metric = METRICS.find((item) => item.id === metricId) ?? METRICS[1]!

  return (
    <div className="cert-page">
      <div className="cert-frame">
        <header className="cert-hero">
          <div>
            <p className="cert-kicker">Certified data</p>
            <h1>One number, from the source to the screen.</h1>
            <p className="cert-lead">
              No one pastes a private extract into a deck. A feed is loaded, checked, and only then allowed onto the dashboard.
            </p>
          </div>
          <Link className="cert-back" to="/">Main page</Link>
        </header>

        <p className="cert-plain" role="status">{stage.plain}</p>

        <ol className="cert-pipe" aria-label="Data path">
          {STAGES.map((item, index) => (
            <li key={item.id}>
              {index > 0 ? <span className="cert-arrow" aria-hidden>→</span> : null}
              <button type="button" className={item.id === stage.id ? 'is-on' : ''} onClick={() => setStageId(item.id)}>
                <em>{index + 1}</em>
                <strong>{item.name}</strong>
              </button>
            </li>
          ))}
        </ol>

        <section className="cert-stage">
          <h2>{stage.name}</h2>
          <ul>
            {stage.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </section>

        {stage.id === 'sources' || stage.id === 'ingest' ? (
          <FeedList selected={selected} onPick={setFeedId} />
        ) : null}
        {stage.id === 'platform' ? <PersonCard /> : null}
        {stage.id === 'semantic' ? (
          <section className="cert-metrics" aria-label="Metric dictionary">
            {METRICS.map((item) => (
              <button key={item.id} type="button" className={item.id === metric.id ? 'is-on' : ''} onClick={() => setMetricId(item.id)}>
                <strong>{item.name}</strong>
                <span>{item.id === metric.id ? item.definition : 'Defined once'}</span>
              </button>
            ))}
          </section>
        ) : null}
        {stage.id === 'dashboards' ? <SameNumber /> : null}

        <section className="cert-hours" aria-label="Worked hours reconciliation">
          <div className="cert-head">
            <h2>Worked hours must agree</h2>
            <p>Workforce hours, phone-switch hours, and payroll hours. A gap wider than 1% is not certified.</p>
          </div>
          <div className="cert-hours__table" role="table">
            <div className="cert-hours__row cert-hours__row--head" role="row">
              <span>Site</span>
              <span>Workforce</span>
              <span>Phone switch</span>
              <span>Payroll</span>
              <span>Result</span>
            </div>
            {WORKED_HOURS.map((row) => {
              const ok = hoursAgree(row)
              return (
                <div key={row.site} className="cert-hours__row" role="row">
                  <strong>{row.site}</strong>
                  <span>{row.wfm.toLocaleString('en-US')}</span>
                  <span>{cell(row.wfm, row.acd)}</span>
                  <span>{cell(row.wfm, row.payroll)}</span>
                  <b className={ok ? 'is-pass' : 'is-fail'}>{ok ? 'Certified' : 'Held'}</b>
                </div>
              )
            })}
          </div>
        </section>

        <section className="cert-hygiene" aria-label="How the number stays clean">
          <h2>How the number stays clean</h2>
          <div className="cert-hygiene__list">
            {HYGIENE.map((item) => (
              <button key={item.id} type="button" className={item.id === hygiene.id ? 'is-on' : ''} onClick={() => setHygieneId(item.id)}>
                {item.name}
              </button>
            ))}
          </div>
          <p>{hygiene.plain}</p>
        </section>

        <section className="cert-anomaly">
          <p className="cert-kicker">Held out of the forecast</p>
          <h2>{ANOMALY.site}, {ANOMALY.when}</h2>
          <p>
            {ANOMALY.offered.toLocaleString('en-US')} contacts offered. A normal hour here is about {ANOMALY.usual.toLocaleString('en-US')}. {ANOMALY.plain} Inquiry {ANOMALY.inquiry}.
          </p>
        </section>
      </div>
    </div>
  )
}

function FeedList({ selected, onPick }: { selected: Feed; onPick: (id: string) => void }) {
  return (
    <section className="cert-feeds" aria-label="Feeds">
      <ul>
        {FEEDS.map((item) => (
          <li key={item.id}>
            <button type="button" className={item.id === selected.id ? 'is-on' : ''} onClick={() => onPick(item.id)}>
              <strong>{item.source}</strong>
              <span>{item.what}</span>
              <em className={`is-${item.status}`}>{item.status === 'on-time' ? 'On time' : item.status === 'late' ? 'Late' : 'Failed'}</em>
            </button>
          </li>
        ))}
      </ul>
      <article>
        <p className="cert-kicker">{selected.owner}</p>
        <h2>{selected.source}</h2>
        <p>{selected.what}. {selected.how}. Freshness promise: {selected.sla}. Last sign of life: {selected.age}.</p>
        <p>{feedTone(selected.status)} {selected.note}</p>
      </article>
    </section>
  )
}

function PersonCard() {
  return (
    <section className="cert-person" aria-label="Master data">
      <div>
        <p className="cert-kicker">{PERSON.site}</p>
        <h2>{PERSON.name}</h2>
        <p>One person in four systems. The certified ID is {PERSON.id}.</p>
      </div>
      <ul>
        {PERSON.maps.map((item) => (
          <li key={item.system}>
            <span>{item.system}</span>
            <strong>{item.value}</strong>
          </li>
        ))}
      </ul>
    </section>
  )
}

function SameNumber() {
  return (
    <section className="cert-same">
      <p className="cert-kicker">Same table</p>
      <h2>{CERTIFIED.site}, week of {CERTIFIED.week}</h2>
      <p>
        {CERTIFIED.contacts.toLocaleString('en-US')} contacts. Service level {Math.round(CERTIFIED.serviceLevel * 1000) / 10}%. Handle time {CERTIFIED.aht} seconds. The executive screen and the site screen both read this row. Hyderabad and Tampa are not on it this week.
      </p>
    </section>
  )
}

function cell(base: number, other: number | null): string {
  if (other == null) return 'Missing'
  const gap = gapRatio(base, other)
  const pct = gap == null ? '' : ` · ${(gap * 100).toFixed(1)}%`
  return `${other.toLocaleString('en-US')}${pct}`
}
