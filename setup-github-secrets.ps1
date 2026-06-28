$repo = "addedlife/onetaskfocuser"
$ghPath = "C:\Program Files\GitHub CLI\gh.exe"

function Set-GHSecret {
    param([string]$Name, [string]$Prompt)
    $secure = Read-Host -Prompt $Prompt -AsSecureString
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
    if ($plain -eq "") {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        return
    }
    $plain | & $ghPath secret set $Name --repo $repo
    Write-Host "  OK: $Name" -ForegroundColor Green
}

Write-Host "Shamash Pro 4 -- GitHub secrets setup" -ForegroundColor Cyan
Write-Host "Repo: $repo"
Write-Host ""

Set-GHSecret "GEMINI_API_KEY"             "GEMINI_API_KEY"
Set-GHSecret "GEMINI_OVERFLOW_01"         "GEMINI_OVERFLOW_01"
Set-GHSecret "PHONE_RELAY_SECRET"         "PHONE_RELAY_SECRET"
Set-GHSecret "MCP_READ_TOKEN"             "MCP_READ_TOKEN"
Set-GHSecret "GOOGLE_CLIENT_ID"           "GOOGLE_CLIENT_ID"
Set-GHSecret "GOOGLE_CLIENT_SECRET"       "GOOGLE_CLIENT_SECRET"
Set-GHSecret "GOOGLE_HEALTH_CLIENT_ID"    "GOOGLE_HEALTH_CLIENT_ID"
Set-GHSecret "GOOGLE_HEALTH_CLIENT_SECRET" "GOOGLE_HEALTH_CLIENT_SECRET"
Set-GHSecret "GOOGLE_SEARCH_API_KEY"      "GOOGLE_SEARCH_API_KEY (skip if not ready)"
Set-GHSecret "GOOGLE_SEARCH_CSE_ID"       "GOOGLE_SEARCH_CSE_ID (skip if not ready)"

Write-Host ""
Write-Host "Firebase service account JSON -- paste the full JSON on one line, then Enter:"
Write-Host "(or just press Enter to skip)"
$saJson = Read-Host -Prompt ">"
if ($saJson -ne "") {
    $saJson | & $ghPath secret set "FIREBASE_SERVICE_ACCOUNT_JSON" --repo $repo
    Write-Host "  OK: FIREBASE_SERVICE_ACCOUNT_JSON" -ForegroundColor Green
} else {
    Write-Host "  (skipped)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Done. All secrets pushed to $repo." -ForegroundColor Cyan
