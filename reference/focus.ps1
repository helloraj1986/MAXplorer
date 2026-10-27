param(
  [string]$Title = 'File Explorer',
  [switch]$Topmost
)
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class FocusNative {
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
}
"@
$script:target = [IntPtr]::Zero
[FocusNative]::EnumWindows({ param($h,$l)
  $text = New-Object Text.StringBuilder 512
  [FocusNative]::GetWindowText($h, $text, 512) | Out-Null
  if ($text.ToString() -eq $Title) { $script:target = $h }
  return $true
}, [IntPtr]::Zero) | Out-Null
if ($script:target -eq [IntPtr]::Zero) { throw "Window '$Title' not found" }
if ($Topmost) {
  [FocusNative]::SetWindowPos($script:target, [IntPtr](-1), 0, 0, 0, 0, 0x0001 -bor 0x0002 -bor 0x0040) | Out-Null
}
$fg = [FocusNative]::GetForegroundWindow()
$current = [FocusNative]::GetCurrentThreadId()
$other = [FocusNative]::GetWindowThreadProcessId($fg, [IntPtr]::Zero)
[FocusNative]::AttachThreadInput($current, $other, $true) | Out-Null
[FocusNative]::SetForegroundWindow($script:target) | Out-Null
[FocusNative]::AttachThreadInput($current, $other, $false) | Out-Null
[FocusNative]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
[FocusNative]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 350
Write-Output "Focused $($script:target) foreground=$([FocusNative]::GetForegroundWindow())"
