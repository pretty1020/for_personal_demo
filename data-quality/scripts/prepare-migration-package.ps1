# Rebuild migration-package for WinSCP / SQLyog / PuTTY deploy.
# Operators use ONLY migration-package/ (01-sqlyog, 02-winscp-upload, 03-putty).
# Run from repo root:  powershell -File .\scripts\prepare-migration-package.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $root 'package.json'))) {
  $root = (Get-Location).Path
}
$pkg = Join-Path $root 'migration-package'
$dest = Join-Path $pkg '02-winscp-upload'
$sqlyog = Join-Path $pkg '01-sqlyog'
$putty = Join-Path $pkg '03-putty'

Write-Host "Preparing $pkg from $root"

New-Item -ItemType Directory -Force -Path @($sqlyog, $dest, $putty) | Out-Null

# --- 01-sqlyog: canonical MariaDB scripts ---
foreach ($name in @(
  '001_initial_schema.sql',
  '002_capacity_schema.sql',
  '003_capacity_demo_users.sql',
  '004_capacity_users_active.sql',
  '005_capacity_users_analyst.sql',
  '006_capacity_clients.sql',
  '007_capacity_documents.sql',
  '008_capacity_audit_and_settings.sql',
  '009_drop_ai_assistant_column.sql',
  '010_capacity_reporting_views.sql'
)) {
  Copy-Item (Join-Path $root "database\mariadb\$name") (Join-Path $sqlyog $name) -Force
}

# --- 02-winscp-upload: clean app tree ---
foreach ($name in @('src', 'public', 'database', 'capacity', 'data')) {
  $p = Join-Path $dest $name
  if (Test-Path $p) { Remove-Item $p -Recurse -Force }
}

robocopy (Join-Path $root 'src') (Join-Path $dest 'src') /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
robocopy (Join-Path $root 'public') (Join-Path $dest 'public') /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
robocopy (Join-Path $root 'database') (Join-Path $dest 'database') /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
robocopy (Join-Path $root 'capacity') (Join-Path $dest 'capacity') /E /NFL /NDL /NJH /NJS /nc /ns /np `
  /XD node_modules dist .tmp-vite-deps .git `
  /XF .env .env.local .env.example | Out-Null

# The one maintainer script the server genuinely needs: package.json's prebuild hook runs
# it, and without it `npm run build` fails on the server before Next.js starts.
$scriptsDir = Join-Path $dest 'scripts'
New-Item -ItemType Directory -Force -Path $scriptsDir | Out-Null
Copy-Item (Join-Path $root 'scripts\build-capacity-embed.mjs') $scriptsDir -Force

foreach ($d in @('uploads', 'processed', 'watch', 'standalone')) {
  $dir = Join-Path $dest "data\$d"
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $keep = Join-Path $root "data\$d\.gitkeep"
  if (Test-Path $keep) { Copy-Item $keep (Join-Path $dir '.gitkeep') -Force }
  else { New-Item -ItemType File -Force -Path (Join-Path $dir '.gitkeep') | Out-Null }
}

# Root build files only (do NOT copy .env.example — operators must use .env.production.example)
$rootFiles = @(
  'package.json', 'package-lock.json', 'next.config.ts', 'tsconfig.json', 'next-env.d.ts',
  'postcss.config.mjs', 'tailwind.config.ts', 'eslint.config.mjs', 'vercel.json',
  '.gitignore', 'DEPLOYMENT.md', 'README.md'
)
foreach ($f in $rootFiles) {
  $p = Join-Path $root $f
  if (Test-Path $p) { Copy-Item $p $dest -Force }
}

# Strip secrets if any slipped in
Remove-Item (Join-Path $dest '.env') -ErrorAction SilentlyContinue
Remove-Item (Join-Path $dest '.env.local') -ErrorAction SilentlyContinue
Remove-Item (Join-Path $dest '.env.example') -ErrorAction SilentlyContinue
Remove-Item (Join-Path $dest 'capacity\.env') -ErrorAction SilentlyContinue
Remove-Item (Join-Path $dest 'capacity\.env.local') -ErrorAction SilentlyContinue
Remove-Item (Join-Path $dest 'capacity\.env.example') -ErrorAction SilentlyContinue

