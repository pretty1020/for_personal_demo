/**
 * Installs both apps, then exposes the Data Quality app at the repo root
 * so Vercel's Next.js builder can see it.
 */
import { spawnSync } from 'node:child_process'
import { lstatSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function run(args) {
  const result = spawnSync('npm', args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1)
}

run(['install', '--prefix', 'data-quality'])
run(['install', '--prefix', 'data-quality/capacity'])
run(['install', '--prefix', 'excel-dashboard'])

const links = [
  ['src', 'data-quality/src'],
  ['public', 'data-quality/public'],
  ['node_modules', 'data-quality/node_modules'],
]

for (const [name, target] of links) {
  const dest = join(root, name)
  try {
    const current = lstatSync(dest)
    if (current.isSymbolicLink()) continue
    rmSync(dest, { recursive: true, force: true })
  } catch {
    // Nothing there yet.
  }
  symlinkSync(target, dest)
  console.log(`Linked ${name} -> ${target}`)
}
