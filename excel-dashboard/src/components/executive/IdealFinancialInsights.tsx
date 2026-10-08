import { useCallback, useEffect, useMemo, useState } from 'react'
import type { IdealFinancialPanelModel, ScenarioPairId } from '../../utils/idealFinancialTrending'
import {
  clearCustomBusinessInsights,
  insightCardId,
  loadCustomBusinessInsights,
  saveCustomBusinessInsights,
  type BusinessInsightsScenario,
  type InsightCard,
  type InsightTone,
} from '../../utils/idealBusinessInsightsStorage'
import { CollapsibleSection } from './CollapsibleSection'
import { formatCompact, formatPct } from './execChartFormat'

const GM_TARGET_PCT = 25
const REV_PER_HOUR_TARGET = 48

type Props = {
  model: IdealFinancialPanelModel
  periodLabel: string
  scenario?: ScenarioPairId | 'overview'
}

function buildSuggestedCards(
  model: IdealFinancialPanelModel,
  periodLabel: string,
  scenario: BusinessInsightsScenario,
): InsightCard[] {
  const clientVariance =
    scenario === 'projection_vs_actual'
      ? model.clientVarianceProjection
      : scenario === 'commit_vs_actual'
        ? model.clientVarianceCommit
        : model.clientVarianceBudget
  const { kpis } = model
  const monthsElapsed = Math.max(1, new Date().getMonth() + 1)
  const runRateRevenue = (kpis.actual / monthsElapsed) * 12
  const runRateGm = (kpis.gm / monthsElapsed) * 12
  const gmGap = (kpis.gmPct ?? 0) - GM_TARGET_PCT
  const revHourGap = kpis.revPerHour != null ? kpis.revPerHour - REV_PER_HOUR_TARGET : null
  const atRisk = clientVariance.filter((c) => (c.variancePct ?? 0) < -3).slice(0, 3)
  const outperform = clientVariance.filter((c) => (c.variancePct ?? 0) > 3).slice(0, 2)
  const baselineWord =
    scenario === 'projection_vs_actual'
      ? 'projection'
      : scenario === 'commit_vs_actual'
        ? 'commit'
        : 'budget'

  const entries: { title: string; body: string; tone: InsightTone }[] = [
    {
      title: 'Full-year forecast (run rate)',
      body:
        scenario === 'projection_vs_actual'
          ? `At current actuals pace for ${periodLabel}, implied FY revenue is about ${formatCompact(runRateRevenue, true)} with GM near ${formatCompact(runRateGm, true)}. Compare weekly drift against the projection baseline in the trend chart.`
          : scenario === 'commit_vs_actual'
            ? `At current actuals pace for ${periodLabel}, implied FY revenue is about ${formatCompact(runRateRevenue, true)} with GM near ${formatCompact(runRateGm, true)}. Use commit-locked plan after the 11th to freeze the baseline for the month.`
            : `At current actuals pace for ${periodLabel}, implied FY revenue is about ${formatCompact(runRateRevenue, true)} with GM near ${formatCompact(runRateGm, true)}.`,
      tone: 'neutral',
    },
    {
      title: 'Margin vs target',
      body:
        kpis.gmPct != null
          ? `Blended GM% is ${kpis.gmPct.toFixed(1)}% (${gmGap >= 0 ? '+' : ''}${gmGap.toFixed(1)} pts vs ${GM_TARGET_PCT}% target). ${gmGap < 0 ? 'Review people cost and OPEX drivers in the revenue bridge.' : 'Margin is at or above target for this slice.'}`
          : 'Map GM% or GM $ columns to compare against the 25% target.',
      tone: gmGap < 0 ? 'warn' : 'good',
    },
    {
      title: 'Productivity (rev / cost per hour)',
      body:
        kpis.revPerHour != null && kpis.costPerHour != null
          ? `Revenue per hour ${formatCompact(kpis.revPerHour, true)}` +
            (revHourGap != null
              ? ` (${revHourGap >= 0 ? '+' : ''}${formatCompact(revHourGap, true)} vs $${REV_PER_HOUR_TARGET} benchmark).`
              : '.') +
            ` Cost per hour ${formatCompact(kpis.costPerHour, true)}.`
          : 'Hours column required to compute revenue/hour and cost/hour KPIs.',
      tone: revHourGap != null && revHourGap < 0 ? 'warn' : 'good',
    },
    {
      title: 'Client portfolio signals',
      body:
        atRisk.length > 0
          ? `Watch: ${atRisk.map((c) => `${c.client} (${formatPct(c.variancePct ?? 0)})`).join(', ')}.${outperform.length ? ` Outperforming: ${outperform.map((c) => c.client).join(', ')}.` : ''}`
          : outperform.length > 0
            ? `No clients materially below ${baselineWord} in this slice. Leaders: ${outperform.map((c) => c.client).join(', ')}.`
            : `Client variances are within a narrow band versus ${baselineWord}.`,
      tone: atRisk.length > 0 ? 'warn' : 'good',
    },
  ]

  return entries.map((e) => ({
    id: insightCardId(e.title),
    title: e.title,
    body: e.body,
    tone: e.tone,
  }))
}

