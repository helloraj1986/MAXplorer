param(
  [string]$Title = 'fixture',
  [string]$Item = 'Project Brief.docx',
  [string]$OutDump = 'D:\RKM_SYNC\fileExplorer\reference\uia-context-menu.txt',
  [string]$Shot = 'D:\RKM_SYNC\fileExplorer\reference\screenshots\explorer-dark-context-menu.png'
)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WC3 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
[WC3]::SetProcessDPIAware()|Out-Null
function Get-Win([string]$title){
  $script:f=[IntPtr]::Zero
  [WC3]::EnumWindows({param($h,$l) $c=New-Object Text.StringBuilder 256; [WC3]::GetClassName($h,$c,256)|Out-Null; $t=New-Object Text.StringBuilder 256; [WC3]::GetWindowText($h,$t,256)|Out-Null; if($c.ToString() -eq 'CabinetWClass' -and $t.ToString() -eq $title){$script:f=$h}; return $true},[IntPtr]::Zero)|Out-Null
  return $script:f
}
$h=Get-Win $Title
if($h -eq [IntPtr]::Zero){throw 'Explorer window not found'}
[WC3]::ShowWindow($h,9)|Out-Null
$fg=[WC3]::GetForegroundWindow(); $t1=[WC3]::GetCurrentThreadId(); $t2=[WC3]::GetWindowThreadProcessId($fg,[IntPtr]::Zero)
[WC3]::AttachThreadInput($t1,$t2,$true)|Out-Null; [WC3]::SetForegroundWindow($h)|Out-Null; [WC3]::AttachThreadInput($t1,$t2,$false)|Out-Null
Start-Sleep -Milliseconds 300
[System.Windows.Forms.SendKeys]::SendWait('{ESC}')
Start-Sleep -Milliseconds 300
$root=[System.Windows.Automation.AutomationElement]::FromHandle($h)
$cond=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,$Item)
$el=$root.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$cond)
if($null -eq $el){throw "Item $Item not found"}
$el.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
try { $el.SetFocus() } catch {}
Start-Sleep -Milliseconds 300
[System.Windows.Forms.SendKeys]::SendWait('+{F10}')
Start-Sleep -Milliseconds 1200
$lines=New-Object System.Collections.Generic.List[string]
$lines.Add("=== UIA after Shift+F10 on $Item ===")
$all=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
foreach($e in $all){
  $ct=$e.Current.ControlType.ProgrammaticName
  if($ct -like '*Menu*' -or $ct -like '*Separator*' -or $e.Current.ClassName -eq 'MenuFlyout'){
    $r=$e.Current.BoundingRectangle
    $lines.Add("[$ct] name='$($e.Current.Name)' id='$($e.Current.AutomationId)' class='$($e.Current.ClassName)' rect=($([int]$r.X),$([int]$r.Y),$([int]$r.Width),$([int]$r.Height)) enabled=$($e.Current.IsEnabled)")
  }
}
$lines | Set-Content -Encoding UTF8 $OutDump
$b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp=New-Object System.Drawing.Bitmap($b.Width,$b.Height)
$g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.X,$b.Y,0,0,$bmp.Size); $g.Dispose()
$bmp.Save($Shot,[System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
Write-Output "Wrote $OutDump and $Shot"
