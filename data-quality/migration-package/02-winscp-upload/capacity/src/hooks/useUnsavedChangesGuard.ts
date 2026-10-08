import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

type UnsavedChangesGuardOptions = {
  when: boolean
}

function isInternalPath(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//')
}

function normalizePath(href: string): string {
  try {
    const url = new URL(href, window.location.origin)
    return url.pathname + url.search + url.hash
  } catch {
    return href
  }
}

export function useUnsavedChangesGuard({ when }: UnsavedChangesGuardOptions) {
  const navigate = useNavigate()
  const location = useLocation()
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null)
  const whenRef = useRef(when)
  whenRef.current = when

  const currentPath = location.pathname + location.search + location.hash

  useEffect(() => {
    if (!when) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [when])

  useEffect(() => {
    if (!when) return

    const onClick = (event: MouseEvent) => {
      if (!whenRef.current) return
      if (event.defaultPrevented) return
      if (event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

      const target = event.target
      if (!(target instanceof Element)) return
      const anchor = target.closest('a[href]')
      if (!anchor || anchor.getAttribute('target') === '_blank') return

      const href = anchor.getAttribute('href')
      if (!href || !isInternalPath(href)) return

      const nextPath = normalizePath(href)
      if (nextPath === currentPath) return

      event.preventDefault()
      event.stopPropagation()
      setPendingNavigation(nextPath)
    }

    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [currentPath, when])

  const isBlocked = pendingNavigation != null

  const proceed = useCallback(() => {
    const next = pendingNavigation
    setPendingNavigation(null)
    if (!next) return
    navigate(next)
  }, [navigate, pendingNavigation])

  const cancel = useCallback(() => {
    setPendingNavigation(null)
  }, [])

  return { isBlocked, proceed, cancel }
}