# Operator docs inside the upload tree.
# MIGRATION-README is read ON THE SERVER, where 01-sqlyog/, 03-putty/, START-HERE.txt
# and scripts/ do not exist. Rewrite those references so no path is a dead end.
$readme = [System.IO.File]::ReadAllText((Join-Path $pkg 'README.md'))

$readme = $readme -replace '(?s)\*\*Use only this.*?\| 3 \| \*\*PuTTY\*\*[^\r\n]*\r?\n', @'
**You are reading this on the server.** This folder is the uploaded app; the
SQLyog scripts also ship here under `database/mariadb/`.

Server steps: **`SERVER-SETUP.txt`** in this folder.

'@

# Maintainer-only blocks: Windows PowerShell, and scripts/ is not uploaded.
$readme = $readme -replace '(?s)To refresh this package after code changes \(maintainers\):\s*```powershell.*?```\s*', ''
$readme = $readme -replace '(?s)### Maintainer pre-flight \(before WinSCP\).*?Then upload the refreshed[^\r\n]*\r?\n', ''

$readme = $readme -replace '2\. Run in order \(`01-sqlyog/`\):', '2. Run in order (from `database/mariadb/` in this folder):'
$readme = $readme -replace 'Details: `01-sqlyog/README-SQLyog\.txt`', 'Details: `README-WinSCP.txt` and `SERVER-SETUP.txt`'
$readme = $readme -replace 'Details: `02-winscp-upload/README-WinSCP\.txt`', 'Details: `README-WinSCP.txt`'
$readme = $readme -replace '1\. Open `migration-package/02-winscp-upload/`', '1. Open the `02-winscp-upload/` folder on your PC'
$readme = $readme -replace '2\. Follow `03-putty/README-PuTTY\.txt` or `SERVER-SETUP\.txt` on the server\.', '2. Follow `SERVER-SETUP.txt` in this folder.'
$readme = $readme -replace '`01-sqlyog/003_capacity_demo_users\.sql`', '`database/mariadb/003_capacity_demo_users.sql`'
# On the server both of these sit in the app folder, not under 03-putty.
$readme = $readme -replace '`03-putty/nginx-data-quality-tool\.conf`', '`nginx-data-quality-tool.conf`'
$readme = $readme -replace 'Section 10 of\r?\n`03-putty/README-PuTTY\.txt`', 'Section 10 of `SERVER-SETUP.txt`'

[System.IO.File]::WriteAllText((Join-Path $dest 'MIGRATION-README.md'), $readme, [System.Text.UTF8Encoding]::new($false))

Copy-Item (Join-Path $putty 'env.production.example') (Join-Path $dest '.env.production.example') -Force

# Ship the Nginx template with the app so the operator can copy it straight into
# /etc/nginx from the folder they are already standing in over SSH.
Copy-Item (Join-Path $putty 'nginx-data-quality-tool.conf') $dest -Force

# SERVER-SETUP.txt is the PuTTY guide read on the server, where ../START-HERE.txt
# is not present. Drop that pointer; keep the file otherwise identical.
$puttyDoc = [System.IO.File]::ReadAllText((Join-Path $putty 'README-PuTTY.txt'))
$puttyDoc = $puttyDoc -replace 'This is step 3 of migration-package \(see \.\./START-HERE\.txt\)\.\r?\n[^\r\n]*\r?\n', "You are in the uploaded app folder. Run these steps over SSH.`r`n"
# The Nginx template is uploaded alongside the app, so on the server it sits here,
# not in a 03-putty folder the operator never sees.
$puttyDoc = $puttyDoc -replace '\(in this same 03-putty folder\)', '(in this folder, next to package.json)'
[System.IO.File]::WriteAllText((Join-Path $dest 'SERVER-SETUP.txt'), $puttyDoc, [System.Text.UTF8Encoding]::new($false))

