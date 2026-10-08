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
 *   no toolchain, assets present -> skip and say so (server deploy)
 *   no toolchain, no assets      -> fail with the command that fixes it
 */
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// Presence of the package itself, rather than a .bin shim whose name differs per platform.
const toolchainInstalled = existsSync(join(root, 'capacity', 'node_modules', 'vite', 'package.json'))
const builtEmbed = join(root, 'public', 'capacity', 'embed.js')
const embedPresent = existsSync(builtEmbed)

if (toolchainInstalled) {
  const result = spawnSync('npm', ['run', 'build:embed', '--prefix', 'capacity'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  process.exit(result.status ?? 1)
}

if (embedPresent) {
  console.log('Capacity embed: using the prebuilt public/capacity/embed.js.')
  console.log('  (vite is not installed here, which is expected on a deployment server.)')
  console.log('  To rebuild it instead, run: npm install --prefix capacity')
  process.exit(0)
}

console.error('Cannot produce the Capacity embed.')
console.error('  public/capacity/embed.js is missing and vite is not installed.')
console.error('  Fix with:  npm install --prefix capacity && npm run build:capacity-embed')
process.exit(1)
