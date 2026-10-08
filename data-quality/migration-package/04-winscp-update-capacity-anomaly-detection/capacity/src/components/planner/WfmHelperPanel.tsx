import { useMemo, useState } from 'react'

type ToolId = 'glossary' | 'calculator' | 'quickref'

const GLOSSARY: Array<{ term: string; definition: string }> = [
  {
    term: 'Offered Volume',
    definition:
      'Contacts offered to the queue (calls, chats, emails). In Staffing Plan Actuals this is the Offered / Call Volume driver used as forecast input.',
  },
  {
    term: 'Forecast Volume',
    definition:
      'Predicted offered volume for future weeks. Applied forecasts write into Planned call volume on the Staffing Plan matrix.',
  },
  {
    term: 'AHT (Average Handle Time)',
    definition: 'Average handle time in seconds for a contact. Drives Required Production FTE with volume and occupancy.',
  },
  {
    term: 'Occupancy',
    definition: 'Share of logged-in time spent handling contacts. Higher occupancy lowers Required FTE for the same volume.',
  },
  {
    term: 'Shrinkage',
    definition:
      'Non-productive time as a % of scheduled time (OOO + in-office). Production FTE = Production HC × (1 − Shrinkage) + nesting productive FTE.',
  },
  {
    term: 'Absenteeism',
    definition: 'Out-of-office absence categories (often unpaid). Tracked apart from in-office shrinkage in Leakage and DBE.',
  },
  {
    term: 'Required Production FTE',
    definition: 'Staffing needed to handle forecast volume at planned AHT and occupancy (channel-aware).',
  },
  {
    term: 'Production HC',
    definition: 'Headcount on production. Roll-forward: beginning + graduates + transfer in − attrition − transfer out − LOA.',
  },
  {
    term: 'MAPE / RMSE / MAE',
    definition:
      'Forecast error measures. MAPE = mean absolute % error; RMSE = root mean squared error; MAE = mean absolute error. Best-fit uses lowest MAPE.',
  },
  {
    term: 'Erlang C',
    definition:
      'Classic voice staffing model relating agents, volume, AHT, and service level. Useful for voice Required FTE sense-checks.',
  },
  {
    term: 'Service Level',
    definition: 'Share of contacts answered within a target speed-of-answer (e.g. 80/20).',
  },
  {
    term: 'Day-of-week trend',
    definition:
      'Recurring weekday pattern (e.g. Sat/Sun low). Detected from daily history and preserved when aggregating to weekly volume.',
  },
]

function erlangCAgents(options: {
  callsPerHour: number
  ahtSeconds: number
  targetAnswerSeconds: number
  serviceLevelPct: number
}): number | null {
  const { callsPerHour, ahtSeconds, targetAnswerSeconds, serviceLevelPct } = options
  if (!(callsPerHour > 0 && ahtSeconds > 0 && targetAnswerSeconds > 0 && serviceLevelPct > 0)) return null
  const traffic = (callsPerHour * ahtSeconds) / 3600
  if (!(traffic > 0)) return null
  const targetSl = Math.min(0.999, serviceLevelPct / 100)
  let agents = Math.max(1, Math.ceil(traffic + 1))
  for (let guard = 0; guard < 500; guard++) {
    // Erlang C probability of wait
    let sum = 0
    let term = 1
    for (let k = 0; k < agents; k++) {
      term = k === 0 ? 1 : (term * traffic) / k
      sum += term
    }
    const last = (term * traffic) / agents
    const erlangC = last / (sum * (1 - traffic / agents) + last)
    const serviceLevel =
      1 - erlangC * Math.exp(-Math.max(0, agents - traffic) * (targetAnswerSeconds / ahtSeconds))
    if (serviceLevel >= targetSl) return agents
    agents += 1
  }
  return agents
}

type Props = {
  onClose: () => void
}

