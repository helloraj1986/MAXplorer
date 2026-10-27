param(
  [string]$Action = 'screenshot',
  [string]$Title = 'fixture',
  [string]$Out = 'D:\RKM_SYNC\fileExplorer\reference\screenshots\out.png',
  [string]$Keys = '',
  [string]$Select = '',
  [int]$Wait = 800
)
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WCap {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
[WCap]::SetProcessDPIAware() | Out-Null

function Get-Cabinet([string]$title){
  $script:found = [IntPtr]::Zero
  [WCap]::EnumWindows({ param($h,$l)
    $cls=New-Object Text.StringBuilder 512; [WCap]::GetClassName($h,$cls,$cls.Capacity)|Out-Null
    $txt=New-Object Text.StringBuilder 512; [WCap]::GetWindowText($h,$txt,$txt.Capacity)|Out-Null
    if($cls.ToString() -eq 'CabinetWClass' -and [WCap]::IsWindowVisible($h) -and $txt.ToString() -eq $title){ $script:found=$h }
    return $true
  }, [IntPtr]::Zero) | Out-Null
  return $script:found
}

function Focus-Hwnd([IntPtr]$h){
  [WCap]::ShowWindow($h, 9) | Out-Null
  $fg = [WCap]::GetForegroundWindow()
  $t1 = [WCap]::GetCurrentThreadId()
  $t2 = [WCap]::GetWindowThreadProcessId($fg, [IntPtr]::Zero)
  [WCap]::AttachThreadInput($t1, $t2, $true) | Out-Null
  [WCap]::SetForegroundWindow($h) | Out-Null
  [WCap]::AttachThreadInput($t1, $t2, $false) | Out-Null
  [WCap]::keybd_event(0x12,0,0,[UIntPtr]::Zero); [WCap]::keybd_event(0x12,0,2,[UIntPtr]::Zero)
  Start-Sleep -Milliseconds 400
}

function Capture-Window([IntPtr]$h, [string]$path){
  $r = New-Object WCap+RECT; [WCap]::GetWindowRect($h, [ref]$r) | Out-Null
  $w=$r.Right-$r.Left; $hh=$r.Bottom-$r.Top
  $bmp = New-Object System.Drawing.Bitmap($w,$hh)
  $g=[System.Drawing.Graphics]::FromImage($bmp)
  $dc=$g.GetHdc(); $ok=[WCap]::PrintWindow($h,$dc,2); $g.ReleaseHdc($dc); $g.Dispose()
  if(-not $ok){ $bmp.Dispose(); throw 'PrintWindow failed' }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
  $bmp.Save($path,[System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
  Write-Output "Captured window $path ${w}x${hh}"
}

function Capture-Screen([string]$path){
  $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp=New-Object System.Drawing.Bitmap($b.Width,$b.Height)
  $g=[System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.X,$b.Y,0,0,$bmp.Size)
  $g.Dispose()
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
  $bmp.Save($path,[System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
  Write-Output "Captured screen $path $($b.Width)x$($b.Height)"
}

$h = Get-Cabinet $Title
if($h -eq [IntPtr]::Zero){ throw "Cabinet window '$Title' not found" }
Focus-Hwnd $h
Write-Output "hwnd=$h fg=$([WCap]::GetForegroundWindow())"

$root=[System.Windows.Automation.AutomationElement]::FromHandle($h)
if($Select -ne ''){
  $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $Select)
  $el = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
  if($null -eq $el){ throw "Item $Select not found" }
  $p = $el.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
  $p.Select()
  Write-Output "Selected $Select"
  Start-Sleep -Milliseconds 300
}

if($Keys -ne ''){
  $parts = $Keys -split '\+'
  $mods = @()
  $key = $parts[-1]
  foreach($m in $parts[0..($parts.Length-2)]){
    switch($m.ToUpper()){
      'CTRL' { $mods += '^' }
      'SHIFT' { $mods += '+' }
      'ALT' { $mods += '%' }
    }
  }
  $send = ($mods -join '') + $key
  [System.Windows.Forms.SendKeys]::SendWait($send)
  Write-Output "Sent $send"
}

Start-Sleep -Milliseconds $Wait
if($Action -eq 'screen'){ Capture-Screen $Out } else { Capture-Window $h $Out }
