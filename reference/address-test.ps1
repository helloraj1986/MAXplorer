param(
  [string]$Title = 'File Explorer',
  [Parameter(Mandatory=$true)]
  [string]$Path
)
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class SeqNative {
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
[SeqNative]::EnumWindows({ param($h,$l)
  $text = New-Object Text.StringBuilder 512
  [SeqNative]::GetWindowText($h, $text, 512) | Out-Null
  if ($text.ToString() -eq $Title) { $script:target = $h }
  return $true
}, [IntPtr]::Zero) | Out-Null
if ($script:target -eq [IntPtr]::Zero) { throw "Window '$Title' not found" }
[SeqNative]::SetWindowPos($script:target, [IntPtr](-1), 0, 0, 0, 0, 0x0001 -bor 0x0002 -bor 0x0040) | Out-Null
$fg = [SeqNative]::GetForegroundWindow()
$current = [SeqNative]::GetCurrentThreadId()
$other = [SeqNative]::GetWindowThreadProcessId($fg, [IntPtr]::Zero)
[SeqNative]::AttachThreadInput($current, $other, $true) | Out-Null
[SeqNative]::SetForegroundWindow($script:target) | Out-Null
[SeqNative]::AttachThreadInput($current, $other, $false) | Out-Null
[SeqNative]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
[SeqNative]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 500
[System.Windows.Forms.SendKeys]::SendWait('^l')
Start-Sleep -Milliseconds 450
[System.Windows.Forms.SendKeys]::SendWait($Path)
Start-Sleep -Milliseconds 250
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
Start-Sleep -Milliseconds 1200
Write-Output "Navigated to $Path"
