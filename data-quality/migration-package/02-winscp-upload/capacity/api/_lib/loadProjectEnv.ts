import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

let loaded = false

function loadEnvFile(filePath: string, keys?: string[]): void {
  if (!existsSync(filePath)) return

  const text = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim()
    if (keys && !keys.includes(key)) continue
    if (!process.env[key]?.trim()) process.env[key] = value
  }
}

/** Load missing vars from .env.local for local dev only (never on Vercel production). */
export function loadProjectEnvLocal(keys?: string[]): void {
  if (loaded) return
  loaded = true

  // Vercel injects env vars at deploy time — never read filesystem there.
  // .env.local is gitignored and is NOT available on Vercel.
  if (process.env.VERCEL) return

  try {
    const cwd = process.cwd()
    // excel-dashboard/.env.local and repo-root/.env.local (when cwd is the dashboard)
    const candidates = [
      resolve(cwd, '.env.local'),
      resolve(cwd, '.env'),
      resolve(cwd, '..', '.env.local'),
      resolve(cwd, '..', '.env'),
    ]
    for (const filePath of candidates) {
      loadEnvFile(filePath, keys)
    }
  } catch (error) {
    console.warn('Could not load local env files:', error)
  }
}
