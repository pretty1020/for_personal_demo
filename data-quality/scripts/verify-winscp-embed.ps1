# Verify public/capacity and a WinSCP package have every chunk embed.js references.
param(
  [string]$Package = 'migration-package/04-winscp-update-dbe-summary-fte'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Get-EmbedChunkNames([string]$embedPath) {
  if (-not (Test-Path $embedPath)) { return @() }
  $text = Get-Content -Raw -Path $embedPath
  return [regex]::Matches($text, '\./chunks/([A-Za-z0-9_.-]+\.js)') |
    ForEach-Object { $_.Groups[1].Value } |
    Sort-Object -Unique
}

function Assert-EmbedSet([string]$label, [string]$baseDir) {
  $embed = Join-Path $baseDir 'public\capacity\embed.js'
  $css = Join-Path $baseDir 'public\capacity\embed.css'
  $chunkDir = Join-Path $baseDir 'public\capacity\chunks'
  Write-Host ""
  Write-Host "=== $label ==="
  Write-Host "Base: $baseDir"

  if (-not (Test-Path $embed)) {
    Write-Host "FAIL: missing embed.js"
    return $false
  }
  if (-not (Test-Path $css)) {
    Write-Host "FAIL: missing embed.css"
    return $false
  }

  $required = New-Object System.Collections.Generic.HashSet[string]
  foreach ($name in (Get-EmbedChunkNames $embed)) { [void]$required.Add($name) }

  # Transitive stubs (dynamic imports) live as ./file.js inside other chunks.
  # Skip ../embed.js / ../embed.css — those are parent assets, not chunk files.
  if (Test-Path $chunkDir) {
    foreach ($file in Get-ChildItem $chunkDir -Filter *.js) {
      [void]$required.Add($file.Name)
      $text = Get-Content -Raw -Path $file.FullName
      foreach ($match in [regex]::Matches($text, '(?<!\.)\./([A-Za-z0-9_.-]+\.js)')) {
        $name = $match.Groups[1].Value
        if ($name -eq 'embed.js') { continue }
        [void]$required.Add($name)
      }
    }
  }

  Write-Host ("required chunk set: {0}" -f $required.Count)

  $missing = @()
  foreach ($name in ($required | Sort-Object)) {
    $path = Join-Path $chunkDir $name
    if (-not (Test-Path $path)) { $missing += $name }
  }

  $onDisk = @()
  if (Test-Path $chunkDir) {
    $onDisk = @(Get-ChildItem $chunkDir -Filter *.js | ForEach-Object { $_.Name })
    Write-Host ("chunks on disk: {0}" -f $onDisk.Count)
  } else {
    Write-Host "FAIL: missing chunks directory"
    return $false
  }

  if ($missing.Count) {
    Write-Host "FAIL: missing chunks:"
    $missing | ForEach-Object { Write-Host "  $_" }
    return $false
  }

  Write-Host "OK: all referenced chunks present (including dynamic-import stubs)"
  return $true
}

$okPublic = Assert-EmbedSet 'Repo public/capacity' $root
$pkgPath = Join-Path $root $Package
$okPkg = Assert-EmbedSet "WinSCP package $Package" $pkgPath

# Compare embed.js chunk lists between public and package
$publicChunks = Get-EmbedChunkNames (Join-Path $root 'public\capacity\embed.js')
$pkgChunks = Get-EmbedChunkNames (Join-Path $pkgPath 'public\capacity\embed.js')
Write-Host ""
Write-Host '=== public vs package embed.js ==='
if (($publicChunks -join ',') -eq ($pkgChunks -join ',')) {
  Write-Host 'OK: package embed.js chunk list matches public/capacity'
} else {
  Write-Host 'FAIL: package embed.js does not match current public/capacity'
  $onlyPublic = $publicChunks | Where-Object { $pkgChunks -notcontains $_ }
  $onlyPkg = $pkgChunks | Where-Object { $publicChunks -notcontains $_ }
  if ($onlyPublic) { Write-Host 'Only in public:'; $onlyPublic | ForEach-Object { Write-Host "  $_" } }
  if ($onlyPkg) { Write-Host 'Only in package:'; $onlyPkg | ForEach-Object { Write-Host "  $_" } }
  $okPkg = $false
}

# Stale package warning: older packages may have old hashes
Write-Host ""
Write-Host '=== Other 04-winscp packages (upload ONLY the latest) ==='
Get-ChildItem (Join-Path $root 'migration-package') -Directory |
  Where-Object { $_.Name -like '04-winscp*' } |
  Sort-Object LastWriteTime -Descending |
  ForEach-Object {
    $mark = if ($_.Name -eq (Split-Path $Package -Leaf)) { ' <- USE THIS' } else { '' }
    Write-Host ("{0}  {1}{2}" -f $_.LastWriteTime.ToString('yyyy-MM-dd HH:mm'), $_.Name, $mark)
  }

Write-Host ""
if ($okPublic -and $okPkg) {
  Write-Host 'RESULT: PASS — safe to upload the latest package via WinSCP'
  exit 0
} else {
  Write-Host 'RESULT: FAIL — fix chunk integrity before uploading'
  exit 1
}
