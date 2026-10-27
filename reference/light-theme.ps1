param(
  [string]$Title = 'fixture',
  [string]$Out = 'D:\RKM_SYNC\fileExplorer\reference\screenshots\explorer-light-details.png',
  [int]$Mode = 1
)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WC5 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, UIntPtr wParam, IntPtr lParam, uint flags, uint timeout, out UIntPtr result);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
[WC5]::SetProcessDPIAware()|Out-Null
$reg='HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize'
$old=(Get-ItemProperty $reg).AppsUseLightTheme
Set-ItemProperty -Path $reg -Name AppsUseLightTheme -Value $Mode
$result=[UIntPtr]::Zero
[WC5]::SendMessageTimeout([IntPtr]0xffff,0x001A,[UIntPtr]::Zero,[IntPtr]::Zero,2,3000,[ref]$result)|Out-Null
Start-Sleep -Seconds 3
$script:f=[IntPtr]::Zero
[WC5]::EnumWindows({param($h,$l) $c=New-Object Text.StringBuilder 256; [WC5]::GetClassName($h,$c,256)|Out-Null; $t=New-Object Text.StringBuilder 256; [WC5]::GetWindowText($h,$t,256)|Out-Null; if($c.ToString() -eq 'CabinetWClass' -and $t.ToString() -eq $Title){$script:f=$h}; return $true},[IntPtr]::Zero)|Out-Null
if($script:f -eq [IntPtr]::Zero){ throw 'Explorer window not found' }
$r=New-Object WC5+RECT; [WC5]::GetWindowRect($script:f,[ref]$r)|Out-Null
$w=$r.Right-$r.Left; $hh=$r.Bottom-$r.Top
$bmp=New-Object System.Drawing.Bitmap($w,$hh)
$g=[System.Drawing.Graphics]::FromImage($bmp); $dc=$g.GetHdc(); $ok=[WC5]::PrintWindow($script:f,$dc,2); $g.ReleaseHdc($dc); $g.Dispose()
$bmp.Save($Out,[System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
Write-Output "Captured $Out ${w}x${hh} (AppsUseLightTheme was $old, set $Mode)"
Set-ItemProperty -Path $reg -Name AppsUseLightTheme -Value $old
[WC5]::SendMessageTimeout([IntPtr]0xffff,0x001A,[UIntPtr]::Zero,[IntPtr]::Zero,2,3000,[ref]$result)|Out-Null
Write-Output "Restored AppsUseLightTheme=$old"
