type KpiCardProps = {
  label: string
  value: string
  hint?: string
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info'
}

const TONE: Record<NonNullable<KpiCardProps['tone']>, string> = {
  neutral: '',
  good: 'exec-kpi--good',
  warn: 'exec-kpi--warn',
  bad: 'exec-kpi--bad',
  info: 'exec-kpi--info',
}

export function KpiCard({ label, value, hint, tone = 'neutral' }: KpiCardProps) {
  return (
    <div className={`exec-kpi ${TONE[tone]}`}>
      <dt className="exec-kpi__label">{label}</dt>
      <dd className="exec-kpi__value">{value}</dd>
      {hint ? <p className="exec-kpi__hint">{hint}</p> : null}
    </div>
  )
}
