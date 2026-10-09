import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import ReactECharts from 'echarts-for-react'
import { usePlanner } from '../context/PlannerContext'
import type { DerivedCapacityRow } from '../planner/capacityPlanDerived'
import {
  countInactiveProductionRoster,
  deriveCapacityPlanRows,
} from '../planner/capacityPlanDerived'
import { getScenarioAhtOverrides } from '../planner/ahtAnalysisPersistence'
import { DEFAULT_CAPACITY_FORECAST_MODES } from '../planner/capacityMatrixDisplay'
import { loadScenarioForecastModes } from '../planner/capacityForecastModesPersistence'
import { isoDate, resolveCapacityPlanStartWeek, resolveCurrentCalendarWeek } from '../planner/capacityWeekUtils'
import { rosterHeadcountOverrides } from '../planner/rosterMetrics'
import { resolvePlanLocation } from '../planner/planIdentity'
import { scenarioSeatDemand } from '../planner/seatScenario'
import { legacyVaryingSeatCounts, onsiteIsSampleValue, sampleSeatWeek } from '../planner/sampleSeatFill'
import type { WeekCapacityPlanOverride } from '../planner/capacityPlanOverridePersistence'
import type { ScenarioForecastPackage } from '../planner/forecasting'
import type { PlannerScenario } from '../planner/types'
import type { WeeklyLedgerRow } from '../planner/weeklyLedger'
import {
  SHIFT_TARGETS,
  SLIDE_DEFAULTS,
  buildOutlook,
  computeSeatChain,
  deskRatioByModel,
  formatNumber,
  formatPct,
  toCsv,
  type MatrixField,
  type OutlookPoint,
  type SeatChain,
  type SeatLevers,
  type SeatSources,
  type SeatStatus,
  type SeatView,
  type ShiftModel,
  type WeekOutlook,
} from '../planner/seatsInformation'

type WeekSlice = {
  week: string
  label: string
  totalHc: number | null
  volume: number | null
  ahtSeconds: number | null
  occupancy: number | null
  shrinkage: number | null
  productiveHours: number | null
  seatCount: number | null
  supportHc: number | null
  peakRatioPct: number | null
  onsiteHc: number | null
  wahHc: number | null
  demandSeats: number | null
  physicalWeeklyCost: number | null
  virtualWeeklyCost: number | null
}

type Drill = { title: string; rows: Array<{ label: string; value: string }> }

const TEAL = ['#0f766e', '#14b8a6', '#99f6e4']
const INK = '#0f172a'
const MUTED = '#64748b'
const GRID = '#e2e8f0'

const CARDS: Array<{
  id: 'A' | 'B' | 'C' | 'D' | 'E'
  title: string
  formula: string
  note?: string
}> = [
  {
    id: 'A',
    title: 'Required FTE',
    formula: '(Volume × (AHT ÷ 3,600)) ÷ (40 × Occupancy × (1 − Shrinkage))',
  },
  {
    id: 'B',
    title: 'Peak onsite seats',
    formula: 'Onsite HC × (40 ÷ (8 × days open)) × Peak-shift % × (1 + Overlap %) × (1 + 1/Support) × (1 + Buffer)',
    note: 'Seats are sized to the busiest shift, not to headcount. One FTE is 40 hours.',
  },
  {
    id: 'C',
    title: 'Desk ratio',
    formula: 'Onsite HC ÷ Physical seats',
    note: 'Target by site model: 24×7 ≥ 2.3 · two-shift ≥ 1.8 · single-shift ≈ 1.1.',
  },
  {
    id: 'D',
    title: 'Seat utilization',
    formula: '(Onsite HC × 40 × (1 − Shrinkage)) ÷ (Seats × hours open per week)',
    note: 'Green 80–92% · review below 70% or above 95%.',
  },
  {
    id: 'E',
    title: 'Physical vs virtual',
    formula: '(Seat + tech + supervision) ÷ (HC × 40 × Occupancy × (1 − Shrinkage))',
    note: 'Place WAH where it is cheaper and client-approved; cap it by compliance.',
  },
]

