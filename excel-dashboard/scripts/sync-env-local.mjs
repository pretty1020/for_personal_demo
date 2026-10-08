import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dashboardRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(dashboardRoot, '..')

function parseEnv(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
  const vars = {}
  let currentKey = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) {
      if (currentKey) vars[currentKey] += line
      continue
    }
    currentKey = line.slice(0, eq)
    vars[currentKey] = line.slice(eq + 1)
  }
  return vars
}

const rootEnvPath = path.join(repoRoot, '.env.local')
const dashEnvPath = path.join(dashboardRoot, '.env.local')
const root = fs.existsSync(rootEnvPath) ? parseEnv(rootEnvPath) : {}
const dash = fs.existsSync(dashEnvPath) ? parseEnv(dashEnvPath) : {}

const merged = {
  DATABASE_URL: dash.DATABASE_URL || root.DATABASE_URL || '',
  VITE_API_BASE_URL: dash.VITE_API_BASE_URL || root.VITE_API_BASE_URL || '/api',
  ROSTER_API_URL: dash.ROSTER_API_URL || root.ROSTER_API_URL || '',
  ROSTER_API_KEY: dash.ROSTER_API_KEY || root.ROSTER_API_KEY || '',
  OPENAI_API_KEY: root.OPENAI_API_KEY || dash.OPENAI_API_KEY || '',
}

const lines = [
  `DATABASE_URL=${merged.DATABASE_URL}`,
  `VITE_API_BASE_URL=${merged.VITE_API_BASE_URL}`,
  `ROSTER_API_URL=${merged.ROSTER_API_URL}`,
  `ROSTER_API_KEY=${merged.ROSTER_API_KEY}`,
  '',
  '# OpenAI - AI Assistant (server-only)',
  `OPENAI_API_KEY=${merged.OPENAI_API_KEY}`,
  '# Optional: OPENAI_MODEL=gpt-4o-mini',
  '',
]

fs.writeFileSync(dashEnvPath, lines.join('\n'), { encoding: 'utf8' })
console.log(`Wrote ${dashEnvPath}`)
console.log(`OPENAI_API_KEY ${merged.OPENAI_API_KEY.length > 10 ? 'present' : 'missing'}`)
