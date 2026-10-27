param(
  [string]$Title = 'File Explorer',
  [string]$Out = 'D:\RKM_SYNC\fileExplorer\docs\screenshots\app-dark-details.png',
  [switch]$Screen
)
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class AppCap {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
[AppCap]::SetProcessDPIAware()|Out-Null
$script:target=[IntPtr]::Zero
[AppCap]::EnumWindows({param($h,$l) $t=New-Object Text.StringBuilder 512; [AppCap]::GetWindowText($h,$t,512)|Out-Null; if([AppCap]::IsWindowVisible($h) -and $t.ToString() -eq $Title){$script:target=$h}; return $true},[IntPtr]::Zero)|Out-Null
if($script:target -eq [IntPtr]::Zero){ throw "Window '$Title' not found" }
$h=$script:target
[AppCap]::ShowWindow($h,9)|Out-Null
[AppCap]::SetWindowPos($h,[IntPtr](-1),0,0,0,0,0x0001 -bor 0x0002 -bor 0x0040)|Out-Null
$fg=[AppCap]::GetForegroundWindow(); $t1=[AppCap]::GetCurrentThreadId(); $t2=[AppCap]::GetWindowThreadProcessId($fg,[IntPtr]::Zero)
[AppCap]::AttachThreadInput($t1,$t2,$true)|Out-Null; [AppCap]::SetForegroundWindow($h)|Out-Null; [AppCap]::AttachThreadInput($t1,$t2,$false)|Out-Null
Start-Sleep -Milliseconds 700
$r=New-Object AppCap+RECT; [AppCap]::GetWindowRect($h,[ref]$r)|Out-Null
$w=$r.Right-$r.Left; $hh=$r.Bottom-$r.Top
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Out)|Out-Null
if($Screen){
  $bmp=New-Object System.Drawing.Bitmap($w,$hh); $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($r.Left,$r.Top,0,0,$bmp.Size); $g.Dispose()
} else {
  $bmp=New-Object System.Drawing.Bitmap($w,$hh); $g=[System.Drawing.Graphics]::FromImage($bmp); $dc=$g.GetHdc(); $ok=[AppCap]::PrintWindow($h,$dc,2); $g.ReleaseHdc($dc); $g.Dispose()
  if(-not $ok){ throw 'PrintWindow failed' }
}
$bmp.Save($Out,[System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
[AppCap]::SetWindowPos($h,[IntPtr](-2),0,0,0,0,0x0001 -bor 0x0002 -bor 0x0040)|Out-Null
Write-Output "Saved $Out ${w}x${hh} hwnd=$h"