export function IdealFinancialInsights({ model, periodLabel, scenario = 'overview' }: Props) {
  const suggested = useMemo(
    () => buildSuggestedCards(model, periodLabel, scenario),
    [model, periodLabel, scenario],
  )

  const [editing, setEditing] = useState(false)
  const [cards, setCards] = useState<InsightCard[]>(suggested)
  const [freeformNotes, setFreeformNotes] = useState('')
  const [hasCustom, setHasCustom] = useState(false)

  useEffect(() => {
    const stored = loadCustomBusinessInsights(scenario)
    if (stored) {
      setCards(stored.cards.length ? stored.cards : suggested)
      setFreeformNotes(stored.freeformNotes)
      setHasCustom(true)
    } else {
      setCards(suggested)
      setFreeformNotes('')
      setHasCustom(false)
    }
    setEditing(false)
  }, [scenario, suggested])

  const persist = useCallback(() => {
    saveCustomBusinessInsights(scenario, { cards, freeformNotes })
    setHasCustom(true)
    setEditing(false)
  }, [scenario, cards, freeformNotes])

  const resetToSuggested = useCallback(() => {
    clearCustomBusinessInsights(scenario)
    setCards(suggested)
    setFreeformNotes('')
    setHasCustom(false)
    setEditing(false)
  }, [scenario, suggested])

  const updateCard = (id: string, patch: Partial<Pick<InsightCard, 'title' | 'body'>>) => {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  const addCard = () => {
    const n = cards.length + 1
    setCards((prev) => [
      ...prev,
      {
        id: `custom-${Date.now()}`,
        title: `Custom insight ${n}`,
        body: '',
        tone: 'neutral',
      },
    ])
  }

  const removeCard = (id: string) => {
    setCards((prev) => prev.filter((c) => c.id !== id))
  }

  return (
    <CollapsibleSection
      className="ideal-insights mb-8"
      title="Business insights & forecast"
      subtitle={
        hasCustom
          ? `Your saved notes for ${periodLabel}. Edit anytime — suggestions refresh when filters change.`
          : `Suggested insights for ${periodLabel}. Customize with your own narrative and forecast notes.`
      }
      defaultExpanded={false}
    >
      <div className="ideal-insights__toolbar">
        {!editing ? (
          <>
            <button type="button" className="exec-chart-card__btn" onClick={() => setEditing(true)}>
              Customize insights
            </button>
            {hasCustom ? (
              <button type="button" className="exec-chart-card__btn ideal-insights__btn-muted" onClick={resetToSuggested}>
                Reset to suggested
              </button>
            ) : null}
          </>
        ) : (
          <>
            <button type="button" className="exec-chart-card__btn ideal-insights__btn-primary" onClick={persist}>
              Save
            </button>
            <button
              type="button"
              className="exec-chart-card__btn"
              onClick={() => {
                const stored = loadCustomBusinessInsights(scenario)
                if (stored) {
                  setCards(stored.cards)
                  setFreeformNotes(stored.freeformNotes)
                } else {
                  setCards(suggested)
                  setFreeformNotes('')
                }
                setEditing(false)
              }}
            >
              Cancel
            </button>
            <button type="button" className="exec-chart-card__btn ideal-insights__btn-muted" onClick={resetToSuggested}>
              Reset to suggested
            </button>
          </>
        )}
      </div>

      <div className="ideal-insights__grid">
        {cards.map((c) =>
          editing ? (
            <article key={c.id} className="ideal-insight-card ideal-insight-card--edit">
              <div className="ideal-insight-card__edit-head">
                <input
                  className="ideal-insight-card__title-input"
                  value={c.title}
                  onChange={(e) => updateCard(c.id, { title: e.target.value })}
                  aria-label="Insight title"
                />
                <button
                  type="button"
                  className="ideal-insight-card__remove"
                  onClick={() => removeCard(c.id)}
                  title="Remove insight"
                >
                  Remove
                </button>
              </div>
              <textarea
                className="ideal-insight-card__body-input"
                value={c.body}
                onChange={(e) => updateCard(c.id, { body: e.target.value })}
                rows={4}
                placeholder="Write your business insight or forecast note…"
              />
            </article>
          ) : (
            <article key={c.id} className={`ideal-insight-card ideal-insight-card--${c.tone}`}>
              <h3 className="ideal-insight-card__title">{c.title}</h3>
              <p className="ideal-insight-card__body">{c.body || '—'}</p>
            </article>
          ),
        )}
      </div>

      {editing ? (
        <button type="button" className="exec-chart-card__btn mt-3" onClick={addCard}>
          + Add insight card
        </button>
      ) : null}

      <div className="ideal-insights__freeform">
        <h3 className="ideal-insights__freeform-title">Your forecast &amp; commentary</h3>
        {editing ? (
          <textarea
            className="ideal-insights__freeform-input"
            value={freeformNotes}
            onChange={(e) => setFreeformNotes(e.target.value)}
            rows={5}
            placeholder="Add executive summary, risks, opportunities, or forecast assumptions for this period…"
          />
        ) : freeformNotes.trim() ? (
          <p className="ideal-insights__freeform-body">{freeformNotes}</p>
        ) : (
          <p className="ideal-insights__freeform-empty text-sm text-slate-500">
            No custom commentary yet. Click <strong>Customize insights</strong> to add your forecast notes.
          </p>
        )}
      </div>
    </CollapsibleSection>
  )
}
