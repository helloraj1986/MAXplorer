param(
  [string]$Title = 'fixture',
  [string]$Button = 'View',
  [string]$OutDump = 'D:\RKM_SYNC\fileExplorer\reference\uia-view-menu.txt',
  [string]$Shot = 'D:\RKM_SYNC\fileExplorer\reference\screenshots\explorer-dark-view-menu.png'
)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WC2 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
[WC2]::SetProcessDPIAware() | Out-Null

function Get-Win([string]$title){
  $script:f=[IntPtr]::Zero
  [WC2]::EnumWindows({param($h,$l) $c=New-Object Text.StringBuilder 256; [WC2]::GetClassName($h,$c,256)|Out-Null; $t=New-Object Text.StringBuilder 256; [WC2]::GetWindowText($h,$t,256)|Out-Null; if($c.ToString() -eq 'CabinetWClass' -and $t.ToString() -eq $title){$script:f=$h}; return $true},[IntPtr]::Zero)|Out-Null
  return $script:f
}
$h=Get-Win $Title
if($h -eq [IntPtr]::Zero){throw 'Explorer window not found'}
[WC2]::ShowWindow($h,9)|Out-Null
$fg=[WC2]::GetForegroundWindow(); $t1=[WC2]::GetCurrentThreadId(); $t2=[WC2]::GetWindowThreadProcessId($fg,[IntPtr]::Zero)
[WC2]::AttachThreadInput($t1,$t2,$true)|Out-Null; [WC2]::SetForegroundWindow($h)|Out-Null; [WC2]::AttachThreadInput($t1,$t2,$false)|Out-Null
Start-Sleep -Milliseconds 300
$root=[System.Windows.Automation.AutomationElement]::FromHandle($h)
$cond=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,$Button)
$btn=$root.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$cond)
if($null -eq $btn){throw "Button $Button not found"}
$btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
Start-Sleep -Milliseconds 800
$lines=New-Object System.Collections.Generic.List[string]
$lines.Add("=== Desktop top-level UIA after invoking $Button ===")
$ar=[System.Windows.Automation.AutomationElement]::RootElement
$kids=$ar.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)
foreach($k in $kids){
  $lines.Add("WINDOW name='$($k.Current.Name)' class='$($k.Current.ClassName)' rect=$($k.Current.BoundingRectangle)")
  $all=$k.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
  foreach($e in $all){
    $r=$e.Current.BoundingRectangle
    if($r.Width -gt 0 -and $r.Height -gt 0){
      $lines.Add("  [$($e.Current.ControlType.ProgrammaticName)] name='$($e.Current.Name)' id='$($e.Current.AutomationId)' class='$($e.Current.ClassName)' rect=($([int]$r.X),$([int]$r.Y),$([int]$r.Width),$([int]$r.Height)) enabled=$($e.Current.IsEnabled)")
    }
  }
}
$lines | Set-Content -Encoding UTF8 $OutDump
$b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp=New-Object System.Drawing.Bitmap($b.Width,$b.Height)
$g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.X,$b.Y,0,0,$bmp.Size); $g.Dispose()
$bmp.Save($Shot,[System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
Write-Output "Wrote $OutDump and $Shot"
