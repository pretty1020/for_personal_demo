import { useEffect, useId, useMemo, useRef, useState } from 'react'

/**
 * Compact multi-select: a trigger showing the selection, opening a panel of
 * checkboxes with optional search.
 *
 * Replaces permanently-open checkbox lists. Those were bulky, and where the list
 * was long enough to need capping — holiday calendars showed 40 of 250 — most
 * options could not be reached at all.
 */

export type MultiSelectOption = {
  value: string
  label: string
  /** Shown under the label inside the panel. */
  description?: string
  /** Small trailing hint, e.g. an ISO code. */
  hint?: string
  /** Options sharing a group are rendered together under its heading. */
  group?: string
  disabled?: boolean
  /** Replaces `description` when the option is disabled. */
  disabledReason?: string
}

type Props = {
  options: MultiSelectOption[]
  selected: string[]
  onChange: (values: string[]) => void
  disabled?: boolean
  searchable?: boolean
  /** Trigger text when nothing is selected. */
  placeholder?: string
  /** Plural noun for the collapsed summary, e.g. "models selected". */
  summaryNoun?: string
  /** Selections listed by name before collapsing to a count. */
  maxNamed?: number
  searchPlaceholder?: string
}

export function CollapsibleMultiSelect({
  options,
  selected,
  onChange,
  disabled,
  searchable = true,
  placeholder = 'Nothing selected',
  summaryNoun = 'selected',
  maxNamed = 2,
  searchPlaceholder,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapper = useRef<HTMLDivElement | null>(null)
  const searchInput = useRef<HTMLInputElement | null>(null)
  const panelId = useId()

  // Close on an outside click or Escape, the two things a user expects to
  // dismiss a popover.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (open && searchable) searchInput.current?.focus()
    if (!open) setQuery('')
  }, [open, searchable])

  const byValue = useMemo(
    () => new Map(options.map((option) => [option.value, option])),
    [options],
  )

  const groups = useMemo(() => {
    const text = query.trim().toLowerCase()
    const matches = (option: MultiSelectOption) =>
      !text ||
      option.label.toLowerCase().includes(text) ||
      option.hint?.toLowerCase().startsWith(text) ||
      option.description?.toLowerCase().includes(text)

    const filtered = options.filter(matches)
    const ordered = new Map<string, MultiSelectOption[]>()
    for (const option of filtered) {
      const key = option.group ?? ''
      ordered.set(key, [...(ordered.get(key) ?? []), option])
    }
    return [...ordered.entries()]
  }, [options, query])

  const toggle = (value: string) => {
    onChange(
      selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value],
    )
  }

  const summary = selected.length
    ? selected.length <= maxNamed
      ? selected.map((value) => byValue.get(value)?.label ?? value).join(', ')
      : `${selected.length} ${summaryNoun}`
    : placeholder

  return (
    <div className="cap-country-select" ref={wrapper}>
      <button
        type="button"
        className="cap-field__input cap-country-select__trigger"
        disabled={disabled}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={selected.length ? undefined : 'saas-muted'}>{summary}</span>
        <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>

      {selected.length ? (
        <div className="cap-country-select__chips">
          {selected.map((value) => (
            <span key={value} className="cap-country-select__chip">
              {byValue.get(value)?.label ?? value}
              <button
                type="button"
                aria-label={`Remove ${byValue.get(value)?.label ?? value}`}
                disabled={disabled}
                onClick={() => toggle(value)}
              >
                ×
              </button>
            </span>
          ))}
          <button
            type="button"
            className="cap-country-select__clear"
            disabled={disabled}
            onClick={() => onChange([])}
          >
            Clear all
          </button>
        </div>
      ) : null}

      {open ? (
        <div className="cap-country-select__panel" id={panelId}>
          {searchable ? (
            <input
              ref={searchInput}
              type="search"
              className="cap-field__input cap-country-select__search"
              placeholder={searchPlaceholder ?? `Search ${options.length}…`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          ) : null}
          <div className="cap-country-select__list">
            {groups.length ? (
              groups.map(([group, items]) => (
                <div key={group || 'default'} className="cap-country-select__group">
                  {group ? <p className="cap-country-select__group-label">{group}</p> : null}
                  {items.map((option) => (
                    <label
                      key={option.value}
                      className={`cap-country-select__option${option.description ? ' cap-country-select__option--rich' : ''}${option.disabled ? ' cap-country-select__option--off' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={selected.includes(option.value) && !option.disabled}
                        disabled={disabled || option.disabled}
                        onChange={() => toggle(option.value)}
                      />
                      <span>
                        {option.label}
                        {option.description || option.disabledReason ? (
                          <em className="cap-country-select__desc">
                            {option.disabled
                              ? (option.disabledReason ?? option.description)
                              : option.description}
                          </em>
                        ) : null}
                      </span>
                      {option.hint ? <em>{option.hint}</em> : null}
                    </label>
                  ))}
                </div>
              ))
            ) : (
              <p className="saas-muted cap-country-select__empty">No match for “{query}”.</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
