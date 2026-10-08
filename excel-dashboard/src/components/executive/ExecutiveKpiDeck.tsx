import type { WeeklyChangeRow } from '../../types/dashboard'
import type { ExecutiveKpiDigest } from '../../utils/executiveKpiDigest'
import { formatCompact, formatPct } from './execChartFormat'
import { useMemo, useState } from 'react'

function bigMoney(n: number): string {
  const sign = n < 0 ? '-' : ''
  const v = Math.abs(n)
  if (v >= 1e6) return `${sign}$${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `${sign}$${(v / 1e3).toFixed(1)}K`
  return `${sign}$${v.toFixed(0)}`
}

type Props = {
  digest: ExecutiveKpiDigest
  dashboard: 'pnl' | 'budgetVsTrending' | 'lwCw'
  weeklySample: WeeklyChangeRow[]
  onSelectClient?: (client: string) => void
  onLeakageClick?: () => void
}

const ICON_GRAD = 'exec-kpi-icon__grad'

export function ExecutiveKpiDeck(props: Props) {
  const { digest, weeklySample, onSelectClient, onLeakageClick, dashboard } = props
  const [watchlistOpen, setWatchlistOpen] = useState(false)

  const cards: {
    id: string
    title: string
    icon: string
    value: string
    /** Second prominent line (e.g. GM %) */
    valueAlt?: string
    sub: string
  }[] = [
    {
      id: 'revenue',
      title: 'Revenue',
      icon: '$',
      value: bigMoney(digest.revenue),
      sub: digest.scenarioHint,
    },
    {
      id: 'people',
      title: 'People Cost',
      icon: '●',
      value: bigMoney(digest.peopleCost),
      sub:
        digest.peopleCostIntensityPct != null
          ? `${digest.peopleCostIntensityPct.toFixed(1)}% of revenue`
          : '—',
    },
    {
      id: 'gm',
      title: 'Gross Margin',
      icon: '↗',
      value: bigMoney(digest.gm),
      valueAlt: digest.gmPct != null ? formatPct(digest.gmPct) : '—',
      sub:
        digest.gmPct != null
          ? `GM %: ${formatPct(digest.gmPct)} · ${digest.gmPctSource === 'column_average' ? 'margin % column' : 'GM ÷ Revenue'}`
          : 'GM $ and GM %',
    },
    {
      id: 'fte',
      title: 'Billed FTE (Avg)',
      icon: 'ƒ',
      value:
        digest.billedFteAvg != null
          ? digest.billedFteAvg.toLocaleString(undefined, { maximumFractionDigits: 1 })
          : '—',
      sub:
        digest.billedFteAvg != null
          ? `${formatCompact(digest.revenue / Math.max(digest.billedFteAvg, 1e-6), true)} revenue / billed FTE`
          : '—',
    },
    {
      id: 'hc',
      title: 'Headcount (Avg)',
      icon: '◉',
      value:
        digest.headcountAvg != null
          ? digest.headcountAvg.toLocaleString(undefined, { maximumFractionDigits: 1 })
          : '—',
      sub: digest.headcountAvg != null ? 'Row-level average from headcount sheet rows' : '—',
    },
    {
      id: 'budget',
      title: 'Budget',
      icon: '▣',
      value: bigMoney(digest.budget),
      sub: 'Detected budget / commit column',
    },
    {
      id: 'projection',
      title: 'Projection',
      icon: '◇',
      value: bigMoney(digest.projection),
      sub: 'Forecast / projection column',
    },
  ]
  const primaryCards = useMemo(() => {
    // Requirement: remove Budget card on PnL + LW‑CW.
    if (dashboard === 'pnl' || dashboard === 'lwCw') return cards.filter((c) => c.id !== 'budget')
    return cards
  }, [cards, dashboard])

  const revVar = digest.revVariance
  const gmVar = digest.gmVariance
  const pci = digest.peopleCostIntensityPct
  const varHint = digest.varianceBaseline === 'projection' ? 'vs projection' : 'vs commit'

  return (
    <div className="exec-kpi-deck">
      <div className="exec-kpi-deck__row exec-kpi-deck__row--primary">
        {primaryCards.map((c) => (
          <article key={c.id} className="exec-kpi-primary-card">
            <div className={`exec-kpi-icon ${ICON_GRAD}`} aria-hidden>
              <span>{c.icon}</span>
            </div>
            <div className="exec-kpi-primary-card__body">
              <p className="exec-kpi-primary-card__title">{c.title}</p>
              <p className="exec-kpi-primary-card__value">{c.value}</p>
              {c.valueAlt ? <p className="exec-kpi-primary-card__value exec-kpi-primary-card__value--alt">{c.valueAlt}</p> : null}
              <p className="exec-kpi-primary-card__sub">{c.sub}</p>
            </div>
          </article>
        ))}
      </div>

      <div className="exec-kpi-deck__row exec-kpi-deck__row--variance">
        <article
          className={`exec-kpi-var-card ${revVar != null && revVar >= 0 ? 'exec-kpi-var-card--good' : 'exec-kpi-var-card--bad'}`}
        >
          <p className="exec-kpi-var-card__label">Revenue variance</p>
          <p className="exec-kpi-var-card__value">
            {revVar != null ? formatCompact(revVar, true) : '—'}
          </p>
          <p className="exec-kpi-var-card__hint">{varHint}</p>
        </article>
        <article
          className={`exec-kpi-var-card ${gmVar != null && gmVar >= 0 ? 'exec-kpi-var-card--good' : 'exec-kpi-var-card--bad'}`}
        >
          <p className="exec-kpi-var-card__label">GM variance</p>
          <p className="exec-kpi-var-card__value">
            {gmVar != null ? formatCompact(gmVar, true) : '—'}
          </p>
          <p className="exec-kpi-var-card__hint">{varHint}</p>
        </article>
        <article
          className={`exec-kpi-var-card ${pci != null && pci < 70 ? 'exec-kpi-var-card--good' : 'exec-kpi-var-card--neutral'}`}
        >
          <p className="exec-kpi-var-card__label">People cost intensity</p>
          <p className="exec-kpi-var-card__value">{pci != null ? formatPct(pci) : '—'}</p>
          <p className="exec-kpi-var-card__hint">cost as % revenue</p>
        </article>
        <button
          type="button"
          className="exec-kpi-var-card exec-kpi-var-card--button exec-kpi-var-card--watchlist"
          onClick={() => setWatchlistOpen((v) => !v)}
          aria-expanded={watchlistOpen}
        >
          <p className="exec-kpi-var-card__label">GM watchlist</p>
          <p className="exec-kpi-var-card__value exec-kpi-var-card__value--sm">{digest.watchlistSummary}</p>
          <p className="exec-kpi-var-card__hint">{watchlistOpen ? 'click a client below' : 'click to open'}</p>
        </button>
        <button
          type="button"
          className="exec-kpi-var-card exec-kpi-var-card--button exec-kpi-var-card--leakage"
          onClick={onLeakageClick}
          disabled={!onLeakageClick}
        >
          <p className="exec-kpi-var-card__label">Leakage</p>
          <p className="exec-kpi-var-card__value exec-kpi-var-card__value--sm">Open Leakage dashboard</p>
          <p className="exec-kpi-var-card__hint">cost impact · staffing gap</p>
        </button>
      </div>

      {watchlistOpen ? (
        <section className="exec-watchlist-panel" aria-label="GM watchlist clients">
          {digest.watchlist.length ? (
            <div className="exec-watchlist-grid">
              {digest.watchlist.map((w) => (
                <button
                  key={w.name}
                  type="button"
                  className="exec-watchlist-chip"
                  onClick={() => onSelectClient?.(w.name)}
                  disabled={!onSelectClient}
                  title="Filter dashboard by client"
                >
                  <span className="exec-watchlist-chip__name">{w.name}</span>
                  <span className="exec-watchlist-chip__pct">{w.marginPct.toFixed(1)}%</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="exec-muted">No watchlist clients for the current slice.</p>
          )}
        </section>
      ) : null}

      <div className="exec-kpi-deck__row exec-kpi-deck__row--insight">
        <article className="exec-kpi-insight-card">
          <p className="exec-kpi-insight-card__text">{digest.insightRevenue}</p>
        </article>
        <article className="exec-kpi-insight-card">
          <p className="exec-kpi-insight-card__text">{digest.insightPeople}</p>
        </article>
        <article className="exec-kpi-insight-card">
          <p className="exec-kpi-insight-card__text">{digest.insightMargin}</p>
        </article>
        <article className="exec-kpi-insight-card">
          <p className="exec-kpi-insight-card__text">{digest.insightFte}</p>
        </article>
      </div>

      {weeklySample.length > 0 ? (
        <section className="exec-kpi-week-strip" aria-label="Week comparison (LW–CW)">
          <h3 className="exec-kpi-week-strip__title">Week comparison · LW-CW</h3>
          <div className="exec-kpi-week-strip__grid">
            {weeklySample.map((w) => (
              <article key={w.metric} className="exec-kpi-week-chip">
                <p className="exec-kpi-week-chip__metric">{w.metric}</p>
                <p className="exec-kpi-week-chip__vals">
                  LW <strong>{w.lastWeek?.toLocaleString() ?? '—'}</strong>
                  <span className="exec-kpi-week-chip__sep">→</span>
                  CW <strong>{w.currentWeek?.toLocaleString() ?? '—'}</strong>
                </p>
                <p
                  className={`exec-kpi-week-chip__trend exec-kpi-week-chip__trend--${w.direction}`}
                >
                  {w.variancePct != null ? `${w.variancePct > 0 ? '+' : ''}${w.variancePct.toFixed(1)}%` : '—'}{' '}
                  <span className="exec-kpi-week-chip__dir">{w.direction}</span>
                </p>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
