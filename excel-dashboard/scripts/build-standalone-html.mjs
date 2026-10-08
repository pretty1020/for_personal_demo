/**
 * Produces a single self-contained HTML file (no Node/npm required to run).
 * Open the output in a browser — works from disk (file://) when served as one inline script (IIFE).
 */
import * as esbuild from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const outDir = path.join(root, '.tmp-standalone-html')

fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

const jsPath = path.join(outDir, 'bundle.js')
const cssPath = path.join(outDir, 'bundle.css')

await esbuild.build({
  absWorkingDir: root,
  entryPoints: ['src/main.tsx'],
  bundle: true,
  outfile: jsPath,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  jsxImportSource: 'react',
  minify: true,
  legalComments: 'none',
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  logLevel: 'info',
})

const js = fs.readFileSync(jsPath, 'utf8')
const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : ''

/* Prevent inline script from terminating the host <script> element */
const escapeScriptClose = '<' + String.fromCharCode(92) + '/script>'
const safeJs = js.replace(/<\/script>/gi, escapeScriptClose)

const html = `<!DOCTYPE html>
<!--
  SMART EXCEL DASHBOARD — STANDALONE REPORT TEMPLATE (single file, no install for readers)

  USE: Save this file, double-click it, or use File → Open in your browser.
  DATA: Excel is parsed only inside the browser; nothing is uploaded to a server.

  FONTS: Inter loads from Google Fonts if online; offline, the UI uses normal system fonts.

  REBUILD (authors): in the excel-dashboard project run: npm install && npm run build:html
-->
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="description" content="Smart Excel Dashboard — runs entirely in your browser. No server or install required." />
<title>Smart Excel Dashboard Builder</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
<style>
${css}
</style>
</head>
<body>
<div id="root"></div>
<script>
${safeJs}
</script>
</body>
</html>
`

const outPath = path.join(root, 'SmartExcelDashboard.standalone.html')
fs.writeFileSync(outPath, html, 'utf8')

const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1)
console.log(`\nStandalone template written: ${outPath} (${kb} KB)`)
console.log('Share this single HTML file. Recipients can open it directly in Chrome, Edge, or Firefox.')
