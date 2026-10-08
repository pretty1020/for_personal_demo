import { describe, expect, it } from 'vitest'
import { buildAdvisorPrompt } from './forecastAdvisor'
import { diagnose } from './forecastDiagnostics'
import type { StoredWfmModel } from './advancedForecastPersistence'

/**
 * The advisor is only as good as the evidence it is handed.
 *
 * These assert that every number a planner can see on screen also reaches the
 * prompt. A metric shown in the table but withheld from the prompt would have
 * the advisor confidently reasoning from a subset of the facts.
 */

const model = (over: Partial<StoredWfmModel>): StoredWfmModel =>
  ({
    id: 'theta',
    label: 'Theta',
    success: true,
    error: null,
    accuracy: {},
    parameters: {},
    weekly: [],
    ...over,
  }) as StoredWfmModel

const verdict = diagnose(
  Array.from({ length: 120 }, (_, i) => 1000 * (1 + 0.25 * Math.sin((2 * Math.PI * i) / 52))),
)

describe('buildAdvisorPrompt', () => {
  it('passes on every scored metric the table shows', () => {
    const prompt = buildAdvisorPrompt({
      driverLabel: 'Volume',
      verdict,
      horizonWeeks: 52,
      accessLevel: null,
      models: [
        model({
          accuracy: {
            wape: 9.1,
            bias: 1.5,
            pattern_r: 0.52,
            amplitude_ratio: 0.85,
            test_samples: 50,
            folds: 5,
          },
        }),
      ],
    })

    expect(prompt).toContain('WAPE 9.1%')
    expect(prompt).toContain('bias +1.5%')
    expect(prompt).toContain('pattern R 0.52')
    expect(prompt).toContain('amplitude 0.85x actual')
    expect(prompt).toContain('50 weeks across 5 folds')
  })

  it('tells the model which direction a bias hurts in', () => {
    const prompt = buildAdvisorPrompt({
      driverLabel: 'Volume',
      verdict,
      horizonWeeks: 52,
      accessLevel: null,
      models: [model({ accuracy: { wape: 5, bias: -3 } })],
    })
    // Left implicit, a smaller model calls an under-forecast "conservative".
    expect(prompt).toMatch(/negative bias means/i)
    expect(prompt).toMatch(/understaffed/i)
  })

  it('warns against recommending a flat forecast on a series that moves', () => {
    const prompt = buildAdvisorPrompt({
      driverLabel: 'Volume',
      verdict,
      horizonWeeks: 52,
      accessLevel: null,
      models: [model({ accuracy: { wape: 4, amplitude_ratio: 0.2 } })],
    })
    expect(prompt).toMatch(/amplitude far below 1/i)
  })

  it('omits metrics that were withheld rather than inventing them', () => {
    const prompt = buildAdvisorPrompt({
      driverLabel: 'Volume',
      verdict,
      horizonWeeks: 52,
      accessLevel: null,
      models: [model({ accuracy: { wape: 9.1, bias: 1.5, test_samples: 4, folds: 4 } })],
    })
    // The instructions always explain what pattern R is; what must not appear is
    // a value for it on this model's line.
    const modelLine = prompt
      .split(String.fromCharCode(10))
      .find((line) => line.startsWith('- Theta:'))!
    expect(modelLine).toContain('WAPE 9.1%')
    expect(modelLine).not.toContain('pattern R')
    expect(modelLine).not.toContain('amplitude')
  })

  it('says plainly when nothing fitted, rather than sending an empty list', () => {
    const prompt = buildAdvisorPrompt({
      driverLabel: 'Volume',
      verdict,
      horizonWeeks: 52,
      accessLevel: null,
      models: [model({ success: false, error: 'Needs more history' })],
    })
    expect(prompt).toContain('No model fitted successfully.')
  })

  it('carries the series shape and the cautions already on screen', () => {
    const short = diagnose(Array.from({ length: 12 }, (_, i) => 1000 - i * 20))
    const prompt = buildAdvisorPrompt({
      driverLabel: 'Volume',
      verdict: short,
      horizonWeeks: 52,
      accessLevel: null,
      models: [model({ accuracy: { wape: 5 } })],
    })
    expect(prompt).toMatch(/NOT measurable at this length/)
    expect(prompt).toMatch(/Cautions already flagged/)
  })
})
