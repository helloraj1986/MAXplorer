param(
  [string]$Path = 'D:\RKM_SYNC\fileExplorer\reference\fixture',
  [string]$Out = 'D:\RKM_SYNC\fileExplorer\reference\screenshots\explorer-dark-details.png',
  [string]$TitleContains = ''
)

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Win32Cap {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdcBlt, uint nFlags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@

[Win32Cap]::SetProcessDPIAware() | Out-Null

$existing = @{}
[Win32Cap]::EnumWindows({ param($h,$l) $sb=New-Object Text.StringBuilder 512; [Win32Cap]::GetClassName($h,$sb,$sb.Capacity)|Out-Null; if($sb.ToString() -eq 'CabinetWClass'){ $script:existing[$h]=$true }; return $true }, [IntPtr]::Zero) | Out-Null

Start-Process explorer.exe -ArgumentList "`"$Path`""
Start-Sleep -Milliseconds 2500

$target = [IntPtr]::Zero
for($i=0; $i -lt 20 -and $target -eq [IntPtr]::Zero; $i++){
  [Win32Cap]::EnumWindows({ param($h,$l)
    $cls=New-Object Text.StringBuilder 512; [Win32Cap]::GetClassName($h,$cls,$cls.Capacity)|Out-Null
    $txt=New-Object Text.StringBuilder 512; [Win32Cap]::GetWindowText($h,$txt,$txt.Capacity)|Out-Null
    if($cls.ToString() -eq 'CabinetWClass' -and [Win32Cap]::IsWindowVisible($h) -and -not $existing.ContainsKey($h) -and ($TitleContains -eq '' -or $txt.ToString() -like "*$TitleContains*")){ $script:target=$h }
    return $true
  }, [IntPtr]::Zero) | Out-Null
  if($target -eq [IntPtr]::Zero){ Start-Sleep -Milliseconds 500 }
}

if($target -eq [IntPtr]::Zero){ throw 'Explorer window not found' }
$titleSb=New-Object Text.StringBuilder 512; [Win32Cap]::GetWindowText($target,$titleSb,$titleSb.Capacity)|Out-Null
Write-Output "Target: $target title=$($titleSb.ToString())"

[Win32Cap]::ShowWindow($target, 9) | Out-Null
[Win32Cap]::SetWindowPos($target, [IntPtr](-1), 0, 0, 0, 0, 0x0001 -bor 0x0002 -bor 0x0040) | Out-Null
[Win32Cap]::SetForegroundWindow($target) | Out-Null
Start-Sleep -Milliseconds 1500

$r = New-Object Win32Cap+RECT
[Win32Cap]::GetWindowRect($target, [ref]$r) | Out-Null
$w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
Write-Output "Rect: $($r.Left),$($r.Top) ${w}x${h}"

$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
$ok = [Win32Cap]::PrintWindow($target, $hdc, 2)
$g.ReleaseHdc($hdc)
$g.Dispose()
if(-not $ok){
  Write-Output 'PrintWindow failed; using screen copy'
  $bmp.Dispose()
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
  $g.Dispose()
} else {
  # check if blank
  $c = $bmp.GetPixel([int]($w/2), [int]($h/2))
  Write-Output "PrintWindow ok center=$($c.R),$($c.G),$($c.B)"
}

$dir = Split-Path -Parent $Out
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
[Win32Cap]::SetWindowPos($target, [IntPtr](-2), 0, 0, 0, 0, 0x0001 -bor 0x0002 -bor 0x0040) | Out-Null
Write-Output "Saved $Out ($w x $h) hwnd=$target"
