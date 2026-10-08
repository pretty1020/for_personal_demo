import { fmtNum, fmtPct } from '../../planner/format'
import type { ExecutivePortfolioTotals } from '../../planner/executivePortfolioTotals'

type KpiCard = {
  id: string
  label: string
  value: string
  sub: string
  tone: 'navy' | 'emerald' | 'amber' | 'indigo' | 'violet' | 'cyan' | 'rose' | 'slate'
  formula?: string
  trend?: string
}

function money(value: number): string {
  return `$${fmtNum(value, 0)}`
}

function buildCards(totals: ExecutivePortfolioTotals): { financial: KpiCard[]; staffing: KpiCard[]; roster: KpiCard[] } {
  const staffingTone =
    totals.staffingGapFte != null && totals.staffingGapFte > 0.5
      ? 'amber'
      : totals.staffingGapFte != null && totals.staffingGapFte < -0.5
        ? 'rose'
        : 'emerald'

  const gapLabel =
    totals.staffingGapFte == null
      ? undefined
      : totals.staffingGapFte > 0.05
        ? `+${fmtNum(totals.staffingGapFte, 1)} surplus`
        : totals.staffingGapFte < -0.05
          ? `${fmtNum(totals.staffingGapFte, 1)} short`
          : 'On plan'

  return {
    financial: [
      {
        id: 'revenue',
        label: 'Total revenue',
        value: money(totals.revenue),
        sub:
          totals.weeksPlanned > 0
            ? `${totals.weeksPlanned} planned weeks · Capacity billing`
            : 'Σ planned weeks · Capacity billing (same as /Financial)',
        tone: 'emerald',
        formula: 'Production Hours / FTE / Transactional revenue by LOB',
        trend: totals.clientCount > 0 ? `${totals.clientCount} clients · ${totals.scenarioCount} LOBs` : undefined,
      },
      {
        id: 'labor',
        label: 'Total cost',
        value: money(totals.laborCost),
        sub:
          totals.laborCostIntensityPct != null
            ? `${fmtPct(totals.laborCostIntensityPct)} of revenue`
            : 'Projected cost · same as /Financial',
        tone: 'amber',
        formula: 'Production labor + training + support + other (Σ planned weeks)',
      },
      {
        id: 'margin',
        label: 'Gross margin',
        value: money(totals.grossMargin),
        sub: totals.grossMarginPct != null ? `${fmtPct(totals.grossMarginPct)} margin` : 'Revenue − cost',
        tone: totals.grossMargin >= 0 ? 'cyan' : 'rose',
        formula: 'Matches /Financial projected margin',
        trend: totals.grossMarginPct != null ? fmtPct(totals.grossMarginPct) : undefined,
      },
    ],
    staffing: [
      {
        id: 'req-fte',
        label: 'Required FTE',
        value: fmtNum(totals.requiredFte, 1),
        sub: 'Planning week · Capacity matrix',
        tone: 'indigo',
        formula: 'Σ LOB planned required FTE',
      },
      {
        id: 'prod-fte',
        label: 'Production FTE',
        value: fmtNum(totals.productionFte, 1),
        sub: 'Planning week · Capacity matrix',
        tone: 'violet',
        formula: 'Σ LOB planned production FTE',
        trend: gapLabel,
      },
      {
        id: 'staffing-pct',
        label: 'Staffing %',
        value: totals.staffingPct != null ? fmtPct(totals.staffingPct) : '—',
        sub: 'Production FTE ÷ Required FTE',
        tone: staffingTone,
        formula: 'Above 100% = overstaffed vs requirement',
      },
      {
        id: 'gap',
        label: 'Staffing gap (FTE)',
        value: totals.staffingGapFte != null ? fmtNum(totals.staffingGapFte, 1) : '—',
        sub: 'Production FTE − Required FTE',
        tone: staffingTone,
        formula: 'Positive = surplus FTE',
      },
      {
        id: 'hiring',
        label: 'Hiring needed (wk 1)',
        value: fmtNum(totals.hiringWeek1, 0),
        sub: 'Planned new hires · planning week',
        tone: 'slate',
      },
    ],
    roster: [
      {
        id: 'active-hc',
        label: 'Active headcount',
        value: fmtNum(totals.activeHeadcount, 0),
        sub: 'Roster · status active',
        tone: 'navy',
      },
      {
        id: 'prod-hc',
        label: 'Production HC',
        value: fmtNum(totals.productionHc, 0),
        sub: 'Capacity matrix · planning week',
        tone: 'indigo',
      },
      {
        id: 'train-nest',
        label: 'Training / nesting HC',
        value: `${fmtNum(totals.trainingHc, 0)} / ${fmtNum(totals.nestingHc, 0)}`,
        sub: 'Capacity pipeline · planning week',
        tone: 'violet',
      },
      {
        id: 'roster-util',
        label: 'Roster utilization',
        value: totals.rosterUtilizationPct != null ? fmtPct(totals.rosterUtilizationPct) : '—',
        sub: 'Production HC ÷ active headcount',
        tone: 'cyan',
        formula: 'Share of active roster covered by capacity production HC',
      },
    ],
  }
}

type Props = {
  totals: ExecutivePortfolioTotals
  compact?: boolean
}

function KpiCardView({ card, showSub = true }: { card: KpiCard; showSub?: boolean }) {
  return (
    <article className={`portfolio-kpi-card portfolio-kpi-card--${card.tone}`} title={card.formula}>
      <div className="portfolio-kpi-card__top">
        <span className="portfolio-kpi-card__label">{card.label}</span>
        {card.trend ? <span className="portfolio-kpi-card__chip">{card.trend}</span> : null}
      </div>
      <strong className="portfolio-kpi-card__value">{card.value}</strong>
      {showSub ? <span className="portfolio-kpi-card__sub">{card.sub}</span> : null}
    </article>
  )
}

function KpiSection({ title, cards }: { title: string; cards: KpiCard[] }) {
  return (
    <section className="portfolio-kpi-section">
      <h2 className="portfolio-kpi-section__title">{title}</h2>
      <div className="portfolio-kpi-grid">
        {cards.map((card) => (
          <KpiCardView key={card.id} card={card} />
        ))}
      </div>
    </section>
  )
}

export function ExecutivePortfolioKpiDeck({ totals, compact = false }: Props) {
  const groups = buildCards(totals)
  if (compact) {
    const top = [
      groups.financial[0]!,
      groups.financial[1]!,
      groups.financial[2]!,
      groups.staffing[0]!,
      groups.staffing[1]!,
      groups.staffing[2]!,
    ]
    return (
      <div className="portfolio-kpi-grid portfolio-kpi-grid--compact">
        {top.map((card) => (
          <KpiCardView key={card.id} card={card} showSub={false} />
        ))}
      </div>
    )
  }

  return (
    <div className="portfolio-kpi-deck">
      <KpiSection title="Financial performance" cards={groups.financial} />
      <KpiSection title="Capacity & staffing" cards={groups.staffing} />
      <KpiSection title="Roster & pipeline" cards={groups.roster} />
      <p className="portfolio-kpi-deck__footnote saas-muted m-0 text-xs">
        Revenue and cost roll up every <strong>planned</strong> Capacity week (same source as Financial). FTE and HC use
        each LOB&apos;s <strong>planning week</strong> from the Capacity matrix. Staffing % compares production FTE to
        required FTE — not roster headcount.
      </p>
    </div>
  )
}
