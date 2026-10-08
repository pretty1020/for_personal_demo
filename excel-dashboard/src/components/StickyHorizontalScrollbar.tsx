import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'

/**
 * A horizontal scrollbar that stays on screen for a table taller than the window.
 *
 * A wide table's own scrollbar sits at the bottom of the table, so on a sixty
 * row capacity matrix moving the columns means scrolling to the end of the page
 * and back up to read them. This mirrors that scrollbar along the bottom of the
 * viewport while the table is on screen and its own bar is not.
 *
 * Rendered into `document.body` rather than beside the table, because the cards
 * these tables live in carry `overflow: hidden` and `contain: paint` — either of
 * which stops a sticky child from sticking, and the second of which also
 * captures fixed positioning. Escaping to the body is the only placement that
 * survives both.
 *
 * It shows only when it earns its place: the table has to overflow horizontally,
 * and its own scrollbar has to be below the fold.
 */
type Metrics = { left: number; width: number; contentWidth: number }

export function StickyHorizontalScrollbar({
  targetRef,
  label = 'Scroll table horizontally',
}: {
  targetRef: RefObject<HTMLElement | null>
  label?: string
}) {
  const proxyRef = useRef<HTMLDivElement | null>(null)
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  /** Guards the two-way sync from echoing back and fighting the pointer. */
  const syncing = useRef(false)

  const measure = useCallback(() => {
    const target = targetRef.current
    if (!target) {
      setMetrics(null)
      return
    }

    const overflows = target.scrollWidth > target.clientWidth + 1
    const rect = target.getBoundingClientRect()
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight
    const ownBarOffScreen = rect.bottom > viewportHeight && rect.top < viewportHeight

    if (!overflows || !ownBarOffScreen) {
      setMetrics(null)
      return
    }

    setMetrics((current) => {
      const next = { left: rect.left, width: rect.width, contentWidth: target.scrollWidth }
      // Skip identical updates so a scroll listener does not re-render the page
      // on every frame.
      if (
        current &&
        current.left === next.left &&
        current.width === next.width &&
        current.contentWidth === next.contentWidth
      ) {
        return current
      }
      return next
    })

    const proxy = proxyRef.current
    if (proxy && !syncing.current) proxy.scrollLeft = target.scrollLeft
  }, [targetRef])

  useEffect(() => {
    const target = targetRef.current
    if (!target) return

    measure()

    const onTargetScroll = () => {
      const proxy = proxyRef.current
      if (!proxy || syncing.current) return
      syncing.current = true
      proxy.scrollLeft = target.scrollLeft
      requestAnimationFrame(() => {
        syncing.current = false
      })
    }

    // Feature-detected rather than assumed: this runs under jsdom in tests, and
    // the resize listener covers the common case, so a missing ResizeObserver
    // should cost a little responsiveness rather than the whole table.
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    observer?.observe(target)

    target.addEventListener('scroll', onTargetScroll, { passive: true })
    window.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)

    return () => {
      observer?.disconnect()
      target.removeEventListener('scroll', onTargetScroll)
      window.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
    }
  }, [measure, targetRef])

  const onProxyScroll = () => {
    const target = targetRef.current
    const proxy = proxyRef.current
    if (!target || !proxy || syncing.current) return
    syncing.current = true
    target.scrollLeft = proxy.scrollLeft
    requestAnimationFrame(() => {
      syncing.current = false
    })
  }

  if (!metrics || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="cap-sticky-scrollbar"
      style={{ left: metrics.left, width: metrics.width }}
    >
      <div
        ref={proxyRef}
        className="cap-sticky-scrollbar__track"
        role="scrollbar"
        aria-orientation="horizontal"
        aria-label={label}
        tabIndex={-1}
        onScroll={onProxyScroll}
      >
        {/* Nothing to see: its only job is to be exactly as wide as the table. */}
        <div className="cap-sticky-scrollbar__spacer" style={{ width: metrics.contentWidth }} />
      </div>
    </div>,
    document.body,
  )
}
