/**
 * Builds the portal and copies it into public/ so this Next app can serve it
 * at / while Data Quality keeps /dashboard, /reports, and the rest.
 */
import { cpSync, existsSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dataQualityRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(dataQualityRoot, '..')
const dashboardRoot = join(repoRoot, 'excel-dashboard')
const dist = join(dashboardRoot, 'dist')
const pub = join(dataQualityRoot, 'public')

function run(args, cwd) {
  const result = spawnSync('npm', args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1)
}

if (!existsSync(join(dashboardRoot, 'node_modules', 'vite', 'package.json'))) {
  console.log('Installing portal dependencies…')
  run(['install', '--prefix', dashboardRoot], repoRoot)
}

console.log('Building portal…')
run(['run', 'build', '--prefix', dashboardRoot], repoRoot)

if (!existsSync(join(dist, 'index.html'))) {
  throw new Error('Portal build did not produce excel-dashboard/dist/index.html')
}

for (const entry of readdirSync(dist)) {
  const from = join(dist, entry)
  if (entry === 'index.html') {
    cpSync(from, join(pub, 'portal-index.html'))
    continue
  }
  if (entry !== 'assets' && existsSync(join(pub, entry))) continue
  cpSync(from, join(pub, entry), { recursive: true })
}

console.log('Portal files copied into data-quality/public.')
