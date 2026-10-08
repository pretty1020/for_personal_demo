interface SheetCardGridProps {
  sheets: string[]
  selected: string | null
  disabled?: boolean
  onSelect: (name: string) => void
}

export function SheetCardGrid(props: SheetCardGridProps) {
  const { sheets, selected, disabled, onSelect } = props
  if (sheets.length === 0) return null

  return (
    <div
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      role="list"
      aria-label="Worksheets"
    >
      {sheets.map((name) => {
        const active = selected === name
        return (
          <button
            key={name}
            type="button"
            role="listitem"
            disabled={disabled}
            onClick={() => onSelect(name)}
            className={`group relative overflow-hidden rounded-2xl border px-4 py-4 text-left transition-all duration-300 ${
              active
                ? 'border-pink-400/80 bg-gradient-to-br from-purple-700/35 via-fuchsia-600/25 to-orange-500/20 shadow-lg shadow-pink-900/40 ring-2 ring-pink-500/45'
                : 'border-white/10 bg-slate-900/50 hover:border-pink-500/40 hover:bg-slate-800/60'
            } ${disabled ? 'pointer-events-none opacity-50' : ''}`}
          >
            <span className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-pink-500/18 blur-2xl transition-opacity group-hover:opacity-100" />
            <span className="relative block truncate text-sm font-semibold text-slate-100">
              {name}
            </span>
            <span className="relative mt-1 block text-xs text-slate-400">
              {active ? 'Selected — showing below' : 'Click to view'}
            </span>
          </button>
        )
      })}
    </div>
  )
}
