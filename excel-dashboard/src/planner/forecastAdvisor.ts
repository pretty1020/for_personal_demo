import { sendAssistantMessage } from '../data/assistantApi'
import type { AccessLevel } from '../utils/accessLevel'
import type { StoredWfmModel } from './advancedForecastPersistence'
import { describeBias, describePattern } from './forecastAccuracy'
import type { DiagnosticsVerdict } from './forecastDiagnostics'

/**
 * An optional second opinion on model choice.
 *
 * The rule-based diagnostics already recommend models and explain why, offline
 * and inspectably. This adds a reading of the same evidence in prose — useful
 * for the judgement calls rules handle badly, like weighing a slightly better
 * error score against a materially worse bias.
 *
 * It goes through the assistant endpoint the app already has, rather than a new
 * serverless function: the deployment sits at Vercel's twelve-function limit,
 * and adding a thirteenth would break the build rather than ship a feature.
 *
 * The advice is explicitly advisory. Nothing here changes a forecast or selects
 * a model — a planner reads it and decides.
 */

export type AdvisorInput = {
  driverLabel: string
  verdict: DiagnosticsVerdict
  models: StoredWfmModel[]
  horizonWeeks: number
  accessLevel: AccessLevel | null
  aiAssistantApproved?: boolean
}

function describeModels(models: StoredWfmModel[]): string {
  const usable = models.filter((model) => model.success)
  if (!usable.length) return 'No model fitted successfully.'

  return usable
    .map((model) => {
      const a = model.accuracy ?? {}
      const bits = [
        a.wape != null ? `WAPE ${a.wape.toFixed(1)}%` : null,
        a.bias != null ? `bias ${a.bias > 0 ? '+' : ''}${a.bias.toFixed(1)}% (${describeBias(a.bias).text})` : null,
        a.pattern_r != null ? `pattern R ${a.pattern_r.toFixed(2)}` : null,
        a.amplitude_ratio != null ? `amplitude ${a.amplitude_ratio.toFixed(2)}x actual` : null,
        a.pattern_r != null || a.amplitude_ratio != null
          ? `(${describePattern(a.pattern_r, a.amplitude_ratio).text})`
          : null,
        a.test_samples != null ? `scored on ${a.test_samples} weeks across ${a.folds ?? 1} folds` : null,
      ].filter(Boolean)
      return `- ${model.label}: ${bits.join(', ')}`
    })
    .join('\n')
}

/**
 * The evidence, written out for the model to reason over.
 *
 * Deliberately verbose about sample sizes and the limits of the data: the most
 * useful thing this can do is say "the difference between these two is not
 * meaningful on four weeks of evidence", and it can only say that if it knows.
 */
export function buildAdvisorPrompt(input: AdvisorInput): string {
  const { diagnostics: d, summary, suggested, cautions } = input.verdict

  return [
    `Driver: ${input.driverLabel}`,
    `Forecast horizon: ${input.horizonWeeks} weeks`,
    '',
    'Series shape:',
    `- ${summary}`,
    `- ${d.weeks} weeks of history`,
    `- seasonal strength ${(d.seasonalStrength * 100).toFixed(0)}% (annual cycle ${d.hasSeasonalEvidence ? 'measurable' : 'NOT measurable at this length'})`,
    `- trend strength ${(d.trendStrength * 100).toFixed(0)}%, implying ${(d.trendPerWeekPct * 52).toFixed(0)}% change per year`,
    `- amplitude ${d.amplitudePct.toFixed(0)}% of the average level`,
    `- week-to-week noise ±${d.volatilityPct.toFixed(0)}%`,
    `- ${d.outlierPct.toFixed(0)}% of weeks sit far outside the pattern`,
    '',
    'Model results:',
    describeModels(input.models),
    '',
    suggested.length
      ? `Rule-based suggestion: ${suggested.map((s) => s.modelId).join(', ')}`
      : 'Rule-based suggestion: none',
    cautions.length ? `Cautions already flagged: ${cautions.join(' ')}` : '',
    '',
    'You are advising a workforce-management capacity planner choosing which model should drive a staffing plan.',
    'Answer in under 120 words, plainly, no headings or bullet symbols.',
    'Say which model you would use and why, in terms of staffing consequences.',
    // Spelled out because a smaller model will otherwise call an
    // under-forecasting model "conservative", which is exactly backwards: a
    // negative bias understaffs every week, and that is the expensive error.
    'Bias sign: negative bias means the model forecasts BELOW actual, so the plan hires too few and every week is understaffed. Positive bias means it forecasts above actual, so the plan carries surplus heads.',
    'Never describe a negative bias as conservative, safe, or cautious. Understaffing is the costly failure; a small positive bias is the safer error.',
    'Weigh bias against error. A model with a slightly worse WAPE but a bias near zero is usually the better plan driver than one with the lowest WAPE and a persistent negative bias.',
    'Pattern R is the correlation between forecast and actual, and amplitude is the size of the forecast swing relative to the real one. A model can win on WAPE by predicting close to the average every week: that shows up as a low pattern R or an amplitude well under 1, and it means the plan will be short at every peak and carry surplus at every trough even though the average looks right.',
    'Do not recommend a model with an amplitude far below 1 for a series that genuinely moves, however good its error score.',
    // A smaller model will otherwise recommend the best-shaped model and wave
    // its bias through in the same sentence, which is how an understaffed plan
    // gets signed off.
    'State the sign of any bias you quote correctly: a number below zero is a negative bias and forecasts under, never call it positive.',
    'If the model you recommend has a bias worse than 3% in either direction, you must say that the forecast needs correcting by roughly that much before it drives the plan, and say in which direction.',
    'If one model has both a lower error and a smaller bias than another, prefer it unless you can name a concrete reason the other is better for staffing.',
    'If the evidence is too thin to separate the models, say so plainly rather than picking one.',
    'If the honest answer is that no model should drive the plan yet, say that.',
  ]
    .filter(Boolean)
    .join('\n')
}

export async function askForecastAdvisor(input: AdvisorInput): Promise<string> {
  const prompt = buildAdvisorPrompt(input)
  return sendAssistantMessage({
    messages: [{ role: 'user', content: prompt }],
    context: 'Forecast model selection for a capacity plan driver.',
    page: 'Forecasting',
    accessLevel: input.accessLevel,
    aiAssistantApproved: input.aiAssistantApproved,
  })
}
