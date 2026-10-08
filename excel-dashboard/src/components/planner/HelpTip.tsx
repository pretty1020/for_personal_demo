import { useEffect, useRef, useState } from 'react'

type HelpTipProps = {
  text: string
  variant?: 'default' | 'matrix'
}

export function HelpTip({ text, variant = 'default' }: HelpTipProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <span ref={containerRef} className={`cap-help cap-help--${variant}${open ? ' is-open' : ''}`} role="note">
      <button
        type="button"
        className="cap-help__icon"
        aria-label={text}
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        ?
      </button>
      <span className="cap-help__bubble">{text}</span>
    </span>
  )
}
