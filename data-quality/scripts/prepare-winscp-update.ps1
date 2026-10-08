# Build a WinSCP "update" folder holding ONLY the files a change touched, laid out
# exactly as they sit on the server so the folder can be dropped straight onto the app
# root without hunting for paths.
#
# Run from repo root:
#   powershell -File .\scripts\prepare-winscp-update.ps1
#
# By default it takes the files currently changed in the working tree (including new
# untracked files). To package an already-committed change instead, diff against a ref:
#   powershell -File .\scripts\prepare-winscp-update.ps1 -Since HEAD~1
#
# -Name overrides the output folder, which otherwise carries today's date.

param(
  [string]$Since = '',
  [string]$Name = ''
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $root 'package.json'))) { $root = (Get-Location).Path }
Set-Location $root

$folderName = if ($Name) { $Name } else { "04-winscp-update-$(Get-Date -Format 'yyyy-MM-dd')" }
$dest = Join-Path $root "migration-package\$folderName"

# Only these live on the server. Anything else changed in the repo (docs, the migration
# package itself, editor config) is not something WinSCP should carry up.
$deployRoots = @('src', 'public', 'capacity', 'database')
# scripts/ is a maintainer folder; the package builder ships exactly one file out of it,
# the prebuild hook that `npm run build` cannot start without.
$deployRootFiles = @(
  'package.json', 'package-lock.json', 'next.config.ts', 'tsconfig.json',
  'postcss.config.mjs', 'tailwind.config.ts', 'eslint.config.mjs', 'vercel.json',
  'next-env.d.ts', '.env.production.example', 'scripts/build-capacity-embed.mjs'
)

function Test-Deployable([string]$path) {
  if ($path -like 'migration-package/*') { return $false }
  if ($path -match '(^|/)node_modules/') { return $false }
  if ($path -match '(^|/)(dist|\.next|\.tmp-vite-deps)/') { return $false }
  if ($path -match '(^|/)\.env(\.local|\.example)?$') { return $false }
  if ($deployRootFiles -contains $path) { return $true }
  foreach ($dir in $deployRoots) { if ($path -like "$dir/*") { return $true } }
  return $false
}

# --- collect changed paths -------------------------------------------------------
$changed = New-Object System.Collections.Generic.List[string]
$removed = New-Object System.Collections.Generic.List[string]

# git writes notes such as the CRLF warning to stderr, which under ErrorActionPreference
# 'Stop' would abort the script even though the command succeeded.
function Get-GitLines {
  param([string[]]$GitArgs)
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & git @GitArgs 2>$null } finally { $ErrorActionPreference = $previous }
}

if ($Since) {
  # No second ref, so this compares the working tree to $Since and picks up edits that
  # have not been committed yet.
  foreach ($line in (Get-GitLines @('diff', '--name-status', $Since, '--', '.'))) {
    if (-not $line) { continue }
    $parts = $line -split "`t"
    $status = $parts[0]
    $path = $parts[-1]
    if ($status -like 'D*') { $removed.Add($path) } else { $changed.Add($path) }
  }
  # git diff never reports untracked files; a brand new file is still part of the change.
  foreach ($path in (Get-GitLines @('ls-files', '--others', '--exclude-standard'))) {
    if ($path) { $changed.Add($path) }
  }
} else {
  foreach ($line in (Get-GitLines @('status', '--porcelain'))) {
    if (-not $line) { continue }
    $status = $line.Substring(0, 2)
    $path = $line.Substring(3).Trim('"')
    # Renames read "old -> new"; only the new path is uploadable.
    if ($path -match ' -> ') { $path = ($path -split ' -> ')[-1] }
    if ($status -match 'D') { $removed.Add($path) } else { $changed.Add($path) }
  }
}

