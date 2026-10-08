import { useLayoutEffect, useRef, useState } from 'react'
import {
  useExecChartCardExpanded,
  useExecChartInlineVisible,
  useExecChartPlotGeneration,
} from './ExecChartCardContext'

const MIN_W = 280
const MIN_H = 200

function measureHost(el: HTMLElement, expanded: boolean): { w: number; h: number } {
  const rect = el.getBoundingClientRect()
  const width = rect.width > 0 ? rect.width : el.offsetWidth || el.clientWidth
  const w = Math.max(MIN_W, width)
  const baseH = rect.height > 0 ? rect.height : w * 0.35
  const h = expanded
    ? Math.max(380, Math.min(520, w * 0.42))
    : Math.max(MIN_H, Math.min(360, Math.max(baseH, w * 0.35)))
  return { w, h }
}

export function useExecChartSize(deps: unknown[] = []) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const expanded = useExecChartCardExpanded()
  const inlineVisible = useExecChartInlineVisible()
  const plotGeneration = useExecChartPlotGeneration()
  const [size, setSize] = useState({ w: 640, h: 280 })

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return

    const apply = () => {
      const next = measureHost(el, expanded)
      setSize((prev) => (prev.w === next.w && prev.h === next.h ? prev : next))
    }

    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)

    const raf1 = requestAnimationFrame(apply)
    const raf2 = requestAnimationFrame(() => requestAnimationFrame(apply))

    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
      ro.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, inlineVisible, plotGeneration, ...deps])

  const ready =
    inlineVisible && size.w >= MIN_W && size.h >= MIN_H

  return { wrapRef, w: size.w, h: size.h, ready }
}
