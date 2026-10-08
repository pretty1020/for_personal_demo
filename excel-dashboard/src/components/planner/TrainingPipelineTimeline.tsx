import { Fragment, useMemo } from 'react'
import type { PeriodResult, PlannerAssumptions } from '../../planner/types'
import { buildTrainingPipeline, type TrainingPipelineClassStage } from '../../planner/trainingPipelineHc'

type Props = {
  periods: PeriodResult[]
  assumptions: PlannerAssumptions
  title?: string
}

const STAGE_LABEL: Record<TrainingPipelineClassStage, string> = {
  planned: 'Planned',
  training: 'Training',
  nesting: 'Nesting',
  graduated: 'Graduate',
  production: 'Production',
}

export function TrainingPipelineTimeline({ periods, assumptions, title = 'Training pipeline' }: Props) {
  const pipeline = useMemo(
    () => buildTrainingPipeline(periods.map((period) => period.hiringPlanned), assumptions),
    [periods, assumptions],
  )

  const timelineClasses = pipeline.classes.filter((cohort) => cohort.plannedNewHire > 0)
  const latest = periods[periods.length - 1] ?? null

  if (!periods.length) return null

  return (
    <section className="cap-training-timeline" aria-label={title}>
      <div className="cap-training-timeline__head">
        <div>
          <h3 className="cap-training-timeline__title">{title}</h3>
          <p className="cap-training-timeline__sub">
            Training {assumptions.newHire.trainingWeeks}w, nesting {assumptions.newHire.nestingWeeks}w, graduation week{' '}
            {assumptions.newHire.graduationWeek}.
          </p>
        </div>
        {latest ? (
          <div className="cap-training-timeline__stats">
            <span className="cap-training-stat">
              <strong>{Math.round(latest.actualTrainingStart)}</strong> start
            </span>
            <span className="cap-training-stat">
              <strong>{Math.round(latest.trainingHeadcount)}</strong> training
            </span>
            <span className="cap-training-stat">
              <strong>{Math.round(latest.nestingHeadcount)}</strong> nesting
            </span>
            <span className="cap-training-stat">
              <strong>{Math.round(latest.graduateHc)}</strong> graduate
            </span>
          </div>
        ) : null}
      </div>

      <div className="cap-training-timeline__legend">
        <span className="cap-training-legend cap-training-legend--planned">Planned</span>
        <span className="cap-training-legend cap-training-legend--training">Training</span>
        <span className="cap-training-legend cap-training-legend--nesting">Nesting</span>
        <span className="cap-training-legend cap-training-legend--graduated">Graduate</span>
        <span className="cap-training-legend cap-training-legend--production">Production</span>
      </div>

      <div className="cap-training-timeline__scroll">
        <div
          className="cap-training-timeline__grid"
          style={{ gridTemplateColumns: `160px repeat(${periods.length}, minmax(84px, 1fr))` }}
        >
          <div className="cap-training-timeline__cell cap-training-timeline__cell--sticky cap-training-timeline__cell--header">
            Hiring class
          </div>
          {periods.map((period) => (
            <div key={`head-${period.periodIndex}`} className="cap-training-timeline__cell cap-training-timeline__cell--header">
              {period.periodLabel}
            </div>
          ))}

          {timelineClasses.map((cohort) => (
            <Fragment key={cohort.id}>
              <div
                className="cap-training-timeline__cell cap-training-timeline__cell--sticky cap-training-timeline__cell--rowhead"
              >
                <div className="cap-training-timeline__rowlabel">{cohort.label}</div>
                <div className="cap-training-timeline__rowmeta">{Math.round(cohort.plannedNewHire)} HC</div>
              </div>
              {periods.map((period) => {
                const cell = cohort.cells.find((entry) => entry.periodIndex === period.periodIndex)
                if (!cell) {
                  return <div key={`${cohort.id}-${period.periodIndex}`} className="cap-training-timeline__cell cap-training-stage cap-training-stage--empty" />
                }
                const stage = cell.stage
                return (
                  <div key={`${cohort.id}-${period.periodIndex}`} className={`cap-training-timeline__cell cap-training-stage cap-training-stage--${stage}`}>
                    <span className="cap-training-stage__label">{STAGE_LABEL[stage]}</span>
                    <strong className="cap-training-stage__value">{Math.round(cell.headcount)}</strong>
                    {cell.phoneTimePct != null && stage === 'nesting' ? (
                      <span className="cap-training-stage__meta">{Math.round(cell.phoneTimePct * 100)}% phone</span>
                    ) : null}
                  </div>
                )
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </section>
  )
}
