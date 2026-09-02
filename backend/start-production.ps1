$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $scriptDir '.env.production'

if (-not (Test-Path $envFile)) {
    throw "Missing production environment file: $envFile"
}

Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*#' -or $_.Trim() -eq '') { return }

    $parts = $_ -split '=', 2
    if ($parts.Count -lt 2) { return }

    $name = $parts[0].Trim()
    $value = $parts[1].Trim().Trim('"')
    [System.Environment]::SetEnvironmentVariable($name, $value, 'Process')
}

Write-Host 'Starting VSIM API in production mode on Node 22...'
& npx --yes -p node@22 node "$scriptDir/server.js"
