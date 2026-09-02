# Helper: Commit and push workspace changes to origin/main
# Usage: Open PowerShell in repo root and run: ./scripts/push_changes.ps1

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Error "git is not installed or not in PATH. Install Git and try again."
  exit 1
}

$defaultMessage = "admin: UI/backend updates — profile picker, sub-admin photo, analytics polling, admin endpoints"
$msg = Read-Host -Prompt "Commit message (leave empty for default)"
if ([string]::IsNullOrWhiteSpace($msg)) { $msg = $defaultMessage }

Write-Host "Staging all changes..."
git add -A

Write-Host "Committing with message:`n$msg`n"
git commit -m "$msg"
$commitExit = $LASTEXITCODE
if ($commitExit -ne 0) {
  Write-Host "No changes committed (either nothing to commit or commit failed). Exit code: $commitExit" -ForegroundColor Yellow
} else {
  Write-Host "Pushing to origin/main..."
  git push origin main
  if ($LASTEXITCODE -eq 0) {
    Write-Host "Push completed successfully." -ForegroundColor Green
  } else {
    Write-Error "Push failed with exit code $LASTEXITCODE"
  }
}
