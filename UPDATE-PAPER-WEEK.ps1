param([string]$Revision = 'codex/paper-week')
$ErrorActionPreference = 'Stop'
if (!(Test-Path -LiteralPath 'paper-week\engine.js') -or !(Test-Path -LiteralPath 'package.json')) {
    throw 'Open PowerShell in the existing PAPER WEEK project folder first.'
}
if ($Revision -notmatch '^[a-zA-Z0-9/_-]+$') { throw 'Invalid revision.' }
$nodeVersion = & node --version
if ($LASTEXITCODE -ne 0 -or [int](($nodeVersion -replace '^v', '').Split('.')[0]) -lt 24) { throw 'Node.js 24 or newer is required.' }
$base = "https://raw.githubusercontent.com/nguyenvietkhanh/trade-meme/$Revision"
$allowed = @('package.json', 'README.md', 'HUONG-DAN-PAPER-WEEK.txt', 'paper-week.env.example',
    'paper-week/engine.js', 'paper-week/momentum.js', 'paper-week/readonly.js', 'paper-week/market.js',
    'paper-week/server.js', 'paper-week/app.js', 'paper-week/index.html', 'paper-week/TRAINING-SCHEMA.txt',
    'paper-week/analyze.js', 'paper-week/store.js', 'paper-week/scalp-config.json', 'paper-week/scalp-config.js',
    'paper-week/scalp-stages.js', 'paper-week/scalp-engine.js', 'paper-week/scalp-feed.js',
    'paper-week/scalp-log.js', 'paper-week/curve-feed.js', 'paper-week/SCALP-SPEC.md', 'paper-week/SCALP-REQUEST.txt')
$tag = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$stage = Join-Path (Get-Location) ".paper-code-stage-$tag"
$backup = Join-Path (Get-Location) ".paper-code-backup-$tag"
New-Item -ItemType Directory -Path $stage | Out-Null
try {
    $manifestPath = Join-Path $stage 'manifest.json'
    Invoke-WebRequest -UseBasicParsing "$base/paper-week/update-manifest.json" -OutFile $manifestPath
    $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
    if ($manifest.strategy -ne 'paper-meme-scalp-entry-v1' -or @($manifest.files).Count -ne $allowed.Count) {
        throw 'Unexpected update manifest; no files have been replaced.'
    }
    $names = @{}
    foreach ($item in $manifest.files) {
        if ($item.path -notin $allowed -or $names.ContainsKey($item.path) -or $item.sha256 -notmatch '^[a-f0-9]{64}$') {
            throw 'Invalid update file; no files have been replaced.'
        }
        $names[$item.path] = $true
        $file = Join-Path $stage $item.path
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $file) | Out-Null
        Invoke-WebRequest -UseBasicParsing "$base/$($item.path)" -OutFile $file
        if ((Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash.ToLowerInvariant() -ne $item.sha256) {
            throw "Download checksum mismatch: $($item.path). No files have been replaced."
        }
        if ($item.path.EndsWith('.js')) {
            & node --check $file
            if ($LASTEXITCODE -ne 0) { throw "JavaScript syntax check failed: $($item.path)" }
        }
    }
    New-Item -ItemType Directory -Path $backup | Out-Null
    $applied = @()
    try {
        foreach ($item in $manifest.files) {
            $target = Join-Path (Get-Location) $item.path
            $saved = Join-Path $backup $item.path
            $existed = Test-Path -LiteralPath $target
            if ($existed) {
                New-Item -ItemType Directory -Force -Path (Split-Path -Parent $saved) | Out-Null
                Copy-Item -LiteralPath $target -Destination $saved
            }
            $applied += @{ Path = $target; Backup = $saved; Existed = $existed }
            Copy-Item -Force -LiteralPath (Join-Path $stage $item.path) -Destination $target
        }
    } catch {
        foreach ($row in $applied) {
            if ($row.Existed) { Copy-Item -Force -LiteralPath $row.Backup -Destination $row.Path }
            elseif (Test-Path -LiteralPath $row.Path) { Remove-Item -LiteralPath $row.Path }
        }
        throw
    }
    Write-Host "Updated: paper-meme-scalp-entry-v1. Code backup: $backup"
    Write-Host 'Virtual balance, .paper-week, paper-week.env and Telegram settings were preserved.'
    Write-Host 'Run START-PAPER-WEEK.cmd to start. No new environment variables are required.'
} finally {
    if (Test-Path -LiteralPath $stage) { Remove-Item -Recurse -Force -LiteralPath $stage }
}
