# ONE-TIME: open Windows Firewall for the LAN dev server on port 8000 (Private networks only).
# Right-click this file -> "Run with PowerShell" and click YES on the admin (UAC) prompt.

$rule = 'Miami Ride Dev Server 8000'

# Re-launch self as admin if not already elevated
$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Start-Process powershell -Verb RunAs -ArgumentList `
        "-ExecutionPolicy Bypass -File `"$PSCommandPath`""
    return
}

if (Get-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue) {
    Write-Host "Firewall rule already exists. Nothing to do." -ForegroundColor Yellow
} else {
    New-NetFirewallRule -DisplayName $rule -Direction Inbound -Action Allow `
        -Protocol TCP -LocalPort 8000 -Profile Private | Out-Null
    Write-Host "Firewall opened for port 8000 (Private networks)." -ForegroundColor Green
}
Write-Host "Done. You can close this window."
Start-Sleep -Seconds 3
