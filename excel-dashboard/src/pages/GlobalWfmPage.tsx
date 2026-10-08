import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CALCULATOR_DEFAULTS,
  GAPS,
  SOP_DOCUMENT,
  SOP_EXCEPTION,
  SOP_FINDING,
  SOP_PROCESSES,
  STANDARD_SHARE,
  TOOLS,
  localShare,
  monthlyCost,
  requiredFte,
  seatDemand,
  type GapId,
  type SopProcessId,
  type ToolId,
} from '../planner/globalWfm'

export function GlobalWfmPage() {
  const [gapId, setGapId] = useState<GapId>('process')
  const [toolId, setToolId] = useState<ToolId>('sop')
  const [processId, setProcessId] = useState<SopProcessId>('forecast')
  const [contacts, setContacts] = useState(CALCULATOR_DEFAULTS.weeklyContacts)
  const [aht, setAht] = useState(CALCULATOR_DEFAULTS.ahtSeconds)
  const [shrink, setShrink] = useState(CALCULATOR_DEFAULTS.shrinkage)
  const gap = GAPS.find((item) => item.id === gapId) ?? GAPS[0]!
  const tool = TOOLS.find((item) => item.id === toolId) ?? TOOLS[0]!
  const process = SOP_PROCESSES.find((item) => item.id === processId) ?? SOP_PROCESSES[0]!
  const math = useMemo(() => {
    const fte = requiredFte(contacts, aht, shrink)
    const seats = seatDemand(fte, CALCULATOR_DEFAULTS.onsiteShare, CALCULATOR_DEFAULTS.peakShare)
    return {
      fte,
      seats,
      cost: monthlyCost(fte, CALCULATOR_DEFAULTS.monthlyRate),
    }
  }, [contacts, aht, shrink])

  function chooseGap(next: GapId) {
    setGapId(next)
    const match = GAPS.find((item) => item.id === next)
    const firstTool = match?.tools[0]
    if (firstTool) setToolId(firstTool)
  }

  return (
    <div className="gwfm-page">
      <div className="gwfm-frame">
        <header className="gwfm-hero">
          <div>
            <p className="gwfm-kicker">One global WFM</p>
            <h1>Fourteen operating models. One way of working.</h1>
            <p className="gwfm-lead">
              The work we inherit is local and uneven. In twelve months, most of it follows one blueprint. The tools below are how that blueprint is actually run.
            </p>
          </div>
          <Link className="gwfm-back" to="/">Main page</Link>
        </header>

        <p className="gwfm-plain" role="status">{gap.today} {gap.year}</p>

        <section className="gwfm-split" aria-label="From today to twelve months">
          <div>
            <p className="gwfm-kicker">What we inherit</p>
            <ul>
              {GAPS.map((item) => (
                <li key={item.id}>
                  <button type="button" className={item.id === gapId ? 'is-on' : ''} onClick={() => chooseGap(item.id)}>
                    <strong>{item.inheritTitle}</strong>
                    <span>{item.inherit}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="gwfm-good">
            <p className="gwfm-kicker">What good looks like in 12 months</p>
            <h2>{gap.goodTitle}</h2>
            <p>{gap.good}</p>
            <b>{gap.mark}</b>
          </div>
        </section>

        <section className="gwfm-tools" aria-label="Tools">
          <div className="gwfm-tools__head">
            <h2>The tools</h2>
            <p>Global SOP sits with the planning tools. It is the rule the others follow.</p>
          </div>
          <div className="gwfm-tool-row" role="tablist">
            {TOOLS.map((item) => (
              <button key={item.id} type="button" className={item.id === toolId ? 'is-on' : ''} onClick={() => setToolId(item.id)}>
                <em>{item.mark}</em>
                <strong>{item.label}</strong>
              </button>
            ))}
          </div>
          <article className="gwfm-panel">
            <h3>{tool.label}</h3>
            <p>{tool.line}</p>
            {toolId === 'sop' ? (
              <div className="gwfm-sop">
                <header className="gwfm-doc">
                  <p className="gwfm-kicker">{SOP_DOCUMENT.code} · {SOP_DOCUMENT.status}</p>
                  <h3>{SOP_DOCUMENT.title}</h3>
                  <p>{SOP_DOCUMENT.scope}</p>
                </header>
                <p className="gwfm-finding">{SOP_FINDING}</p>
                <p className="gwfm-share">
                  <strong>{Math.round(STANDARD_SHARE * 100)}% standard</strong>
                  <span>{Math.round(localShare() * 100)}% local, and only when the exception is written</span>
                </p>
                <div className="gwfm-chapters" role="tablist" aria-label="SOP processes">
                  {SOP_PROCESSES.map((item) => (
                    <button key={item.id} type="button" role="tab" aria-selected={item.id === processId} className={item.id === processId ? 'is-on' : ''} onClick={() => setProcessId(item.id)}>
                      {item.title}
                    </button>
                  ))}
                </div>
                <section className="gwfm-process" aria-label={process.title}>
                  <p className="gwfm-spread">{process.spread}</p>
                  <div className="gwfm-rule">
                    <p><b>The gap.</b> {process.gap}</p>
                    <p><b>The standard.</b> {process.standard}</p>
                    <p><b>Local.</b> {process.local}</p>
                  </div>
                  <div className="gwfm-table-wrap">
                    <table className="gwfm-table">
                      <caption>How {process.title.toLowerCase()} differs today</caption>
                      <thead>
                        <tr>
                          <th scope="col">Site</th>
                          <th scope="col">Region</th>
                          <th scope="col">Model</th>
                          <th scope="col">How it is done today</th>
                          <th scope="col">Variance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {process.rows.map((row) => (
                          <tr key={`${process.id}-${row.site}`}>
                            <th scope="row">{row.site}</th>
                            <td>{row.region}</td>
                            <td>{row.model}</td>
                            <td>{row.today}</td>
                            <td>{row.variance}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
                <aside>
                  <p className="gwfm-kicker">Sample exception</p>
                  <h3>{SOP_EXCEPTION.title}</h3>
                  <p>{SOP_EXCEPTION.rule}</p>
                  <p>{SOP_EXCEPTION.exception}</p>
                </aside>
              </div>
            ) : null}
            {toolId === 'calculator' ? (
              <div className="gwfm-calc">
                <label>
                  Weekly contacts
                  <input type="range" min={20000} max={80000} step={500} value={contacts} onChange={(event) => setContacts(Number(event.target.value))} />
                  <b>{contacts.toLocaleString('en-US')}</b>
                </label>
                <label>
                  Handle time, seconds
                  <input type="range" min={180} max={720} step={5} value={aht} onChange={(event) => setAht(Number(event.target.value))} />
                  <b>{aht}</b>
                </label>
                <label>
                  Shrinkage
                  <input type="range" min={0.1} max={0.45} step={0.01} value={shrink} onChange={(event) => setShrink(Number(event.target.value))} />
                  <b>{Math.round(shrink * 100)}%</b>
                </label>
                <dl>
                  <div><dt>Required FTE</dt><dd>{math.fte.toFixed(1)}</dd></div>
                  <div><dt>Seat demand</dt><dd>{math.seats.toFixed(1)}</dd></div>
                  <div><dt>Monthly cost</dt><dd>${math.cost.toLocaleString('en-US')}</dd></div>
                </dl>
                <p>86% of the FTE is onsite and takes a seat. 60% of that onsite group is the peak. One support seat is added for every 12 onsite agents. Cost uses a sample rate of $1,850 per FTE each month.</p>
              </div>
            ) : null}
            {toolId === 'capacity' ? (
              <p className="gwfm-note">Manila voice, this week: 42,000 contacts, 410 seconds, 28% shrinkage. That is 166.1 FTE, 97.6 seats at the peak, and $307,263 for the month. TA hires to the FTE. The site confirms the seats. Finance sees the same cost. The review is the first Monday.</p>
            ) : null}
            {toolId === 'forecast' ? (
              <p className="gwfm-note">Week of 4 October, voice: 186,420 contacts offered, forecast 184,900, accuracy off by 0.8%. The method is named on the plan. A point that breaks the pattern is held out until someone checks it.</p>
            ) : null}
            {toolId === 'quality' ? (
              <p className="gwfm-note">Hyderabad, week of 4 October: WFM hours 28,110, ACD hours 26,840. They disagree by more than 1%, so the week stays held. It does not become the number an executive reads.</p>
            ) : null}
          </article>
        </section>
      </div>
    </div>
  )
}
