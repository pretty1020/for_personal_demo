import type { ExecChartId } from './executiveChartIds'
import { EXEC_CHART_IDS, EXEC_CHART_LABELS } from './executiveChartIds'

type Props = {
  visibility: Record<ExecChartId, boolean>
  onChange: (id: ExecChartId, visible: boolean) => void
}

export function ExecCustomizePanel(props: Props) {
  const { visibility, onChange } = props
  const row1 = EXEC_CHART_IDS.slice(0, 9)
  const row2 = EXEC_CHART_IDS.slice(9)

  return (
    <div className="exec-customize-v2" role="region" aria-label="Customize charts">
      <div className="exec-customize-v2__head">
        <h2 className="exec-customize-v2__title">Customize view</h2>
        <p className="exec-customize-v2__hint">Use each chart button to show or hide sections. Charts with metric dropdowns can be retargeted in place.</p>
      </div>
      <div className="exec-customize-v2__rows">
        <div className="exec-customize-v2__row">
          {row1.map((id) => (
            <button
              key={id}
              type="button"
              className={`exec-customize-pill ${visibility[id] ? 'exec-customize-pill--on' : ''}`}
              onClick={() => onChange(id, !visibility[id])}
              aria-pressed={visibility[id]}
            >
              <span className="exec-customize-pill__chk" aria-hidden>
                {visibility[id] ? '✓' : ''}
              </span>
              {EXEC_CHART_LABELS[id]}
            </button>
          ))}
        </div>
        <div className="exec-customize-v2__row">
          {row2.map((id) => (
            <button
              key={id}
              type="button"
              className={`exec-customize-pill ${visibility[id] ? 'exec-customize-pill--on' : ''}`}
              onClick={() => onChange(id, !visibility[id])}
              aria-pressed={visibility[id]}
            >
              <span className="exec-customize-pill__chk" aria-hidden>
                {visibility[id] ? '✓' : ''}
              </span>
              {EXEC_CHART_LABELS[id]}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
