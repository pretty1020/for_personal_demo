// Lists source files no entry point can reach, so dead code can be removed with evidence
// instead of guesswork. Read-only: prints paths, deletes nothing.
//
// Tests are not entry points on purpose. A module kept alive only by its own test is
// either dead or not yet wired up, and that difference needs a human to judge.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

const files = []
;(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full)
    else if (/\.tsx?$/.test(full)) files.push(full)
  }
})(src)

const isTest = (file) => /\.test\.tsx?$/.test(file)

/** Resolves a relative specifier the way Vite would, trying each extension. */
function resolveImport(fromFile, spec) {
  if (!spec.startsWith('.')) return null
  const base = resolve(dirname(fromFile), spec)
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

const edges = new Map()
for (const file of files) {
  const source = readFileSync(file, 'utf8')
  const targets = new Set()
  // Covers `from '...'`, bare `import '...'` and dynamic `import('...')`.
  for (const match of source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
    const resolved = resolveImport(file, match[1])
    if (resolved) targets.add(resolved)
  }
  edges.set(file, targets)
}

const roots = [join(src, 'main.tsx'), join(src, 'embed', 'main.tsx')].filter(existsSync)

const reached = new Set()
const queue = [...roots]
while (queue.length) {
  const file = queue.pop()
  if (reached.has(file)) continue
  reached.add(file)
  for (const target of edges.get(file) ?? []) queue.push(target)
}

const unreachable = files
  .filter((file) => !reached.has(file) && !isTest(file))
  .map((file) => relative(src, file).replace(/\\/g, '/'))
  .sort()

console.log(`${files.length} files, ${reached.size} reachable, ${unreachable.length} unreachable\n`)
for (const file of unreachable) {
  // Flag anything a test still covers: likely unfinished work rather than dead code.
  const full = join(src, file)
  const covered = files.some((f) => isTest(f) && (edges.get(f) ?? new Set()).has(full))
  console.log(`${covered ? 'TESTED  ' : '        '}${file}`)
}
