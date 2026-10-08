import esbuild from 'esbuild'
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const apiRoot = 'api'

function collectHandlers(dir) {
  /** @type {string[]} */
  const handlers = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name === '_lib' || name === '.build-src') continue
      handlers.push(...collectHandlers(path))
      continue
    }
    if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
      handlers.push(path)
    }
  }
  return handlers
}

const handlers = collectHandlers(apiRoot)
if (!handlers.length) {
  console.warn('No API handlers found to bundle.')
  process.exit(0)
}

await Promise.all(
  handlers.map(async (entry) => {
    const outfile = entry.replace(/\.ts$/, '.js')
    await esbuild.build({
      entryPoints: [entry],
      outfile,
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'cjs',
      sourcemap: true,
      logLevel: 'warning',
      external: ['@vercel/node'],
    })
  }),
)

console.log(`Bundled ${handlers.length} API handler(s) for local testing:`)
for (const entry of handlers) {
  console.log(`  ${relative(apiRoot, entry).replace(/\.ts$/, '.js')}`)
}
