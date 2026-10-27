param(
  [string]$Title = 'File Explorer',
  [Parameter(Mandatory=$true)]
  [string]$Keys,
  [int]$Wait = 800
)
Add-Type -AssemblyName System.Windows.Forms
$focusScript = Join-Path $PSScriptRoot 'focus.ps1'
& $focusScript -Title $Title -Topmost | Out-Null
Start-Sleep -Milliseconds 200
[System.Windows.Forms.SendKeys]::SendWait($Keys)
Start-Sleep -Milliseconds $Wait
Write-Output "Sent $Keys"
