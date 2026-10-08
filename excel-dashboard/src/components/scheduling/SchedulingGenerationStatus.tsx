type Props = {
  phase: string
  title?: string
}

export function SchedulingGenerationStatus({
  phase,
  title = 'Waiting Status',
}: Props) {
  return (
    <div className="sched-generating-overlay" role="status" aria-live="polite" aria-busy="true">
      <div className="sched-generating-overlay__card">
        <div className="sched-generating-overlay__spinner" aria-hidden />
        <h2 className="sched-generating-overlay__title m-0">{title}</h2>
        <p className="sched-generating-overlay__phase m-0">{phase}</p>
        <p className="saas-muted m-0 text-xs sched-generating-overlay__hint">
          Working on your request. Please wait — the page will update when this action finishes.
        </p>
      </div>
    </div>
  )
}