# Untracked directories show up as "dir/" with no children. Expand them to real files
# so new API routes (e.g. src/app/api/capacity/staffing-plan/route.ts) are packaged.
$expanded = New-Object System.Collections.Generic.List[string]
foreach ($path in $changed) {
  $normalized = $path.TrimEnd('/', '\')
  $full = Join-Path $root ($normalized -replace '/', '\')
  if ((Test-Path $full) -and (Get-Item $full).PSIsContainer) {
    Get-ChildItem $full -Recurse -File | ForEach-Object {
      $rel = $_.FullName.Substring($root.Length).TrimStart('\', '/').Replace('\', '/')
      $expanded.Add($rel)
    }
  } else {
    $expanded.Add($normalized.Replace('\', '/'))
  }
}
$changed = $expanded

$files = $changed | Where-Object { Test-Deployable $_ } | Sort-Object -Unique
$stale = $removed | Where-Object { Test-Deployable $_ } | Sort-Object -Unique

if (-not $files) {
  Write-Warning 'Nothing deployable has changed. No folder written.'
  exit 0
}

# When the Capacity embed entrypoint changes, pack the ENTIRE public/capacity tree.
# Dynamic imports create stub chunks that are not named in embed.js; packing only the
# embed.js import list leaves the server with 404s (blank Capacity panel / module error).
function Get-EmbedChunkNames([string]$embedPath) {
  if (-not (Test-Path $embedPath)) { return @() }
  $text = Get-Content -Raw -Path $embedPath
  return [regex]::Matches($text, '\./chunks/([A-Za-z0-9_.-]+\.js)') |
    ForEach-Object { $_.Groups[1].Value } |
    Sort-Object -Unique
}

function Get-AllCapacityChunkNames([string]$chunkDir) {
  if (-not (Test-Path $chunkDir)) { return @() }
  return Get-ChildItem $chunkDir -Filter '*.js' | ForEach-Object { $_.Name } | Sort-Object
}

$embedInUpdate = $files | Where-Object { $_ -eq 'public/capacity/embed.js' -or $_ -like 'public/capacity/chunks/*' -or $_ -eq 'public/capacity/embed.css' }
if ($embedInUpdate) {
  $embedSource = Join-Path $root 'public\capacity\embed.js'
  $chunkDir = Join-Path $root 'public\capacity\chunks'
  $required = New-Object System.Collections.Generic.List[string]
  $required.Add('public/capacity/embed.js')
  if (Test-Path (Join-Path $root 'public\capacity\embed.css')) {
    $required.Add('public/capacity/embed.css')
  }
  # Prefer every chunk file on disk so stub/dynamic chunks are never left behind.
  $chunkNames = Get-AllCapacityChunkNames $chunkDir
  if (-not $chunkNames.Count) {
    $chunkNames = Get-EmbedChunkNames $embedSource
  }
  foreach ($name in $chunkNames) {
    $required.Add("public/capacity/chunks/$name")
  }
  $missingLocal = @()
  foreach ($rel in $required) {
    $source = Join-Path $root ($rel -replace '/', '\')
    if (-not (Test-Path $source)) {
      $missingLocal += $rel
      continue
    }
    if ($files -notcontains $rel) { $files = @($files) + $rel }
  }
  if ($missingLocal.Count) {
    throw ("Capacity embed references missing local files:`n  " + ($missingLocal -join "`n  "))
  }
  $files = $files | Sort-Object -Unique
}

# --- write the tree --------------------------------------------------------------
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
New-Item -ItemType Directory -Force -Path $dest | Out-Null

$copied = New-Object System.Collections.Generic.List[string]
foreach ($rel in $files) {
  $source = Join-Path $root ($rel -replace '/', '\')
  if (-not (Test-Path $source)) { continue }
  $target = Join-Path $dest ($rel -replace '/', '\')
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
  Copy-Item $source $target -Force
  $copied.Add($rel)
}

# Verify packaged embed.js can resolve every chunk inside this folder, and that no
# local chunk file was left out (dynamic-import stubs are not always listed in embed.js).
$packagedEmbed = Join-Path $dest 'public\capacity\embed.js'
if (Test-Path $packagedEmbed) {
  $packMissing = @()
  foreach ($name in (Get-EmbedChunkNames $packagedEmbed)) {
    $chunkPath = Join-Path $dest "public\capacity\chunks\$name"
    if (-not (Test-Path $chunkPath)) { $packMissing += "public/capacity/chunks/$name" }
  }
  $localChunkDir = Join-Path $root 'public\capacity\chunks'
  foreach ($name in (Get-AllCapacityChunkNames $localChunkDir)) {
    $chunkPath = Join-Path $dest "public\capacity\chunks\$name"
    if (-not (Test-Path $chunkPath)) { $packMissing += "public/capacity/chunks/$name" }
  }
  if ($packMissing.Count) {
    throw ("WinSCP package incomplete - missing Capacity chunks:`n  " + (($packMissing | Sort-Object -Unique) -join "`n  "))
  }
  $packCount = (Get-AllCapacityChunkNames (Join-Path $dest 'public\capacity\chunks')).Count
  Write-Host "Embed integrity OK: $packCount chunks packaged with embed.js (full public/capacity/chunks)"
}

# --- manifest --------------------------------------------------------------------
$manifest = @()
$manifest += 'Files in this folder, relative to the app root on the server.'
$manifest += "Generated $(Get-Date -Format 'yyyy-MM-dd HH:mm')."
$manifest += ''
foreach ($rel in $copied) {
  $size = [math]::Round((Get-Item (Join-Path $dest ($rel -replace '/', '\'))).Length / 1KB, 1)
  $manifest += ('{0,10} KB  {1}' -f $size, $rel)
}
if ($stale) {
  $manifest += ''
  $manifest += 'Replaced by this update. Safe to delete on the server, safe to leave:'
  foreach ($rel in $stale) { $manifest += "              $rel" }
}
Set-Content -Path (Join-Path $dest 'MANIFEST.txt') -Value $manifest -Encoding UTF8

# --- upload instructions ---------------------------------------------------------
$embedChanged = $copied | Where-Object { $_ -like 'public/capacity/*' }
$sqlChanged = $copied | Where-Object { $_ -like 'database/*' }
$buildInputChanged = $copied | Where-Object { $_ -like 'src/*' -or $_ -eq 'package.json' -or $_ -eq 'next.config.ts' }

$readme = @()
$readme += 'WinSCP update - upload these files onto the existing app'
$readme += '======================================================='
$readme += ''
$readme += 'This folder is NOT a full deployment. It holds only the files this change'
$readme += 'touched, in the same layout they have on the server, so you can drop them'
$readme += 'straight on top of the app folder.'
$readme += ''
$readme += '1. In WinSCP, open the app folder on the server, e.g.'
$readme += '     /var/www/Data_Quality_Tool'
$readme += ''
$readme += '2. Drag the CONTENTS of this folder (capacity/, public/, ...) onto it and'
$readme += '   let WinSCP overwrite. Keep the folder structure - do not flatten it.'
$readme += '   MANIFEST.txt and this file are notes for you; they do not need to go up.'
$readme += ''

if ($embedChanged) {
  $readme += '3. public/capacity/embed.js is the file that must not be skipped. This'
  $readme += '   package includes embed.js, embed.css, and EVERY chunk embed.js names,'
  $readme += '   so a WinSCP overwrite cannot leave missing /chunks/*.js files.'
  $readme += '   embed.js is served no-cache, so browsers pick it up without clearing cache.'
  $readme += ''
}

if ($sqlChanged) {
  $readme += '4. SQL changed in this update. Run the scripts under database/mariadb/ in'
  $readme += '   SQLyog before restarting the app. See 01-sqlyog/README-SQLyog.txt.'
  $readme += ''
} else {
  $readme += '4. No SQL to run. Nothing in this update changes the database schema.'
  $readme += ''
}

if ($buildInputChanged) {
  $readme += '5. Rebuild, then restart, in PuTTY:'
  $readme += '     cd /var/www/Data_Quality_Tool'
  $readme += '     npm run build'
  $readme += '     pm2 restart data-quality-tool     # or: npm run start'
  $readme += '   The Capacity embed is prebuilt and included above, so the build reuses'
  $readme += '   it rather than needing capacity build tools on the server.'
} else {
  $readme += '5. No rebuild needed: nothing here is compiled by `npm run build`. The'
  $readme += '   Capacity embed ships prebuilt and public/ is served straight from disk.'
  $readme += '   Restart so the new chunk filenames are picked up, in PuTTY:'
  $readme += '     cd /var/www/Data_Quality_Tool'
  $readme += '     pm2 restart data-quality-tool     # or stop and: npm run start'
  $readme += '   Running `npm run build` anyway is harmless if you prefer.'
}
$readme += ''

if ($stale) {
  $readme += 'Old files this update replaces:'
  foreach ($rel in $stale) { $readme += "  $rel" }
  $readme += 'They are no longer referenced. Delete them to keep the folder tidy, or'
  $readme += 'leave them - nothing loads them once the new embed.js is in place.'
  $readme += ''
}

$readme += 'If the Capacity pages show a blank panel or a module error afterwards, the'
$readme += 'browser is holding a stale embed.js. A hard reload (Ctrl+F5) settles it; the'
$readme += 'app also detects a stale chunk and reloads itself once.'

Set-Content -Path (Join-Path $dest 'README-UPLOAD.txt') -Value $readme -Encoding UTF8

$total = [math]::Round((Get-ChildItem $dest -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1KB, 1)
Write-Host "Done: $($copied.Count) files, $total KB"
Write-Host "  migration-package/$folderName"
Write-Host 'Upload its contents onto the app root, keeping the folder structure.'
