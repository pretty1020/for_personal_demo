export function DataSourceBadge() {
  return (
    <span
      className="cap-data-badge"
      title="Data is stored locally in your browser. Set VITE_API_BASE_URL to connect a database-backed API via the data provider."
    >
      Local storage · API-ready
    </span>
  )
}
