import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

const RELOAD_KEY = 'wfp-chunk-reload'

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk [\w-]+ failed/i.test(
    message,
  )
}

export function reloadOnceForNewRelease(): boolean {
  try {
    if (sessionStorage.getItem(RELOAD_KEY) === '1') return false
    sessionStorage.setItem(RELOAD_KEY, '1')
  } catch {
    // still reload
  }
  window.location.reload()
  return true
}

export function clearChunkReloadFlag(): void {
  try {
    sessionStorage.removeItem(RELOAD_KEY)
  } catch {
    // ignore
  }
}

export function lazyWithReload<T extends ComponentType<any>>(
  loader: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      const mod = await loader()
      clearChunkReloadFlag()
      return mod
    } catch (error) {
      if (isChunkLoadError(error) && reloadOnceForNewRelease()) {
        return new Promise(() => undefined)
      }
      throw error
    }
  })
}
