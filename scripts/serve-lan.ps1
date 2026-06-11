# Serve the Miami Ride Companion app on the local WiFi so an iPad/phone can open it.
# Usage:  right-click -> "Run with PowerShell"   (or)   powershell -ExecutionPolicy Bypass -File scripts\serve-lan.ps1

$ErrorActionPreference = 'Stop'
$port   = 8000
$pubDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'public'

# Find this PC's WiFi/LAN IPv4 address
$ip = (Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object { $_.IPAddress -notlike '169.*' -and $_.IPAddress -ne '127.0.0.1' } |
        Select-Object -First 1).IPAddress

Write-Host ""
Write-Host "  Miami Ride Companion - LAN server" -ForegroundColor Cyan
Write-Host "  -------------------------------------------------"
Write-Host "  On your iPad (same WiFi), open Safari and go to:"
Write-Host ""
Write-Host "      http://$ip`:$port/"            -ForegroundColor Green
Write-Host ""
Write-Host "  Driver dashboard:  http://$ip`:$port/editor.html"
Write-Host "  -------------------------------------------------"
Write-Host "  Press Ctrl+C in this window to stop the server."
Write-Host ""

python -m http.server $port --directory $pubDir --bind 0.0.0.0
