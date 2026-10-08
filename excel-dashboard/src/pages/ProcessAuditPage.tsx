import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CONFLICTS,
  PHASES,
  PRACTICES,
  REGIONS,
  SITES,
  WAVES,
  bestRegion,
  methodFor,
  plainCell,
  regionScore,
  scoreBand,
  sitesIn,
  varianceCost,
  type PhaseId,
  type Practice,
  type Region,
} from '../planner/processAudit'

type Cell = { region: Region; practice: Practice }

export function ProcessAuditPage() {
  const [phase, setPhase] = useState<PhaseId>('diagnose')
  const [cell, setCell] = useState<Cell>({ region: 'India', practice: 'Capacity' })
  const [conflictId, setConflictId] = useState(CONFLICTS[0]!.id)
  const [waveId, setWaveId] = useState(WAVES[0]!.id)
  const activePhase = PHASES.find((item) => item.id === phase) ?? PHASES[0]!
  const conflict = CONFLICTS.find((item) => item.id === conflictId) ?? CONFLICTS[0]!
  const wave = WAVES.find((item) => item.id === waveId) ?? WAVES[0]!
  const sites = sitesIn(cell.region)
  const score = regionScore(cell.region, cell.practice)
  const best = bestRegion(cell.practice)
  const weakCost = useMemo(() => {
    return sites
      .filter((item) => item.scores[cell.practice] <= 2)
      .map((item) => ({ site: item, cost: varianceCost(item.agents, item.scores[cell.practice]) }))
  }, [sites, cell.practice])

  return (
    <div className="audit-page">
      <div className="audit-frame">
        <header className="audit-hero">
          <div>
            <p className="audit-kicker">Process audit</p>
            <h1>Audit locally. Then use one way of working.</h1>
            <p className="audit-lead">
              Fourteen sites do the same five jobs in different ways. Score them, keep the method that works, and roll that out in waves.
            </p>
          </div>
          <Link className="audit-back" to="/">Main page</Link>
        </header>

        <p className="audit-plain" role="status">
          {phase === 'deploy'
            ? wave.plain
            : phase === 'reconcile'
              ? plainCell(cell.region, cell.practice)
              : activePhase.plain}
        </p>

        <ol className="audit-phases">
          {PHASES.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={item.id === phase ? 'is-on' : ''}
                onClick={() => setPhase(item.id)}
              >
                <span>{item.n}</span>
                <strong>{item.title}</strong>
                <em>{item.when}</em>
              </button>
            </li>
          ))}
        </ol>

        <section className="audit-phase-card">
          <h2>{activePhase.title}</h2>
          <ul>
            {activePhase.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </section>

        {phase === 'discover' ? <DiscoverGrid /> : null}
        {phase === 'deploy' ? <WavePicker waveId={waveId} onPick={setWaveId} /> : null}

        <section className="audit-board" aria-label="Maturity heatmap">
          <div className="audit-board__head">
            <div>
              <h2>Where each region stands</h2>
              <p>Click a cell. Green is worth copying. Red and orange need the fix first.</p>
            </div>
            <ul className="audit-legend">
              <li><i className="is-strong" /> 4–5 Copy this</li>
              <li><i className="is-steady" /> 3 Good enough</li>
              <li><i className="is-weak" /> 1–2 Fix first</li>
            </ul>
          </div>
          <div className="audit-heat" role="grid" aria-label="Scores by practice and region">
            <div />
            {REGIONS.map((region) => (
              <div key={region} className="audit-heat__col" role="columnheader">{region}</div>
            ))}
            {PRACTICES.map((practice) => (
              <PracticeRow
                key={practice}
                practice={practice}
                selected={cell}
                onPick={(region) => {
                  setCell({ region, practice })
                  if (phase === 'discover' || phase === 'deploy') setPhase('diagnose')
                }}
              />
            ))}
          </div>
        </section>

        <section className="audit-detail">
          <div>
            <p className="audit-kicker">{cell.region} · {cell.practice}</p>
            <h2>Score {score} of 5</h2>
            <p>{plainCell(cell.region, cell.practice)}</p>
            {best !== cell.region ? (
              <p className="audit-copy">Copy from <strong>{best}</strong>, which scores {regionScore(best, cell.practice)} on this practice.</p>
            ) : (
              <p className="audit-copy">This is the method the other regions should take.</p>
            )}
          </div>
          <ul className="audit-sites">
            {sites.map((item) => {
              const local = item.scores[cell.practice]
              return (
                <li key={item.id}>
                  <div>
                    <strong>{item.name}</strong>
                    <span>{item.agents.toLocaleString('en-US')} people · {item.tool}</span>
                    <em>{methodFor(cell.practice, local)}</em>
                  </div>
                  <b className={`is-${scoreBand(local)}`}>{local}</b>
                </li>
              )
            })}
          </ul>
          {weakCost.length ? (
            <div className="audit-cost">
              <h3>What the weak scores cost</h3>
              <ul>
                {weakCost.map(({ site, cost }) => (
                  <li key={site.id}>
                    <strong>{site.name}</strong>
                    <span>{cost.extraFte} extra people</span>
                    <span>{Math.round(cost.serviceLevel * 100)}% service</span>
                    <span>${cost.monthlyCostUsd.toLocaleString('en-US')} / month</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="audit-cost audit-cost--quiet">No site in this cell is at a 1 or a 2. There is no repair cost to fund here.</p>
          )}
        </section>

        <section className="audit-rules" aria-label="How conflicts are resolved">
          <div className="audit-board__head">
            <div>
              <h2>When two sites disagree</h2>
              <p>Use the rules in this order. Stop at the first one that decides it.</p>
            </div>
          </div>
          <div className="audit-rule-list">
            {CONFLICTS.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={item.id === conflict.id ? 'is-on' : ''}
                onClick={() => setConflictId(item.id)}
              >
                <span>{index + 1}</span>
                <strong>{item.rule}</strong>
              </button>
            ))}
          </div>
          <article className="audit-case">
            <p className="audit-kicker">{conflict.rule}</p>
            <h3>{conflict.title}</h3>
            <p>{conflict.plain}</p>
            <div className="audit-case__sides">
              <div className={conflict.winner === 'left' ? 'is-win' : ''}>
                <strong>{conflict.left.label}</strong>
                <span>{conflict.left.detail}</span>
              </div>
              <div className={conflict.winner === 'right' ? 'is-win' : ''}>
                <strong>{conflict.right.label}</strong>
                <span>{conflict.right.detail}</span>
              </div>
            </div>
            <p className="audit-because">{conflict.because}</p>
          </article>
        </section>
      </div>
    </div>
  )
}