export function WfmHelperPanel({ onClose }: Props) {
  const [tool, setTool] = useState<ToolId>('glossary')
  const [query, setQuery] = useState('')
  const [callsPerHour, setCallsPerHour] = useState('120')
  const [ahtSeconds, setAhtSeconds] = useState('240')
  const [targetAnswer, setTargetAnswer] = useState('20')
  const [serviceLevel, setServiceLevel] = useState('80')
  const [occPct, setOccPct] = useState('85')
  const [shrinkPct, setShrinkPct] = useState('30')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return GLOSSARY
    return GLOSSARY.filter(
      (item) => item.term.toLowerCase().includes(q) || item.definition.toLowerCase().includes(q),
    )
  }, [query])

  const erlangAgents = useMemo(
    () =>
      erlangCAgents({
        callsPerHour: Number(callsPerHour),
        ahtSeconds: Number(ahtSeconds),
        targetAnswerSeconds: Number(targetAnswer),
        serviceLevelPct: Number(serviceLevel),
      }),
    [callsPerHour, ahtSeconds, targetAnswer, serviceLevel],
  )

  const requiredFteSense = useMemo(() => {
    const calls = Number(callsPerHour)
    const aht = Number(ahtSeconds)
    const occ = Number(occPct) / 100
    if (!(calls > 0 && aht > 0 && occ > 0 && occ < 1)) return null
    // Hours of work per hour / occupancy ≈ agents (productive)
    return (calls * aht) / 3600 / occ
  }, [callsPerHour, ahtSeconds, occPct])

  const paidFteSense = useMemo(() => {
    if (requiredFteSense == null) return null
    const shrink = Number(shrinkPct) / 100
    if (!(shrink >= 0 && shrink < 1)) return null
    return requiredFteSense / (1 - shrink)
  }, [requiredFteSense, shrinkPct])

  return (
    <section className="cap-panel cap-wfm-helper">
      <div className="cap-wfm-helper__head">
        <div>
          <p className="cap-volume-forecast__eyebrow">WFM Helper</p>
          <h3 className="cap-panel__title">Glossary &amp; tools</h3>
          <p className="cap-panel__desc">
            Quick definitions and calculators for WFM professionals working the Staffing Plan.
          </p>
        </div>
        <button type="button" className="saas-btn saas-btn--ghost" onClick={onClose}>
          Hide helper
        </button>
      </div>

      <div className="cap-wfm-helper__tabs" role="tablist" aria-label="WFM Helper tools">
        {(
          [
            ['glossary', 'Glossary'],
            ['calculator', 'Calculator'],
            ['quickref', 'Quick ref'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tool === id}
            className={`cap-wfm-helper__tab${tool === id ? ' is-active' : ''}`}
            onClick={() => setTool(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tool === 'glossary' ? (
        <div className="cap-wfm-helper__body">
          <label className="cap-volume-forecast__field">
            <span>Search terms</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="e.g. shrinkage, MAPE, occupancy"
            />
          </label>
          <dl className="cap-wfm-helper__glossary">
            {filtered.map((item) => (
              <div key={item.term} className="cap-wfm-helper__glossary-item">
                <dt>{item.term}</dt>
                <dd>{item.definition}</dd>
              </div>
            ))}
            {!filtered.length ? <p className="cap-dbe__empty">No matching terms.</p> : null}
          </dl>
        </div>
      ) : null}

      {tool === 'calculator' ? (
        <div className="cap-wfm-helper__body">
          <div className="cap-wfm-helper__calc-grid">
            <label className="cap-volume-forecast__field">
              <span>Calls / hour</span>
              <input value={callsPerHour} onChange={(e) => setCallsPerHour(e.target.value)} inputMode="decimal" />
            </label>
            <label className="cap-volume-forecast__field">
              <span>AHT (seconds)</span>
              <input value={ahtSeconds} onChange={(e) => setAhtSeconds(e.target.value)} inputMode="decimal" />
            </label>
            <label className="cap-volume-forecast__field">
              <span>Target answer (sec)</span>
              <input value={targetAnswer} onChange={(e) => setTargetAnswer(e.target.value)} inputMode="decimal" />
            </label>
            <label className="cap-volume-forecast__field">
              <span>Service level %</span>
              <input value={serviceLevel} onChange={(e) => setServiceLevel(e.target.value)} inputMode="decimal" />
            </label>
            <label className="cap-volume-forecast__field">
              <span>Occupancy %</span>
              <input value={occPct} onChange={(e) => setOccPct(e.target.value)} inputMode="decimal" />
            </label>
            <label className="cap-volume-forecast__field">
              <span>Shrinkage %</span>
              <input value={shrinkPct} onChange={(e) => setShrinkPct(e.target.value)} inputMode="decimal" />
            </label>
          </div>
          <div className="cap-wfm-helper__calc-results">
            <article>
              <span>Erlang C agents (approx.)</span>
              <strong>{erlangAgents != null ? erlangAgents : '—'}</strong>
            </article>
            <article>
              <span>Required productive FTE (vol×AHT÷occ)</span>
              <strong>{requiredFteSense != null ? requiredFteSense.toFixed(2) : '—'}</strong>
            </article>
            <article>
              <span>Paid FTE (÷ 1 − shrinkage)</span>
              <strong>{paidFteSense != null ? paidFteSense.toFixed(2) : '—'}</strong>
            </article>
          </div>
          <p className="saas-muted m-0">
            Sense-check only — Staffing Plan Required Production FTE uses the plan’s channel rules and
            weekly drivers.
          </p>
        </div>
      ) : null}

      {tool === 'quickref' ? (
        <div className="cap-wfm-helper__body">
          <ul className="cap-wfm-helper__quickref">
            <li>
              <strong>Forecasting flow:</strong> Anomaly Detection → Offered Volume history → models
              (MAPE/RMSE/MAE) → best fit → Apply / Download Forecast Volume.
            </li>
            <li>
              <strong>Upload grains:</strong> Daily (DOW + weekly aggregate), Weekly, or Monthly
              (split across weeks in the month).
            </li>
            <li>
              <strong>Leakage:</strong> Attrition HC gap and Not Billable in-office shrinkage (Break
              included when Not Billable).
            </li>
            <li>
              <strong>DBE link:</strong> Match Client · Location · Project Code to pull Planned
              Production HC into Financial Summary.
            </li>
          </ul>
        </div>
      ) : null}
    </section>
  )
}
