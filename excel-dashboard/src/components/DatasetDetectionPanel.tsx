import type { DatasetDetectionReport, TransformLogEntry } from '../types/dashboard'
import { labelDatasetKind } from '../utils/datasetLabels'

export function DatasetDetectionPanel(props: { report: DatasetDetectionReport; transformLogs?: TransformLogEntry[] }) {
  const { report, transformLogs } = props
  const missingSheets = report.issues.filter((i) => i.kind === 'missing_sheet')
  const missingFields = report.issues.filter((i) => i.kind === 'missing_required_field')
  const lowConfidence = report.issues.filter((i) => i.kind === 'low_confidence')
  const duplicates = report.issues.filter((i) => i.kind === 'duplicate_sheet')

  const severity =
    missingSheets.length > 0 || missingFields.length > 0 ? 'warn' : lowConfidence.length > 0 ? 'soft' : 'ok'

  return (
    <section
      className={`content-panel ${severity === 'ok' ? 'dq-panel dq-panel--ok' : severity === 'soft' ? 'dq-panel dq-panel--soft' : 'dq-panel dq-panel--warn'}`}
      aria-label="Dataset detection"
    >
      <div className="content-panel__head">
        <h2 className="content-panel__title">Data quality & dataset detection</h2>
        <p className="content-panel__sub">
          Auto-detected sheets and required fields (Client Code, period, scenario, etc.). This powers the Executive dashboard automation.
        </p>
      </div>

      <div className="dq-grid">
        <div className="dq-card">
          <p className="dq-title">Detected datasets</p>
          <ul className="dq-list">
            {report.detected.map((d) => (
              <li key={`${d.dataset}-${d.sheetName}`} className="dq-item">
                <span className="dq-badge">{labelDatasetKind(d.dataset)}</span>
                <span className="dq-sheet" title={d.sheetName}>
                  {d.sheetName}
                </span>
                <span className="dq-meta">{Math.round(d.confidence * 100)}%</span>
                {d.missingRequired.length ? (
                  <span className="dq-missing">
                    Missing: {d.missingRequired.map((m) => m.replace(/_/g, ' ')).join(', ')}
                  </span>
                ) : (
                  <span className="dq-ok">OK</span>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className="dq-card">
          <p className="dq-title">Issues</p>
          {report.issues.length === 0 ? (
            <p className="dq-empty">No issues detected.</p>
          ) : (
            <ul className="dq-list dq-list--issues">
              {duplicates.map((i, idx) => (
                <li key={`dup-${idx}`} className="dq-issue dq-issue--soft">
                  {i.message}
                </li>
              ))}
              {lowConfidence.map((i, idx) => (
                <li key={`low-${idx}`} className="dq-issue dq-issue--soft">
                  {i.message}
                </li>
              ))}
              {missingSheets.map((i, idx) => (
                <li key={`ms-${idx}`} className="dq-issue dq-issue--warn">
                  {i.message}
                </li>
              ))}
              {missingFields.slice(0, 14).map((i, idx) => (
                <li key={`mf-${idx}`} className="dq-issue dq-issue--warn">
                  {i.message}
                </li>
              ))}
              {missingFields.length > 14 ? (
                <li className="dq-issue dq-issue--soft">
                  …and {missingFields.length - 14} more missing field(s).
                </li>
              ) : null}
            </ul>
          )}
        </div>
      </div>

      {transformLogs && transformLogs.length ? (
        <div className="dq-card dq-card--logs">
          <p className="dq-title">Transformation log</p>
          <ul className="dq-list dq-list--issues">
            {transformLogs.slice(0, 24).map((l, idx) => (
              <li key={`${l.sheetName}-${l.action}-${idx}`} className="dq-issue dq-issue--soft">
                <strong>{l.sheetName}</strong> · {l.action.replace(/_/g, ' ')} — {l.message}
                {typeof l.beforeRows === 'number' || typeof l.afterRows === 'number' ? (
                  <span className="dq-log-meta">
                    {' '}
                    ({l.beforeRows ?? '—'} → {l.afterRows ?? '—'} rows)
                  </span>
                ) : null}
              </li>
            ))}
            {transformLogs.length > 24 ? (
              <li className="dq-issue dq-issue--soft">…and {transformLogs.length - 24} more log entries.</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

