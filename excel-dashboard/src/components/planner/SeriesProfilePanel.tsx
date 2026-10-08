import { useMemo, useState } from 'react'
import type { StoredWfmModel, WfmModelId } from '../../planner/advancedForecastPersistence'
import { WFM_MODEL_LABELS } from '../../planner/advancedForecastPersistence'
import { diagnose } from '../../planner/forecastDiagnostics'
import { askForecastAdvisor } from '../../planner/forecastAdvisor'
import type { AccessLevel } from '../../utils/accessLevel'
import { fmtNum } from '../../planner/format'

/**
 * What shape the data is, and which models suit it.
 *
 * Accuracy scores say which model did best on the weeks tested; on a short
 * series that is often decided by a handful of points. This gives the other
 * half of the decision — whether the result is likely to hold, and whether the
 * series can support the model that won at all.
 */

type Props = {
  driverLabel: string
  values: number[]
  models: StoredWfmModel[]
  horizonWeeks: number
  accessLevel: AccessLevel | null
  aiAssistantApproved?: boolean
  selectedModels: WfmModelId[]
  onUseSuggested: (models: WfmModelId[]) => void
  disabled?: boolean
}

function strengthTone(value: number): string {
  if (value > 0.6) return 'strong'
  if (value > 0.3) return 'mild'
  return 'weak'
}

export function SeriesProfilePanel({
  driverLabel,
  values,
  models,
  horizonWeeks,
  accessLevel,
  aiAssistantApproved,
  selectedModels,
  onUseSuggested,
  disabled,
}: Props) {
  const [advice, setAdvice] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const [adviceError, setAdviceError] = useState<string | null>(null)

  const verdict = useMemo(() => diagnose(values), [values])
  const { diagnostics: d, summary, suggested, cautions } = verdict

  if (d.weeks < 4) return null

  const suggestedIds = suggested.map((item) => item.modelId)
  const alreadySelected =
    suggestedIds.length > 0 && suggestedIds.every((id) => selectedModels.includes(id))

  const askAdvisor = async () => {
    setAsking(true)
    setAdviceError(null)
    try {
      const reply = await askForecastAdvisor({
        driverLabel,
        verdict,
        models,
        horizonWeeks,
        accessLevel,
        aiAssistantApproved,
      })
      setAdvice(reply)
    } catch (error) {
      setAdviceError((error as Error).message)
    } finally {
      setAsking(false)
    }
  }

  return (
    <section className="cap-forecast-profile">
      <header className="cap-forecast-adjust__head">
        <div>
          <h4 className="cap-forecast-advanced__step-title">Series profile</h4>
          <p className="saas-muted m-0 text-xs">{summary}</p>
        </div>
      </header>

      <div className="cap-forecast-profile__metrics">
        <div className="cap-forecast-charts__metric">
          <span className="cap-forecast-charts__metric-label">Seasonality</span>
          <strong className="cap-forecast-charts__metric-value">
            {d.hasSeasonalEvidence ? `${fmtNum(d.seasonalStrength * 100, 0)}%` : 'n/a'}
          </strong>
          <em className="cap-forecast-profile__hint">
            {d.hasSeasonalEvidence ? strengthTone(d.seasonalStrength) : 'needs ~78 weeks'}
          </em>
        </div>
        <div className="cap-forecast-charts__metric">
          <span className="cap-forecast-charts__metric-label">Trend</span>
          <strong className="cap-forecast-charts__metric-value">
            {fmtNum(d.trendStrength * 100, 0)}%
          </strong>
          <em className="cap-forecast-profile__hint">
            {d.trendPerWeekPct >= 0 ? '+' : ''}
            {fmtNum(d.trendPerWeekPct * 52, 0)}% a year
          </em>
        </div>
        <div className="cap-forecast-charts__metric">
          <span className="cap-forecast-charts__metric-label">Amplitude</span>
          <strong className="cap-forecast-charts__metric-value">
            {fmtNum(d.amplitudePct, 0)}%
          </strong>
          <em className="cap-forecast-profile__hint">
            {d.hasSeasonalEvidence ? 'seasonal swing' : 'overall spread'}
          </em>
        </div>
        <div className="cap-forecast-charts__metric">
          <span className="cap-forecast-charts__metric-label">Noise</span>
          <strong className="cap-forecast-charts__metric-value">
            ±{fmtNum(d.volatilityPct, 0)}%
          </strong>
          <em className="cap-forecast-profile__hint">week to week</em>
        </div>
        <div className="cap-forecast-charts__metric">
          <span className="cap-forecast-charts__metric-label">History</span>
          <strong className="cap-forecast-charts__metric-value">{d.weeks}</strong>
          <em className="cap-forecast-profile__hint">weeks</em>
        </div>
      </div>

      {suggested.length ? (
        <div className="cap-forecast-profile__suggested">
          <p className="saas-field__label m-0">Suited to this shape</p>
          <ul>
            {suggested.map((item) => (
              <li key={item.modelId}>
                <strong>{WFM_MODEL_LABELS[item.modelId]}</strong>
                <span>{item.reason}</span>
              </li>
            ))}
          </ul>
          {!alreadySelected ? (
            <button
              type="button"
              className="saas-btn saas-btn--ghost"
              disabled={disabled}
              onClick={() => onUseSuggested(suggestedIds)}
            >
              Select these models
            </button>
          ) : null}
        </div>
      ) : null}

      {cautions.map((caution) => (
        <p key={caution} className="cap-forecast-advanced__alert">
          {caution}
        </p>
      ))}

      <div className="cap-forecast-advanced__actions">
        <button
          type="button"
          className="saas-btn saas-btn--ghost"
          disabled={disabled || asking || !models.some((m) => m.success)}
          onClick={() => void askAdvisor()}
        >
          {asking ? 'Asking…' : advice ? 'Ask again' : 'Ask AI Assistant which model to use'}
        </button>
        <span className="saas-muted text-xs">
          A second reading of the same evidence. It advises — it never changes the forecast.
        </span>
      </div>

      {adviceError ? (
        <p className="cap-forecast-advanced__alert cap-forecast-advanced__alert--error">
          {adviceError}
        </p>
      ) : null}
      {advice ? <blockquote className="cap-forecast-profile__advice">{advice}</blockquote> : null}
    </section>
  )
}
