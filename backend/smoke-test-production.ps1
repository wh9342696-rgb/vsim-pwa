param(
  [string]$BaseUrl = 'https://your-domain.com'
)

$ErrorActionPreference = 'Stop'

$health = Invoke-RestMethod -Uri "$BaseUrl/health" -Method Get
if ($health.status -ne 'online') { throw 'Health check did not return online' }

$packages = Invoke-RestMethod -Uri "$BaseUrl/api/v1/esims/packages" -Method Get
if (-not $packages.packages) { throw 'Package catalog is empty or unavailable' }

Write-Output "Production smoke checks passed for $BaseUrl"