# Shell script with LF endings for Linux servers
$shSrc = Join-Path $putty 'server-commands.sh'
$shText = [System.IO.File]::ReadAllText($shSrc) -replace "`r`n", "`n" -replace "`r", "`n"
[System.IO.File]::WriteAllText((Join-Path $dest 'server-commands.sh'), $shText, [System.Text.UTF8Encoding]::new($false))
[System.IO.File]::WriteAllText($shSrc, $shText, [System.Text.UTF8Encoding]::new($false))

# Sanity checks
# Each embed build wipes and regenerates the hashed chunks, so a half-copied
# public/capacity would ship an embed.js pointing at chunks that do not exist.
# That fails only in the browser, at runtime, as a MIME type error - catch it here.
$embed = Join-Path $dest 'public\capacity\embed.js'
if (-not (Test-Path $embed)) {
  Write-Warning "public/capacity/embed.js missing - run npm run build:capacity-embed before prepare."
} else {
  $chunkDir = Join-Path $dest 'public\capacity\chunks'
  $present = @()
  if (Test-Path $chunkDir) {
    $present = Get-ChildItem $chunkDir -Filter '*.js' | Select-Object -ExpandProperty Name
  }
  $referenced = [regex]::Matches(
    [System.IO.File]::ReadAllText($embed), 'chunks/([A-Za-z0-9._-]+\.js)'
  ) | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique

  $missingChunks = @($referenced | Where-Object { $present -notcontains $_ })
  if ($missingChunks.Count -gt 0) {
    throw "Migration package incomplete: embed.js references $($missingChunks.Count) missing chunk(s), e.g. $($missingChunks[0]). Run npm run build:capacity-embed, then prepare again."
  }
  Write-Host "Embed OK: $($referenced.Count) chunks referenced, all present."
}
$required = @(
  'package.json',
  'package-lock.json',
  'next.config.ts',
  '.env.production.example',
  'SERVER-SETUP.txt',
  'server-commands.sh',
  'nginx-data-quality-tool.conf',
  'capacity\package.json',
  'capacity\scripts\db-setup.mjs',
  'scripts\build-capacity-embed.mjs',
  'database\mariadb\002_capacity_schema.sql',
  'database\mariadb\006_capacity_clients.sql',
  'database\mariadb\007_capacity_documents.sql',
  'database\mariadb\008_capacity_audit_and_settings.sql',
  'database\mariadb\009_drop_ai_assistant_column.sql',
  'database\mariadb\010_capacity_reporting_views.sql',
  'src\app\api\capacity\health\route.ts',
  'src\app\api\capacity\clients\route.ts',
  'src\app\api\capacity\clients\[id]\route.ts',
  'src\app\api\capacity\documents\route.ts',
  'src\app\api\capacity\settings\route.ts',
  'src\app\api\capacity\audit\route.ts'
)
foreach ($rel in $required) {
  # -LiteralPath: route folders like [id] are wildcards to Test-Path otherwise.
  if (-not (Test-Path -LiteralPath (Join-Path $dest $rel))) {
    throw "Migration package incomplete: missing $rel in 02-winscp-upload"
  }
}
foreach ($name in @(
  '001_initial_schema.sql',
  '002_capacity_schema.sql',
  '003_capacity_demo_users.sql',
  '004_capacity_users_active.sql',
  '005_capacity_users_analyst.sql',
  '006_capacity_clients.sql',
  '007_capacity_documents.sql',
  '008_capacity_audit_and_settings.sql',
  '009_drop_ai_assistant_column.sql',
  '010_capacity_reporting_views.sql',
  'README-SQLyog.txt'
)) {
  if (-not (Test-Path (Join-Path $sqlyog $name))) {
    throw "Migration package incomplete: missing 01-sqlyog/$name"
  }
}

$mb = [math]::Round(((Get-ChildItem $pkg -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 1)
$files = (Get-ChildItem $dest -Recurse -File | Measure-Object).Count
Write-Host "Done: $mb MB, $files files in 02-winscp-upload"
Write-Host "Operators: use migration-package/START-HERE.txt"
Write-Host "Open migration-package/README.md for deploy steps."
