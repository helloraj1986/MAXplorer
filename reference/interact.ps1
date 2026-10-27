param(
  [string]$Title = 'File Explorer',
  [int]$X = -1,
  [int]$Y = -1,
  [ValidateSet('left','right','middle','none')]
  [string]$Button = 'left',
  [switch]$Double,
  [string]$Keys = '',
  [int]$Wait = 700
)
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class InteractNative {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
"@
$script:target = [IntPtr]::Zero
[InteractNative]::EnumWindows({ param($h,$l)
  $text = New-Object Text.StringBuilder 512
  [InteractNative]::GetWindowText($h, $text, 512) | Out-Null
  if ($text.ToString() -eq $Title) { $script:target = $h }
  return $true
}, [IntPtr]::Zero) | Out-Null
if ($script:target -eq [IntPtr]::Zero) { throw "Window '$Title' not found" }
[InteractNative]::SetWindowPos($script:target, [IntPtr](-1), 0, 0, 0, 0, 0x0001 -bor 0x0002 -bor 0x0040) | Out-Null
$fg = [InteractNative]::GetForegroundWindow()
$current = [InteractNative]::GetCurrentThreadId()
$other = [InteractNative]::GetWindowThreadProcessId($fg, [IntPtr]::Zero)
[InteractNative]::AttachThreadInput($current, $other, $true) | Out-Null
[InteractNative]::SetForegroundWindow($script:target) | Out-Null
[InteractNative]::AttachThreadInput($current, $other, $false) | Out-Null
[InteractNative]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
[InteractNative]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 350
if ($X -ge 0 -and $Y -ge 0 -and $Button -ne 'none') {
  [InteractNative]::SetCursorPos($X, $Y) | Out-Null
  $down = if ($Button -eq 'right') { 0x0008 } elseif ($Button -eq 'middle') { 0x0020 } else { 0x0002 }
  $up = if ($Button -eq 'right') { 0x0010 } elseif ($Button -eq 'middle') { 0x0040 } else { 0x0004 }
  [InteractNative]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero)
  [InteractNative]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero)
  if ($Double) {
    Start-Sleep -Milliseconds 90
    [InteractNative]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero)
    [InteractNative]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero)
  }
  Start-Sleep -Milliseconds 350
}
if ($Keys -ne '') {
  [System.Windows.Forms.SendKeys]::SendWait($Keys)
  Start-Sleep -Milliseconds 350
}
Start-Sleep -Milliseconds $Wait
Write-Output "Focused=$([InteractNative]::GetForegroundWindow()) target=$($script:target) keys=$Keys click=$Button,$X,$Y"
