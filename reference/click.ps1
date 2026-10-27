param(
  [int]$X,
  [int]$Y,
  [ValidateSet('left','right','middle')]
  [string]$Button = 'left',
  [switch]$Double
)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ClickNative {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
"@
[ClickNative]::SetCursorPos($X, $Y) | Out-Null
$down = if ($Button -eq 'right') { 0x0008 } elseif ($Button -eq 'middle') { 0x0020 } else { 0x0002 }
$up = if ($Button -eq 'right') { 0x0010 } elseif ($Button -eq 'middle') { 0x0040 } else { 0x0004 }
[ClickNative]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero)
[ClickNative]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero)
if ($Double) {
  Start-Sleep -Milliseconds 90
  [ClickNative]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero)
  [ClickNative]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero)
}
Write-Output "Clicked $Button at $X,$Y"
