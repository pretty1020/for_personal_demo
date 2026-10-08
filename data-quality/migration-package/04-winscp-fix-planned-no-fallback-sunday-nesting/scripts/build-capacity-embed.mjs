/**
 * Builds the Capacity embed before `next build`, but only when it can and needs to.
 *
 * The embed is built with vite, which lives in capacity's devDependencies. A production
 * server usually installs with NODE_ENV=production, so npm skips devDependencies and
 * vite is simply not there. Running it unconditionally meant `npm run build` failed on
 * the server with "'vite' is not recognized" — before Next.js had done anything.
 *
 * The migration package already contains a built embed.js and its chunks, so on a
 * deployment there is nothing to rebuild. This script therefore:
 *
 *   toolchain present            -> build, exactly as before (developer machine)
 *   no toolchain, assets present -> verify chunks then skip (server deploy)
 *   no toolchain, no assets      -> fail with the command that fixes it
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// Presence of the package itself, rather than a .bin shim whose name differs per platform.
const toolchainInstalled = existsSync(join(root, 'capacity', 'node_modules', 'vite', 'package.json'))
const capacityDir = join(root, 'public', 'capacity')
const builtEmbed = join(capacityDir, 'embed.js')
const chunkDir = join(capacityDir, 'chunks')
const embedPresent = existsSync(builtEmbed)

function chunkNamesFromText(text) {
  return [...text.matchAll(/\.\/chunks\/([A-Za-z0-9_.-]+\.js)/g)].map((match) => match[1])
}

function chunkNamesFromChunks(dir) {
  if (!existsSync(dir)) return []
  const names = new Set()
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.js'))) {
    names.add(file)
    const text = readFileSync(join(dir, file), 'utf8')
    // Match "./chunk.js" but not "../embed.js" (lookbehind avoids the ../ case).
    for (const match of text.matchAll(/(?<!\.)\.\/([A-Za-z0-9_.-]+\.js)/g)) {
      if (match[1] === 'embed.js') continue
      names.add(match[1])
    }
  }
  return [...names]
}

/** Fail the server build early if embed.js or a required chunk was not uploaded. */
function assertPrebuiltEmbedComplete() {
  if (!existsSync(join(capacityDir, 'embed.css'))) {
    throw new Error('public/capacity/embed.css is missing. Re-upload the WinSCP Capacity package.')
  }
  if (!existsSync(chunkDir)) {
    throw new Error('public/capacity/chunks/ is missing. Re-upload the WinSCP Capacity package.')
  }

  const embedText = readFileSync(builtEmbed, 'utf8')
  const required = new Set([
    ...chunkNamesFromText(embedText),
    ...chunkNamesFromChunks(chunkDir),
  ])
  const onDisk = new Set(readdirSync(chunkDir).filter((name) => name.endsWith('.js')))
  const missing = [...required].filter((name) => !onDisk.has(name)).sort()
  if (missing.length) {
    throw new Error(
      `Capacity embed is incomplete — missing chunks:\n  ${missing.join('\n  ')}\n` +
        'Upload the full public/capacity folder from the latest WinSCP package, then rebuild.',
    )
  }
  console.log(`Capacity embed: prebuilt OK (${onDisk.size} chunks on disk).`)
}

if (toolchainInstalled) {
  const result = spawnSync('npm', ['run', 'build:embed', '--prefix', 'capacity'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  process.exit(result.status ?? 1)
}

if (embedPresent) {
  try {
    assertPrebuiltEmbedComplete()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
  console.log('  (vite is not installed here, which is expected on a deployment server.)')
  console.log('  To rebuild it instead, run: npm install --prefix capacity')
  process.exit(0)
}

console.error('Cannot produce the Capacity embed.')
console.error('  public/capacity/embed.js is missing and vite is not installed.')
console.error('  Fix with:  npm install --prefix capacity && npm run build:capacity-embed')
process.exit(1)