function PracticeRow({
  practice,
  selected,
  onPick,
}: {
  practice: Practice
  selected: Cell
  onPick: (region: Region) => void
}) {
  return (
    <>
      <div className="audit-heat__row" role="rowheader">{practice}</div>
      {REGIONS.map((region) => {
        const score = regionScore(region, practice)
        const on = selected.region === region && selected.practice === practice
        return (
          <button
            key={region}
            type="button"
            role="gridcell"
            className={`audit-score is-${scoreBand(score)}${on ? ' is-on' : ''}`}
            aria-pressed={on}
            onClick={() => onPick(region)}
          >
            {score}
          </button>
        )
      })}
    </>
  )
}

function DiscoverGrid() {
  return (
    <section className="audit-discover" aria-label="What we collected">
      <h2>What we collected</h2>
      <ul>
        {SITES.map((item) => (
          <li key={item.id}>
            <strong>{item.name}</strong>
            <span>{item.region}</span>
            <span>{item.tool}</span>
            <span>{item.cadence}</span>
            <em>{item.owner}</em>
          </li>
        ))}
      </ul>
    </section>
  )
}

function WavePicker({ waveId, onPick }: { waveId: string; onPick: (id: string) => void }) {
  return (
    <section className="audit-waves" aria-label="Rollout waves">
      {WAVES.map((item) => (
        <button key={item.id} type="button" className={item.id === waveId ? 'is-on' : ''} onClick={() => onPick(item.id)}>
          <em>{item.when}</em>
          <strong>{item.name}</strong>
          <span>{item.sites.join(', ')}</span>
        </button>
      ))}
    </section>
  )
}