export function SeatsInformationPage() {
  const {
    scenarios,
    getScenarioLedger,
    getScenarioForecast,
    getScenarioCapacityPlanOverrides,
    getScenarioRoster,
    getScenarioStageAttritionOverrides,
    fillMissingSeatInputs,
  } = usePlanner()
  const plans = useMemo(() => scenarios.filter((scenario) => !scenario.isBaseline), [scenarios])
  const clients = useMemo(() => unique(plans.map((scenario) => scenario.plan.client)), [plans])
  const [client, setClient] = useState('')
  const [site, setSite] = useState('')
  const [lob, setLob] = useState('all')
  const activeClient = clients.includes(client) ? client : clients[0] ?? ''
  const clientPlans = useMemo(
    () => plans.filter((scenario) => scenario.plan.client === activeClient),
    [plans, activeClient],
  )
  const sites = useMemo(() => unique(clientPlans.map(siteOf)), [clientPlans])
  const [shiftModel, setShiftModel] = useState<ShiftModel>('24x7')
  const [view, setView] = useState<SeatView>('combined')
  const [fromWeek, setFromWeek] = useState('')
  const [toWeek, setToWeek] = useState('')
  const [open, setOpen] = useState<Partial<Record<'A' | 'B' | 'C' | 'D' | 'E', boolean>>>({ B: true })
  const [pins, setPins] = useState<Partial<SeatLevers>>({})
  const [drill, setDrill] = useState<Drill | null>(null)
  const [guideOpen, setGuideOpen] = useState(false)
  const [notes, setNotes] = useState<Record<string, string>>(loadNotes)

  const activeSite = sites.includes(site) ? site : sites[0] ?? ''
  const sitePlans = useMemo(
    () => clientPlans.filter((scenario) => siteOf(scenario) === activeSite),
    [clientPlans, activeSite],
  )
  const lobs = useMemo(() => unique(sitePlans.map(lobOf)), [sitePlans])
  const activeLob = lob === 'all' || lobs.includes(lob) ? lob : 'all'
  const selectedPlans = useMemo(
    () => (activeLob === 'all' ? sitePlans : sitePlans.filter((scenario) => lobOf(scenario) === activeLob)),
    [activeLob, sitePlans],
  )

  const derived = useMemo(() => {
    return selectedPlans.map((scenario) => ({
      scenario,
      rows: safeDerive(
        scenario,
        getScenarioLedger,
        getScenarioForecast,
        getScenarioCapacityPlanOverrides,
        getScenarioRoster,
        getScenarioStageAttritionOverrides,
      ),
    }))
  }, [
    selectedPlans,
    getScenarioLedger,
    getScenarioForecast,
    getScenarioCapacityPlanOverrides,
    getScenarioRoster,
    getScenarioStageAttritionOverrides,
  ])

  const today = isoDate(new Date())
  const weeks = useMemo(() => mergeWeeks(derived), [derived])
  const shortWeeks = weeks.filter(
    (week) => week.seatCount != null && week.demandSeats != null && week.seatCount < week.demandSeats,
  )
  const upcomingShort = shortWeeks.filter((week) => week.week >= today)
  const seatPrompt = upcomingShort.length ? upcomingShort : shortWeeks
  const seatFilled = useRef(new Set<string>())
  useEffect(() => {
    for (const { scenario, rows } of derived) {
      if (!rows.length || seatFilled.current.has(scenario.id)) continue
      const existing = getScenarioCapacityPlanOverrides(scenario.id)
      const patch: Record<string, WeekCapacityPlanOverride> = {}
      const sorted = [...rows].sort((a, b) => a.week.localeCompare(b.week))
      const anchor = sampleSeatWeek(sorted.find((row) => (row.planned.productionHc ?? 0) > 0)?.planned.productionHc ?? 0, 0)
      sorted.forEach((row, index) => {
        const current = existing[row.week] ?? {}
        const sample = sampleSeatWeek(row.planned.productionHc, index)
        if (!sample || !anchor) return
        if (current.peakRatioPct != null && current.peakRatioPct !== sample.peakRatioPct) return
        const knownSeats = new Set([...legacyVaryingSeatCounts(row.planned.productionHc), anchor.seatCount])
        const onsiteIsSample = onsiteIsSampleValue(row.planned.productionHc, index, current.onsiteHc, current.seatCount)
        const seatIsSample = current.seatCount == null || knownSeats.has(current.seatCount)
        if (!onsiteIsSample && !seatIsSample) return
        patch[row.week] = {
          ...(onsiteIsSample ? { onsiteHc: sample.onsiteHc } : {}),
          ...(seatIsSample ? { seatCount: anchor.seatCount } : {}),
          ...(current.wahHc == null ? { wahHc: sample.wahHc } : {}),
          ...(current.peakRatioPct == null ? { peakRatioPct: sample.peakRatioPct } : {}),
          ...(current.supportHc == null ? { supportHc: sample.supportHc } : {}),
        }
      })
      seatFilled.current.add(scenario.id)
      if (Object.keys(patch).length) fillMissingSeatInputs(scenario.id, patch, ['onsiteHc', 'seatCount'])
    }
  }, [derived, fillMissingSeatInputs, getScenarioCapacityPlanOverrides])
  const weekIds = weeks.map((week) => week.week)
  const rangeFrom = weekIds.includes(fromWeek) ? fromWeek : weekIds[0] ?? ''
  const pickedTo = weekIds.includes(toWeek) ? toWeek : weekIds[weekIds.length - 1] ?? ''
  const rangeTo = rangeFrom && pickedTo && pickedTo < rangeFrom ? rangeFrom : pickedTo
  const ranged = weeks.filter((week) => (!rangeFrom || week.week >= rangeFrom) && (!rangeTo || week.week <= rangeTo))
  const fromOptions = weeks.filter((week) => !rangeTo || week.week <= rangeTo)
  const toOptions = weeks.filter((week) => !rangeFrom || week.week >= rangeFrom)
  const focus = ranged[ranged.length - 1] ?? null

  useEffect(() => {
    setPins({})
  }, [activeClient, activeSite, activeLob, rangeFrom, rangeTo])

  const { levers, sources } = useMemo(() => buildLevers(focus, selectedPlans, shiftModel, pins), [focus, selectedPlans, shiftModel, pins])
  const chain = useMemo(() => computeSeatChain(levers), [levers])
  const outlook = useMemo(() => {
    const points: OutlookPoint[] = ranged.flatMap((week) => {
      if (week.totalHc == null) return []
      return [{
        week: week.week,
        label: week.label,
        totalHc: week.totalHc,
        availableSeats: week.seatCount,
        peakRatioPct: week.peakRatioPct,
        supportHc: week.supportHc,
        onsiteHc: week.onsiteHc,
        wahHc: week.wahHc,
        demandSeats: week.demandSeats,
        shrinkage: week.shrinkage ?? undefined,
      }]
    })
    return buildOutlook(levers, points)
  }, [ranged, levers])

  function pin<K extends keyof SeatLevers>(key: K, value: SeatLevers[K]) {
    setPins((current) => ({ ...current, [key]: value }))
  }

  function setOnsite(percent: number) {
    const onsitePct = percent / 100
    setPins((current) => ({ ...current, onsitePct, wahPct: 1 - onsitePct }))
  }

  function setWah(percent: number) {
    const wahPct = percent / 100
    setPins((current) => ({ ...current, wahPct, onsitePct: 1 - wahPct }))
  }

  return (
    <div className="seats-page">
      <header className="seats-hero">
        <h2 className="seats-title">Seats information</h2>
        <div className="seats-hero__actions">
          <button type="button" className="seats-btn seats-btn--ghost" aria-expanded={guideOpen} onClick={() => setGuideOpen((open) => !open)}>
            User guide
          </button>
          <button type="button" className="seats-btn seats-btn--ghost" onClick={() => setPins({})}>
            Reset to matrix
          </button>
          <button
            type="button"
            className="seats-btn"
            onClick={() => downloadCsv(
              toCsv(
                levers,
                chain,
                outlook,
                sources,
                outlook.map((row) => notes[outlookNoteKey(activeClient, activeSite, row.week)] ?? ''),
              ),
              'seats-information.csv',
            )}
          >
            Export
          </button>
        </div>
      </header>

      {guideOpen ? <SeatsGuide onClose={() => setGuideOpen(false)} /> : null}

      <div className="seats-filters">
        <Filter label="From" className="seats-filter--week">
          <select
            value={rangeFrom}
            onChange={(event) => {
              const next = event.target.value
              setFromWeek(next)
              if (rangeTo && next > rangeTo) setToWeek(next)
            }}
          >
            {fromOptions.map((week) => (
              <option key={week.week} value={week.week}>{week.label}</option>
            ))}
            {!weeks.length ? <option value="">No matrix weeks</option> : null}
          </select>
        </Filter>
        <Filter label="To" className="seats-filter--week">
          <select
            value={rangeTo}
            onChange={(event) => {
              const next = event.target.value
              if (rangeFrom && next < rangeFrom) return
              setToWeek(next)
            }}
          >
            {toOptions.map((week) => (
              <option key={week.week} value={week.week}>{week.label}</option>
            ))}
            {!weeks.length ? <option value="">No matrix weeks</option> : null}
          </select>
        </Filter>
        <Filter label="Client">
          <select
            value={activeClient}
            onChange={(event) => {
              setClient(event.target.value)
              setSite('')
              setLob('all')
            }}
          >
            {clients.length ? clients.map((item) => <option key={item} value={item}>{item}</option>) : <option value="">No client</option>}
          </select>
        </Filter>
        <Filter label="Site">
          <select value={activeSite} onChange={(event) => { setSite(event.target.value); setLob('all') }}>
            {sites.length ? sites.map((item) => <option key={item} value={item}>{item}</option>) : <option value="">No site</option>}
          </select>
        </Filter>
        <Filter label="LOB">
          <select value={activeLob} onChange={(event) => setLob(event.target.value)}>
            <option value="all">All LOBs</option>
            {lobs.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </Filter>
        <Filter label="Shift model">
          <select value={shiftModel} onChange={(event) => setShiftModel(event.target.value as ShiftModel)}>
            {(Object.keys(SHIFT_TARGETS) as ShiftModel[]).map((model) => (
              <option key={model} value={model}>{SHIFT_TARGETS[model].label}</option>
            ))}
          </select>
        </Filter>
        <Filter label={`WAH ${formatPct(levers.wahPct)}`}>
          <input type="range" min={0} max={80} value={Math.round(levers.wahPct * 100)} onChange={(event) => setWah(Number(event.target.value))} />
        </Filter>
        <div className="seats-toggle" role="group" aria-label="Seat view">
          {(['combined', 'physical', 'virtual'] as SeatView[]).map((item) => (
            <button key={item} type="button" className={view === item ? 'is-on' : ''} onClick={() => setView(item)}>
              {item === 'combined' ? 'Combined' : item === 'physical' ? 'Physical' : 'Virtual'}
            </button>
          ))}
        </div>
      </div>

      {!focus ? (
        <p className="seats-banner">No Capacity Matrix week is loaded. Cards use the 1,200 headcount worked example until a plan has data.</p>
      ) : null}

      <div className="seats-layout">
        <div className="seats-cards">
          {CARDS.map((card) => (
            <MetricCard
              key={card.id}
              card={card}
              chain={chain}
              levers={levers}
              sources={sources}
              expanded={Boolean(open[card.id])}
              onToggle={() => setOpen((current) => ({ ...current, [card.id]: !current[card.id] }))}
              onPin={pin}
            />
          ))}
        </div>

        <div className="seats-stage">
          <section className="seats-example">
            <div className="seats-example__head">
              <h3>Worked example: {formatNumber(levers.totalHc)} HC line of business, {formatPct(levers.onsitePct)} onsite</h3>
              <p>Agents per shift</p>
            </div>
            <div className="seats-example__grid">
              <ol className="seats-steps">
                <Step label={`Onsite headcount (${formatNumber(levers.totalHc)} × ${formatPct(levers.onsitePct)})`} value={chain.onsiteHc} />
                <Step label={`Scheduled per day (40 ÷ (8 × ${chain.daysOpen}))`} value={chain.scheduledPerDay} />
                <Step label={`Peak shift, ${formatPct(levers.peakShiftPct)} of daily`} value={chain.peakShift} />
                <Step label={`+${formatPct(levers.overlapPct)} shift-change overlap`} value={chain.afterOverlap} />
                <Step label={`+ TL / QA / trainer seats (1:${formatNumber(levers.supportRatio, 0)})`} value={chain.afterSupport} />
                <Step label={`+${formatPct(levers.bufferPct)} contingency buffer`} value={chain.seats} unit="seats" highlight />
              </ol>
              {view !== 'virtual' ? <ShiftBars shifts={chain.shifts} model={levers.shiftModel} onPick={setDrill} /> : <VirtualNote chain={chain} levers={levers} />}
            </div>
            <div className="seats-callout">
              <strong>Desk ratio {formatNumber(chain.deskRatio, 2)} HC per seat</strong> ({formatNumber(chain.onsiteHc)} ÷ {formatNumber(chain.seats)}).
              Planning 1:1 would have requested {formatNumber(chain.onsiteHc)} seats; the shift-based model avoids {formatNumber(Math.max(0, chain.avoidedSeats))} seats for the same service level.
              <span> Each FTE is 40 hours, spread across {chain.daysOpen} open days.</span>
            </div>
          </section>

          <section className="seats-levers" aria-label="What-if levers">
            <h3>What-if</h3>
            <Slider label="Onsite %" value={levers.onsitePct * 100} min={20} max={100} onChange={setOnsite} />
            <Slider label="Peak-shift %" value={levers.peakShiftPct * 100} min={20} max={100} onChange={(value) => pin('peakShiftPct', value / 100)} />
            <Slider label="Overlap %" value={levers.overlapPct * 100} min={0} max={30} onChange={(value) => pin('overlapPct', value / 100)} />
            <Slider label="Shrinkage %" value={levers.shrinkage * 100} min={0} max={40} onChange={(value) => pin('shrinkage', value / 100)} />
            <Slider label="Buffer %" value={levers.bufferPct * 100} min={0} max={20} onChange={(value) => pin('bufferPct', value / 100)} />
          </section>

          <div className="seats-charts">
            {view !== 'virtual' ? (
              <ChartCard title="Agents per shift">
                <ReactECharts
                  style={{ height: 240 }}
                  option={shiftOption(chain)}
                  onEvents={{ click: (params: { name?: string }) => setDrill(shiftDrill(chain, params.name)) }}
                />
              </ChartCard>
            ) : null}
            <ChartCard title="Seat build-up">
              <ReactECharts
                style={{ height: 240 }}
                option={waterfallOption(chain)}
                onEvents={{ click: (params: { name?: string }) => setDrill(waterfallDrill(chain, params.name)) }}
              />
            </ChartCard>
            <ChartCard title={outlook.length === 24 ? '24-week seat outlook' : 'Seat outlook'}>
              <ReactECharts
                style={{ height: 260 }}
                option={outlookOption(outlook, view)}
                onEvents={{ click: (params: { dataIndex?: number }) => setDrill(outlookDrill(outlook, params.dataIndex)) }}
              />
            </ChartCard>
            <ChartCard title="Physical vs virtual seats">
              <ReactECharts
                style={{ height: 240 }}
                option={donutOption(chain, view)}
                onEvents={{ click: (params: { name?: string }) => setDrill(donutDrill(chain, params.name)) }}
              />
            </ChartCard>
            {view !== 'virtual' ? (
              <ChartCard title="Seat utilization">
                <ReactECharts
                  style={{ height: 240 }}
                  option={gaugeOption(chain.utilization)}
                  onEvents={{ click: () => setDrill(utilizationDrill(chain, levers.shiftModel)) }}
                />
              </ChartCard>
            ) : null}
            <ChartCard title="Desk ratio vs target">
              <ReactECharts
                style={{ height: 240 }}
                option={ratioOption(chain.deskRatio)}
                onEvents={{ click: (params: { name?: string }) => setDrill(ratioDrill(chain.deskRatio, params.name)) }}
              />
            </ChartCard>
          </div>

          {drill ? (
            <section className="seats-drill">
              <div className="seats-drill__head">
                <h3>{drill.title}</h3>
                <button type="button" className="seats-btn seats-btn--ghost" onClick={() => setDrill(null)}>Close</button>
              </div>
              <dl>
                {drill.rows.map((row) => (
                  <div key={row.label}>
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : (
            <p className="seats-hint">Click a chart segment to see the seat and headcount detail behind it.</p>
          )}
        </div>
      </div>

      {seatPrompt.length ? (
        <section className="seats-prompt" role="status">
          <p>
            <strong>Additional seats are needed</strong> for {seatPrompt.length} {seatPrompt.length === 1 ? 'week' : 'weeks'}:{' '}
            {seatPrompt.slice(0, 8).map((week) => `${week.label} (${formatNumber((week.demandSeats ?? 0) - (week.seatCount ?? 0), 1)} short)`).join(', ')}
            {seatPrompt.length > 8 ? `, and ${seatPrompt.length - 8} more` : ''}.
          </p>
          <button
            type="button"
            className="seats-btn"
            onClick={() => {
              const first = seatPrompt[0]?.week
              const last = seatPrompt[seatPrompt.length - 1]?.week
              if (first) setFromWeek(first)
              if (last) setToWeek(last)
            }}
          >
            Show these weeks
          </button>
        </section>
      ) : null}

      <OutlookTable
        rows={outlook}
        notes={notes}
        noteKey={(week) => outlookNoteKey(activeClient, activeSite, week)}
        onNote={(week, value) => {
          const key = outlookNoteKey(activeClient, activeSite, week)
          setNotes((current) => {
            const next = { ...current }
            if (!value.trim()) delete next[key]
            else next[key] = value
            saveNotes(next)
            return next
          })
        }}
      />

      <section className="seats-built">
        <p>Built &amp; used</p>
        <h3>Capacity Planning Platform</h3>
        <ul>
          <li>Runs this A–E chain end to end, configured per site and LOB.</li>
          <li>What-if levers: WAH mix, shift staggering, and seat sharing across LOBs.</li>
          <li>The 24-week seat outlook flags gaps before a class starts, along with shrinkage and desk ratio.</li>
        </ul>
      </section>
    </div>
  )
}

function OutlookTable({
  rows,
  notes,
  noteKey,
  onNote,
}: {
  rows: WeekOutlook[]
  notes: Record<string, string>
  noteKey: (week: string) => string
  onNote: (week: string, value: string) => void
}) {
  const flatHc = rows.length > 1 && rows.every((row) => row.totalHc === rows[0]?.totalHc)
  return (
    <section className="seats-outlook">
      <div className="seats-outlook__head">
        <h3>Seat outlook</h3>
        <p>
          Each week uses the Capacity seats rows. Seat demand = (Peak ratio × Onsite HC) + Support HC. Blank Onsite HC, WAH HC, Peak ratio, or Number of seats stays blank. Variance = Number of seats − seat demand.
          {flatHc ? ' These weeks are flat because the staffing plan headcount is flat.' : ''}
          {' '}Variance is available seats minus demand. A negative figure is a shortage.
        </p>
      </div>
      <div className="seats-table-wrap">
        <table className="seats-table">
          <thead>
            <tr>
              <th>Week</th>
              <th>Planned production HC</th>
              <th>Onsite HC</th>
              <th>Onsite %</th>
              <th>WAH HC</th>
              <th>WAH %</th>
              <th>Peak ratio</th>
              <th>Support HC</th>
              <th>Seat demand</th>
              <th>Available seats</th>
              <th>Variance</th>
              <th>Utilization</th>
              <th>Remarks</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((row) => (
              <tr key={row.week} className={row.variance != null && row.variance < 0 ? 'is-short' : undefined}>
                <td>{row.label}</td>
                <td>{formatNumber(row.totalHc)}</td>
                <td>{formatNumber(row.onsiteHc)}</td>
                <td>{row.onsitePct == null ? '—' : formatPct(row.onsitePct)}</td>
                <td>{formatNumber(row.wahHc)}</td>
                <td>{row.wahPct == null ? '—' : formatPct(row.wahPct)}</td>
                <td>{row.peakRatioPct == null ? '—' : formatPct(row.peakRatioPct)}</td>
                <td>{row.supportHc == null ? '—' : formatNumber(row.supportHc)}</td>
                <td>{row.demandSeats == null ? '—' : formatNumber(row.demandSeats, Number.isInteger(Math.round(row.demandSeats * 10) / 10) ? 0 : 1)}</td>
                <td>{row.availableSeats == null ? '—' : formatNumber(row.availableSeats)}</td>
                <td className={row.variance == null ? undefined : row.variance < 0 ? 'is-negative' : 'is-positive'}>
                  {row.variance == null ? '—' : formatVariance(row.variance)}
                </td>
                <td>{row.utilization == null ? '—' : formatPct(row.utilization)}</td>
                <td className="seats-note">
                  <input
                    aria-label={`Remarks for ${row.label}`}
                    value={notes[noteKey(row.week)] ?? ''}
                    placeholder="Note"
                    onChange={(event) => onNote(row.week, event.target.value)}
                  />
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={13}>No staffing-plan weeks in this range.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function SeatsGuide({ onClose }: { onClose: () => void }) {
  return (
    <section className="seats-guide" aria-label="Seats user guide">
      <div className="seats-guide__head">
        <h3>User guide</h3>
        <button type="button" className="seats-btn seats-btn--ghost" onClick={onClose}>Hide</button>
      </div>
      {SEATS_GUIDE.map((section) => (
        <article key={section.title}>
          <h4>{section.title}</h4>
          <p>{section.body}</p>
        </article>
      ))}
    </section>
  )
}

const SEATS_GUIDE = [
  {
    title: 'Seat capacity management',
    body: 'Seats are planned from the staffing plan, not from a single headcount copied across the horizon. Each week uses that week’s Production HC. Filter by client, then site, then LOB. One FTE is 40 hours. Required FTE = (Volume × AHT ÷ 3,600) ÷ (40 × Occupancy × (1 − Shrinkage)). Shrinkage raises the FTE requirement because it reduces the hours a person can handle.',
  },
  {
    title: 'Shift distribution',
    body: 'Onsite headcount is Production HC × onsite %. Those people work 40 hours, spread across the days the site is open (7 for 24×7, 5 for two-shift and single-shift), which gives the average day. 24×7 draws three shifts: the peak share on Shift A, and the rest of the day split 35:20 into Shift B and Shift C. Two-shift draws two: the peak share on Shift A and the remainder on Shift B. Single-shift draws one bar for the whole scheduled day. Overlap, team-lead / QA / trainer seats (1:12), and the buffer are applied only to the peak. Seats are sized to the busiest shift, not to headcount.',
  },
  {
    title: 'Desk ratios',
    body: 'Desk ratio = onsite HC ÷ physical seats. Targets: 24×7 at least 2.3, two-shift at least 1.8, single-shift about 1.1. A ratio above the target means the shift pattern shares seats. A 1:1 plan would buy one seat per onsite person and overstates the floor.',
  },
  {
    title: 'Physical vs virtual, across sites',
    body: 'Physical seats are the peak-shift build-up and sit on the site. Virtual seats are the WAH share of Production HC and do not take a desk. Utilization = (onsite HC × 40 × (1 − shrinkage)) ÷ (physical seats × hours the site is open that week). Green is 80–92%. Cost per productive hour = weekly seat, tech, and supervision cost ÷ (HC × 40 × occupancy × (1 − shrinkage)). Compare that rate for onsite and WAH at each site. Put WAH where it is cheaper and the client has approved it, and keep WAH at or below a 70% compliance cap. Available seats are that week’s Number of seats. Variance = available − demand, and a negative week is a shortage to close before a class starts.',
  },
  {
    title: 'Outlook table',
    body: 'The table lists each staffing-plan week from the selected start week through the selected end week. Dates are the week start, with the year. To cannot be earlier than From. Seat demand = (Peak ratio × Onsite HC) + Support HC. Onsite HC, WAH HC, Peak ratio, and Number of seats are used only when that week has them entered. A blank cell stays blank. Variance = Number of seats − seat demand. Utilization = (Onsite HC × 40 × (1 − shrinkage)) ÷ (Number of seats × hours open), and it stays blank when onsite HC, shrinkage, or seats are blank.',
  },
]

function formatVariance(value: number): string {
  const rounded = Math.round(value)
  if (rounded > 0) return `+${formatNumber(rounded)}`
  if (rounded < 0) return `−${formatNumber(Math.abs(rounded))}`
  return '0'
}

const NOTES_KEY = 'seats-outlook-notes-v1'

function outlookNoteKey(client: string, site: string, week: string): string {
  return `${client}||${site}||${week}`
}

function loadNotes(): Record<string, string> {
  try {
    const raw = localStorage.getItem(NOTES_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const notes: Record<string, string> = {}
    Object.entries(parsed).forEach(([key, value]) => {
      if (typeof value === 'string' && value.trim()) notes[key] = value
    })
    return notes
  } catch {
    return {}
  }
}

function saveNotes(notes: Record<string, string>) {
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes))
}

function MetricCard({
  card,
  chain,
  levers,
  sources,
  expanded,
  onToggle,
  onPin,
}: {
  card: (typeof CARDS)[number]
  chain: SeatChain
  levers: SeatLevers
  sources: SeatSources
  expanded: boolean
  onToggle: () => void
  onPin: <K extends keyof SeatLevers>(key: K, value: SeatLevers[K]) => void
}) {
  const value = cardValue(card.id, chain)
  return (
    <article className={`seats-card seats-card--${chain.statuses[card.id]}`}>
      <button type="button" className="seats-card__toggle" aria-expanded={expanded} onClick={onToggle}>
        <span className="seats-badge">{card.id}</span>
        <span className="seats-card__copy">
          <span className="seats-card__title">{card.title}</span>
          <span className="seats-card__formula">{card.formula}</span>
          {card.note ? <span className="seats-card__note">{card.note}</span> : null}
        </span>
        <span className="seats-card__result">
          <span className={`seats-status seats-status--${chain.statuses[card.id]}`} title={statusLabel(chain.statuses[card.id])} />
          <strong>{value}</strong>
        </span>
      </button>
      {expanded ? (
        <div className="seats-card__panel">
          <ol>
            {stepsFor(card.id, chain, levers).map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <table>
            <thead>
              <tr>
                <th>Input</th>
                <th>Capacity Matrix field</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {fieldsFor(card.id).map((key) => {
                const source = sources[key]
                return (
                  <tr key={key}>
                    <td>{source.label}</td>
                    <td>{source.field ?? 'Not on the matrix'}</td>
                    <td>
                      {source.missing ? <em>Missing</em> : null}
                      <input
                        aria-label={source.label}
                        type="number"
                        value={numberInput(levers, key, chain)}
                        onChange={(event) => applyFieldPin(key, Number(event.target.value), levers.totalHc, onPin)}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </article>
  )
}

function Filter({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={className ? `seats-filter ${className}` : 'seats-filter'}>
      <span>{label}</span>
      {children}
    </label>
  )
}

function Step({ label, value, unit, highlight }: { label: string; value: number; unit?: string; highlight?: boolean }) {
  return (
    <li className={highlight ? 'is-highlight' : ''}>
      <span>{label}</span>
      <strong>{formatNumber(value)}{unit ? ` ${unit}` : ''}</strong>
    </li>
  )
}

function Slider({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <label className="seats-slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} value={Math.round(value)} onChange={(event) => onChange(Number(event.target.value))} />
      <strong>{Math.round(value)}%</strong>
    </label>
  )
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="seats-chart">
      <h3>{title}</h3>
      {children}
    </section>
  )
}

function shiftShareNote(model: ShiftModel): string {
  if (model === 'single-shift') return 'The whole scheduled day is one shift'
  if (model === 'two-shift') return 'Peak shift, then the rest of the day on Shift B'
  return 'Peak, then the remaining day split 35:20'
}

function ShiftBars({ shifts, model, onPick }: { shifts: SeatChain['shifts']; model: ShiftModel; onPick: (drill: Drill) => void }) {
  const max = Math.max(...shifts.map((shift) => shift.agents), 1)
  return (
    <div className="seats-minibars" aria-hidden="false">
      {shifts.map((shift, index) => (
          <button key={shift.name} type="button" onClick={() => onPick({
            title: shift.name,
            rows: [
              { label: 'Agents', value: formatNumber(shift.agents) },
              { label: 'Share of the busiest day', value: shiftShareNote(model) },
            ],
          })}>
          <span style={{ height: `${Math.max(8, (shift.agents / max) * 120)}px`, background: TEAL[index] }} />
          <strong>{formatNumber(shift.agents)}</strong>
          <em>{shift.name}</em>
        </button>
      ))}
    </div>
  )
}

function VirtualNote({ chain, levers }: { chain: SeatChain; levers: SeatLevers }) {
  return (
    <p className="seats-virtual-note">
      Virtual view: {formatNumber(chain.virtualSeats)} WAH agents ({formatPct(levers.wahPct)} of {formatNumber(levers.totalHc)} HC).
      Physical seats stay at {formatNumber(chain.seats)}.
    </p>
  )
}

function cardValue(id: 'A' | 'B' | 'C' | 'D' | 'E', chain: SeatChain): string {
  if (id === 'A') return formatNumber(chain.requiredFte, 1)
  if (id === 'B') return `${formatNumber(chain.seats)} seats`
  if (id === 'C') return formatNumber(chain.deskRatio, 2)
  if (id === 'D') return formatPct(chain.utilization)
  return `${formatNumber(chain.physicalCostPerHour, 2)} vs ${formatNumber(chain.virtualCostPerHour, 2)}`
}

function statusLabel(status: SeatStatus): string {
  if (status === 'green') return 'Inside the target band'
  if (status === 'amber') return 'Review'
  return 'Outside the target band'
}

function stepsFor(id: 'A' | 'B' | 'C' | 'D' | 'E', chain: SeatChain, levers: SeatLevers): string[] {
  if (id === 'A') {
    return [
      `Workload hours = ${formatNumber(levers.volume)} × (${formatNumber(levers.ahtSeconds)} ÷ 3,600) = ${formatNumber(chain.workloadHours, 1)}.`,
      `One FTE can handle 40 × ${formatPct(levers.occupancy)} × (1 − ${formatPct(levers.shrinkage)}) = ${formatNumber(chain.productiveHoursPerFte, 1)} hours.`,
      `Required FTE = ${formatNumber(chain.workloadHours, 1)} ÷ ${formatNumber(chain.productiveHoursPerFte, 1)} = ${formatNumber(chain.requiredFte, 1)}.`,
    ]
  }
  if (id === 'B') {
    const model = SHIFT_TARGETS[levers.shiftModel]
    return [
      `Onsite headcount = ${formatNumber(levers.totalHc)} × ${formatPct(levers.onsitePct)} = ${formatNumber(chain.onsiteHc)}.`,
      `A 40-hour FTE covers ${formatNumber(chain.daysOpen)} open days, so the average day is ${formatNumber(chain.onsiteHc)} × (40 ÷ ${8 * chain.daysOpen}) = ${formatNumber(chain.scheduledPerDay)}.`,
      `Peak shift = ${formatNumber(chain.scheduledPerDay)} × ${formatPct(levers.peakShiftPct)} = ${formatNumber(chain.peakShift)}.`,
      `Overlap ${formatPct(levers.overlapPct)} is applied to the peak, adding ${formatNumber(chain.overlapDelta)} → ${formatNumber(chain.afterOverlap)}.`,
      `Support at 1:${formatNumber(levers.supportRatio, 0)} adds ${formatNumber(chain.supportDelta)} → ${formatNumber(chain.afterSupport)}.`,
      `Buffer ${formatPct(levers.bufferPct)} adds ${formatNumber(chain.bufferDelta)} → ${formatNumber(chain.seats)} seats. ${model.label} is open ${model.openHoursPerDay} hours a day.`,
    ]
  }
  if (id === 'C') {
    return [
      `Desk ratio = ${formatNumber(chain.onsiteHc)} ÷ ${formatNumber(chain.seats)} = ${formatNumber(chain.deskRatio, 2)}.`,
      `Selected model ${SHIFT_TARGETS[levers.shiftModel].label} target is ${SHIFT_TARGETS[levers.shiftModel].target.toFixed(1)}.`,
      'A 1:1 plan would hold one seat per onsite person. The shift model shares seats across the day.',
    ]
  }
  if (id === 'D') {
    const model = SHIFT_TARGETS[levers.shiftModel]
    return [
      `Occupied seat-hours = ${formatNumber(chain.onsiteHc)} × 40 × (1 − ${formatPct(levers.shrinkage)}) = ${formatNumber(chain.occupiedSeatHours, 0)}.`,
      `Seats are open ${model.openHoursPerDay} × ${model.daysOpen} = ${model.openHoursPerDay * model.daysOpen} hours a week, so ${formatNumber(chain.seats)} seats provide ${formatNumber(chain.operatingHours, 0)} hours.`,
      `Utilization = ${formatNumber(chain.occupiedSeatHours, 0)} ÷ ${formatNumber(chain.operatingHours, 0)} = ${formatPct(chain.utilization)}. Green is 80–92%.`,
    ]
  }
  return [
    `Productive hours per FTE = 40 × ${formatPct(levers.occupancy)} × (1 − ${formatPct(levers.shrinkage)}) = ${formatNumber(chain.productiveHoursPerFte, 1)}.`,
    `Physical cost per productive hour = ${formatNumber(levers.physicalWeeklyCost, 0)} ÷ ${formatNumber(chain.physicalProductiveHours, 0)} = ${formatNumber(chain.physicalCostPerHour, 2)}.`,
    `Virtual cost per productive hour = ${formatNumber(levers.virtualWeeklyCost, 0)} ÷ ${formatNumber(chain.virtualProductiveHours, 0)} = ${formatNumber(chain.virtualCostPerHour, 2)}.`,
    `WAH is ${formatPct(levers.wahPct)} (${formatNumber(chain.virtualSeats)} agents). Compliance cap is 70%.`,
  ]
}

function fieldsFor(id: 'A' | 'B' | 'C' | 'D' | 'E'): Array<keyof SeatSources> {
  if (id === 'A') return ['volume', 'ahtSeconds', 'occupancy', 'shrinkage']
  if (id === 'B') return ['totalHc', 'onsitePct', 'peakShiftPct', 'overlapPct', 'bufferPct', 'supportHc']
  if (id === 'C') return ['totalHc', 'seatCount']
  if (id === 'D') return ['productiveHours', 'seatCount']
  return ['physicalCost', 'virtualCost', 'productiveHours', 'wahPct']
}

const FRACTION_FIELDS = new Set<keyof SeatSources>(['onsitePct', 'peakShiftPct', 'overlapPct', 'bufferPct', 'wahPct', 'occupancy', 'shrinkage'])

function numberInput(levers: SeatLevers, key: keyof SeatSources, chain: SeatChain): number {
  if (key === 'seatCount') return levers.matrixSeatCount ?? 0
  if (key === 'supportHc') return levers.supportRatio
  if (key === 'physicalCost') return Math.round(levers.physicalWeeklyCost)
  if (key === 'virtualCost') return Math.round(levers.virtualWeeklyCost)
  if (key === 'productiveHours') return Math.round(levers.productiveHours ?? chain.physicalProductiveHours)
  if (FRACTION_FIELDS.has(key)) return Math.round((levers[key] as number) * 1000) / 10
  const value = levers[key as keyof SeatLevers]
  return typeof value === 'number' ? Math.round(value * 100) / 100 : 0
}

function applyFieldPin(
  key: keyof SeatSources,
  raw: number,
  _totalHc: number,
  onPin: <K extends keyof SeatLevers>(field: K, value: SeatLevers[K]) => void,
) {
  if (!Number.isFinite(raw)) return
  if (key === 'seatCount') {
    onPin('matrixSeatCount', raw)
    return
  }
  if (key === 'supportHc') {
    onPin('supportRatio', Math.max(1, raw))
    return
  }
  if (key === 'physicalCost') {
    onPin('physicalWeeklyCost', raw)
    return
  }
  if (key === 'virtualCost') {
    onPin('virtualWeeklyCost', raw)
    return
  }
  if (FRACTION_FIELDS.has(key)) {
    onPin(key, raw / 100)
    return
  }
  onPin(key as keyof SeatLevers, raw as never)
}

function buildLevers(
  focus: WeekSlice | null,
  plans: PlannerScenario[],
  shiftModel: ShiftModel,
  pins: Partial<SeatLevers>,
): { levers: SeatLevers; sources: SeatSources } {
  const costs = costFromPlans(plans)
  const supportRatio = ratioFromSupport(focus)
  const base: SeatLevers = {
    ...SLIDE_DEFAULTS,
    shiftModel,
    totalHc: focus?.totalHc ?? SLIDE_DEFAULTS.totalHc,
    volume: focus?.volume ?? SLIDE_DEFAULTS.volume,
    ahtSeconds: focus?.ahtSeconds ?? SLIDE_DEFAULTS.ahtSeconds,
    occupancy: focus?.occupancy ?? SLIDE_DEFAULTS.occupancy,
    shrinkage: focus?.shrinkage ?? SLIDE_DEFAULTS.shrinkage,
    productiveHours: null,
    matrixSeatCount: focus?.seatCount ?? null,
    physicalWeeklyCost: focus?.physicalWeeklyCost ?? costs.physical ?? SLIDE_DEFAULTS.physicalWeeklyCost,
    virtualWeeklyCost: focus?.virtualWeeklyCost ?? costs.virtual ?? SLIDE_DEFAULTS.virtualWeeklyCost,
    supportRatio: supportRatio ?? SLIDE_DEFAULTS.supportRatio,
    wahPct: 1 - SLIDE_DEFAULTS.onsitePct,
  }
  const levers = { ...base, ...pins, shiftModel, wahPct: pins.wahPct ?? 1 - (pins.onsitePct ?? base.onsitePct) }
  if (pins.onsitePct != null && pins.wahPct == null) levers.wahPct = 1 - pins.onsitePct
  const field = (present: boolean, name: string | null, label: string): MatrixField => ({
    field: name,
    label,
    missing: !present,
  })
  const sources: SeatSources = {
    totalHc: field(focus?.totalHc != null, 'productionHc', 'Production headcount'),
    volume: field(focus?.volume != null, 'forecastVol', 'Forecast volume'),
    ahtSeconds: field(focus?.ahtSeconds != null, 'plannedAht', 'Planned AHT (seconds)'),
    occupancy: field(focus?.occupancy != null, 'occupancy', 'Occupancy'),
    shrinkage: field(focus?.shrinkage != null, 'plannedShrink', 'Planned shrinkage'),
    productiveHours: field(false, '40 × occupancy × (1 − shrinkage)', 'Productive hours'),
    seatCount: field(focus?.seatCount != null, 'seatCount', 'Physical seat count'),
    supportHc: field(focus?.supportHc != null, 'supportHc', 'Support ratio (1:n)'),
    physicalCost: field(costs.physical != null, 'otherCostUsd + hourlySalaryUsd', 'Seat, tech, and supervision cost'),
    virtualCost: field(costs.virtual != null, 'hourlySalaryUsd', 'Virtual supervision cost'),
    onsitePct: field(false, null, 'Onsite %'),
    peakShiftPct: field(false, null, 'Peak-shift %'),
    overlapPct: field(false, null, 'Overlap %'),
    bufferPct: field(false, null, 'Buffer %'),
    wahPct: field(false, null, 'WAH %'),
  }
  return { levers, sources }
}

function costFromPlans(plans: PlannerScenario[]): { physical: number | null; virtual: number | null } {
  if (!plans.length) return { physical: null, virtual: null }
  const physical = plans.reduce((sum, scenario) => sum + (scenario.assumptions.business.otherCostUsd || 0), 0)
  const virtual = plans.reduce((sum, scenario) => sum + (scenario.assumptions.business.hourlySalaryUsd || 0), 0)
  return {
    physical: physical > 0 ? physical : null,
    virtual: virtual > 0 ? virtual * 40 : null,
  }
}

function ratioFromSupport(focus: WeekSlice | null): number | null {
  if (!focus?.supportHc || !focus.totalHc) return null
  const ratio = focus.totalHc / focus.supportHc
  if (!Number.isFinite(ratio) || ratio < 1) return null
  return Math.round(ratio)
}

function safeDerive(
  scenario: PlannerScenario,
  getScenarioLedger: (id: string) => WeeklyLedgerRow[],
  getScenarioForecast: (id: string, horizonWeeks?: number) => ScenarioForecastPackage | null,
  getScenarioCapacityPlanOverrides: (id: string) => Record<string, WeekCapacityPlanOverride>,
  getScenarioRoster: (id: string) => Parameters<typeof rosterHeadcountOverrides>[0],
  getScenarioStageAttritionOverrides: (id: string) => Parameters<typeof deriveCapacityPlanRows>[7],
): DerivedCapacityRow[] {
  try {
    const roster = getScenarioRoster(scenario.id)
    const planStartWeek = resolveCapacityPlanStartWeek(scenario.plan)
    const currentWeek = resolveCurrentCalendarWeek(scenario.plan.weekStart, scenario.plan.timezone)
    return deriveCapacityPlanRows(
      getScenarioLedger(scenario.id),
      scenario,
      getScenarioForecast(scenario.id, 52),
      getScenarioCapacityPlanOverrides(scenario.id),
      {
        ...DEFAULT_CAPACITY_FORECAST_MODES,
        ...loadScenarioForecastModes(scenario.id),
      },
      countInactiveProductionRoster(roster, currentWeek, scenario.plan.weekStart),
      getScenarioAhtOverrides(scenario.id),
      getScenarioStageAttritionOverrides(scenario.id) ?? undefined,
      undefined,
      rosterHeadcountOverrides(roster, planStartWeek, scenario.plan.client).productionHc,
    )
  } catch {
    return []
  }
}

function mergeWeeks(derived: Array<{ scenario: PlannerScenario; rows: DerivedCapacityRow[] }>): WeekSlice[] {
  const byWeek = new Map<string, WeekSlice[]>()
  derived.forEach(({ scenario, rows }) => {
    const sorted = [...rows].sort((a, b) => a.week.localeCompare(b.week))
    const anchorSeats = sampleSeatWeek(sorted.find((row) => (row.planned.productionHc ?? 0) > 0)?.planned.productionHc ?? 0, 0)?.seatCount ?? null
    sorted.forEach((row, index) => {
      const slice = sliceFromRow(row, scenario, index, anchorSeats)
      const list = byWeek.get(row.week) ?? []
      list.push(slice)
      byWeek.set(row.week, list)
    })
  })
  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, slices]) => combineSlices(week, slices))
}

function sliceFromRow(row: DerivedCapacityRow, scenario: PlannerScenario, weekIndex: number | null, anchorSeats: number | null = null): WeekSlice {
  const planned = row.planned
  const hours = positive(planned.productiveHours)
  const hourly = scenario.assumptions.business.hourlySalaryUsd || 0
  const other = scenario.assumptions.business.otherCostUsd || 0
  const sample = sampleSeatWeek(planned.productionHc, weekIndex)
  const knownSeats = new Set(legacyVaryingSeatCounts(planned.productionHc))
  if (anchorSeats != null) knownSeats.add(anchorSeats)
  const peakIsSample = sample != null && (planned.peakRatioPct == null || planned.peakRatioPct === sample.peakRatioPct)
  const onsiteIsSample = onsiteIsSampleValue(planned.productionHc, weekIndex, planned.onsiteHc, planned.seatCount)
  const seatIsSample = planned.seatCount == null || knownSeats.has(planned.seatCount)
  const onsiteHc = peakIsSample && onsiteIsSample && sample ? sample.onsiteHc : planned.onsiteHc ?? null
  const wahHc = planned.wahHc ?? (peakIsSample ? sample?.wahHc ?? null : null)
  const peakRatioPct = planned.peakRatioPct ?? (peakIsSample ? sample?.peakRatioPct ?? null : null)
  const supportHc = planned.supportHc != null && planned.supportHc > 0 ? planned.supportHc : peakIsSample ? sample?.supportHc ?? planned.supportHc : planned.supportHc
  const seatCount = peakIsSample && seatIsSample ? anchorSeats ?? sample?.seatCount ?? null : planned.seatCount ?? null
  return {
    week: row.week,
    label: weekLabel(row.week),
    totalHc: finiteOrNull(planned.productionHc),
    volume: positive(planned.volume),
    ahtSeconds: positive(planned.ahtSeconds),
    occupancy: unitFraction(planned.occupancy),
    shrinkage: rateOrNull(planned.shrinkagePct),
    productiveHours: hours,
    seatCount: finiteOrNull(seatCount),
    supportHc: finiteOrNull(supportHc),
    peakRatioPct: finiteOrNull(peakRatioPct),
    onsiteHc: finiteOrNull(onsiteHc),
    wahHc: finiteOrNull(wahHc),
    demandSeats: scenarioSeatDemand(planned.productionHc, peakRatioPct, supportHc, onsiteHc),
    physicalWeeklyCost: other > 0 ? other + hourly * (hours ?? 0) : null,
    virtualWeeklyCost: hourly > 0 ? hourly * 40 : null,
  }
}

function combineSlices(week: string, slices: WeekSlice[]): WeekSlice {
  const hc = sum(slices.map((slice) => slice.totalHc))
  const volume = sum(slices.map((slice) => slice.volume))
  const demandIncomplete = slices.some((slice) => (slice.totalHc ?? 0) > 0 && (slice.peakRatioPct == null || slice.onsiteHc == null))
  return {
    week,
    label: slices[0]?.label ?? weekLabel(week),
    totalHc: hc,
    volume,
    ahtSeconds: weighted(slices, (slice) => slice.ahtSeconds, (slice) => slice.volume),
    occupancy: weighted(slices, (slice) => slice.occupancy, (slice) => slice.totalHc),
    shrinkage: weighted(slices, (slice) => slice.shrinkage, (slice) => slice.totalHc),
    productiveHours: sum(slices.map((slice) => slice.productiveHours)),
    seatCount: sum(slices.map((slice) => slice.seatCount)),
    supportHc: sum(slices.map((slice) => slice.supportHc)),
    peakRatioPct: demandIncomplete ? null : weighted(slices, (slice) => slice.peakRatioPct, (slice) => slice.onsiteHc),
    onsiteHc: sum(slices.map((slice) => slice.onsiteHc)),
    wahHc: sum(slices.map((slice) => slice.wahHc)),
    demandSeats: demandIncomplete ? null : sum(slices.map((slice) => slice.demandSeats)),
    physicalWeeklyCost: sum(slices.map((slice) => slice.physicalWeeklyCost)),
    virtualWeeklyCost: sum(slices.map((slice) => slice.virtualWeeklyCost)),
  }
}

function finiteOrNull(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null
}

function weekLabel(iso: string): string {
  const date = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function siteOf(scenario: PlannerScenario): string {
  return resolvePlanLocation(scenario.plan) || 'Unassigned site'
}

function lobOf(scenario: PlannerScenario): string {
  return scenario.plan.lob || scenario.plan.client || scenario.name
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function positive(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null
  return value
}

function rateOrNull(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null
  return value > 1 ? value / 100 : value
}

function unitFraction(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null
  return value > 1 ? value / 100 : value
}

function sum(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value != null)
  if (!present.length) return null
  return present.reduce((total, value) => total + value, 0)
}

function weighted(
  slices: WeekSlice[],
  read: (slice: WeekSlice) => number | null,
  weight: (slice: WeekSlice) => number | null,
): number | null {
  let num = 0
  let den = 0
  slices.forEach((slice) => {
    const value = read(slice)
    const w = weight(slice) ?? 0
    if (value == null || w <= 0) return
    num += value * w
    den += w
  })
  return den > 0 ? num / den : null
}

function baseChart() {
  return {
    textStyle: { fontFamily: 'IBM Plex Sans, sans-serif', color: MUTED },
    grid: { left: 48, right: 16, top: 28, bottom: 32 },
    tooltip: { trigger: 'axis' as const },
  }
}

function shiftOption(chain: SeatChain) {
  return {
    ...baseChart(),
    xAxis: { type: 'category', data: chain.shifts.map((shift) => shift.name), axisLine: { lineStyle: { color: INK } } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: GRID } } },
    series: [{
      type: 'bar',
      data: chain.shifts.map((shift, index) => ({ value: shift.agents, itemStyle: { color: TEAL[index] } })),
      barWidth: 36,
      label: { show: true, position: 'top', color: INK },
    }],
  }
}

function waterfallOption(chain: SeatChain) {
  const names = ['Peak shift', 'After overlap', 'After support', 'Seats']
  const values = [chain.peakShift, chain.afterOverlap, chain.afterSupport, chain.seats]
  return {
    ...baseChart(),
    xAxis: { type: 'category', data: names, axisLabel: { interval: 0, fontSize: 11 } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: GRID } } },
    series: [{
      type: 'bar',
      data: values.map((value, index) => ({
        value,
        itemStyle: { color: index === values.length - 1 ? '#0f766e' : '#5eead4' },
      })),
      label: {
        show: true,
        position: 'top',
        formatter: (params: { dataIndex: number; value: number }) => {
          if (params.dataIndex === 0) return String(params.value)
          const delta = params.value - values[params.dataIndex - 1]!
          return `${params.value}\n+${delta}`
        },
      },
    }],
  }
}

function outlookOption(outlook: WeekOutlook[], view: SeatView) {
  const demand = view === 'virtual' ? outlook.map((week) => week.virtualAgents) : outlook.map((week) => week.demandSeats)
  const available = outlook.map((week) => week.availableSeats)
  const gaps = outlook
    .map((week, index) => (week.gap > 0 && week.demandSeats != null ? { coord: [index, week.demandSeats] as [number, number], name: 'Gap' } : null))
    .filter((point): point is { coord: [number, number]; name: string } => point != null)
  return {
    ...baseChart(),
    legend: { top: 0, textStyle: { color: MUTED } },
    xAxis: { type: 'category', data: outlook.map((week) => week.label), axisLabel: { hideOverlap: true } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: GRID } } },
    series: [
      {
        name: view === 'virtual' ? 'Virtual agents' : 'Seat demand',
        type: 'line',
        smooth: true,
        data: demand,
        symbol: 'circle',
        lineStyle: { color: '#0f766e', width: 2 },
        areaStyle: { color: 'rgba(15,118,110,0.12)' },
        markPoint: view === 'virtual' ? undefined : { symbol: 'pin', symbolSize: 36, itemStyle: { color: '#b45309' }, data: gaps },
      },
      view === 'virtual'
        ? null
        : {
            name: 'Available seats',
            type: 'line',
            data: available,
            symbol: 'none',
            lineStyle: { color: '#94a3b8', type: 'dashed' },
          },
    ].filter(Boolean),
  }
}

function donutOption(chain: SeatChain, view: SeatView) {
  const data = [
    view !== 'virtual' ? { name: 'Physical', value: chain.physicalSeats, itemStyle: { color: '#0f766e' } } : null,
    view !== 'physical' ? { name: 'Virtual', value: chain.virtualSeats, itemStyle: { color: '#99f6e4' } } : null,
  ].filter((item): item is { name: string; value: number; itemStyle: { color: string } } => item != null && item.value > 0)
  return {
    tooltip: { trigger: 'item' },
    series: [{
      type: 'pie',
      radius: ['52%', '74%'],
      label: { formatter: '{b}\n{c} ({d}%)', color: INK },
      data,
    }],
  }
}

function gaugeOption(utilization: number) {
  return {
    series: [{
      type: 'gauge',
      min: 0,
      max: 100,
      progress: { show: false },
      axisLine: {
        lineStyle: {
          width: 14,
          color: [[0.7, '#b91c1c'], [0.8, '#d97706'], [0.92, '#0f766e'], [0.95, '#d97706'], [1, '#b91c1c']],
        },
      },
      pointer: { itemStyle: { color: INK } },
      axisLabel: { color: MUTED, distance: 16 },
      detail: { formatter: '{value}%', color: INK, fontSize: 22, offsetCenter: [0, '70%'] },
      data: [{ value: Math.min(100, Math.round(utilization * 1000) / 10) }],
    }],
  }
}

function ratioOption(ratio: number) {
  const rows = deskRatioByModel(ratio)
  return {
    ...baseChart(),
    legend: { top: 0 },
    xAxis: { type: 'category', data: rows.map((row) => row.label) },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: GRID } } },
    series: [
      {
        name: 'Desk ratio',
        type: 'bar',
        data: rows.map((row) => ({
          value: Number(row.ratio.toFixed(2)),
          itemStyle: { color: row.status === 'green' ? '#0f766e' : row.status === 'amber' ? '#d97706' : '#b91c1c' },
        })),
      },
      { name: 'Target', type: 'bar', data: rows.map((row) => row.target), itemStyle: { color: '#cbd5e1' } },
    ],
  }
}

function shiftDrill(chain: SeatChain, name?: string): Drill {
  const shift = chain.shifts.find((item) => item.name === name) ?? chain.shifts[0]
  return {
    title: shift?.name ?? 'Shift',
    rows: [
      { label: 'Agents', value: formatNumber(shift?.agents ?? 0) },
      { label: 'Daily scheduled', value: chain.scheduledPerDay ? formatNumber(chain.scheduledPerDay) : '—' },
      { label: 'Share of day', value: chain.scheduledPerDay ? formatPct((shift?.agents ?? 0) / chain.scheduledPerDay) : '—' },
    ],
  }
}

function waterfallDrill(chain: SeatChain, name?: string): Drill {
  return {
    title: name || 'Seat build-up',
    rows: [
      { label: 'Peak shift', value: formatNumber(chain.peakShift) },
      { label: 'Overlap added', value: formatNumber(chain.overlapDelta) },
      { label: 'Support added', value: formatNumber(chain.supportDelta) },
      { label: 'Buffer added', value: formatNumber(chain.bufferDelta) },
      { label: 'Physical seats', value: formatNumber(chain.seats) },
    ],
  }
}

function outlookDrill(outlook: WeekOutlook[], index?: number): Drill {
  const week = outlook[index ?? 0]
  if (!week) return { title: 'Outlook', rows: [] }
  return {
    title: week.label,
    rows: [
      { label: 'Seat demand', value: week.demandSeats == null ? '—' : formatNumber(week.demandSeats, 1) },
      { label: 'Available seats', value: week.availableSeats == null ? '—' : formatNumber(week.availableSeats) },
      { label: 'Variance', value: week.variance == null ? '—' : formatVariance(week.variance) },
      { label: 'Virtual agents', value: formatNumber(week.virtualAgents) },
    ],
  }
}

function donutDrill(chain: SeatChain, name?: string): Drill {
  const total = chain.physicalSeats + chain.virtualSeats
  const count = name === 'Virtual' ? chain.virtualSeats : chain.physicalSeats
  return {
    title: name || 'Seats',
    rows: [
      { label: 'Count', value: formatNumber(count) },
      { label: 'Share', value: total ? formatPct(count / total) : '—' },
      { label: 'Physical seats', value: formatNumber(chain.physicalSeats) },
      { label: 'Virtual agents', value: formatNumber(chain.virtualSeats) },
    ],
  }
}

function utilizationDrill(chain: SeatChain, model: ShiftModel): Drill {
  return {
    title: 'Seat utilization',
    rows: [
      { label: 'Utilization', value: formatPct(chain.utilization) },
      { label: 'Occupied seat-hours', value: formatNumber(chain.occupiedSeatHours) },
      { label: 'Operating hours', value: formatNumber(chain.operatingHours) },
      { label: 'Shift model', value: `${SHIFT_TARGETS[model].label}, ${SHIFT_TARGETS[model].openHoursPerDay} hours × ${SHIFT_TARGETS[model].daysOpen} days` },
      { label: 'Green band', value: '80–92%' },
    ],
  }
}

function ratioDrill(ratio: number, name?: string): Drill {
  const rows = deskRatioByModel(ratio)
  const match = rows.find((row) => row.label === name) ?? rows[0]
  return {
    title: match?.label ?? 'Desk ratio',
    rows: [
      { label: 'Desk ratio', value: formatNumber(ratio, 2) },
      { label: 'Target', value: match ? match.target.toFixed(1) : '—' },
      { label: 'Status', value: match?.status ?? '—' },
      { label: 'Headcount per seat', value: formatNumber(ratio, 2) },
    ],
  }
}

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
