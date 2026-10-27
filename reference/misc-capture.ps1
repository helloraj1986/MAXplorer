param(
  [string]$Action = 'blankmenu',
  [string]$Title = 'fixture',
  [string]$Out = 'D:\RKM_SYNC\fileExplorer\reference\screenshots\out.png',
  [string]$Dump = 'D:\RKM_SYNC\fileExplorer\reference\uia-menu.txt',
  [string]$MenuButton = '',
  [string]$MenuItem = '',
  [string]$SelectItem = '',
  [int]$X = 1150,
  [int]$Y = 620
)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WC4 {
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
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
"@
[WC4]::SetProcessDPIAware()|Out-Null
function Get-Win([string]$title){
  $script:f=[IntPtr]::Zero
  [WC4]::EnumWindows({param($h,$l) $c=New-Object Text.StringBuilder 256; [WC4]::GetClassName($h,$c,256)|Out-Null; $t=New-Object Text.StringBuilder 256; [WC4]::GetWindowText($h,$t,256)|Out-Null; if($c.ToString() -eq 'CabinetWClass' -and $t.ToString() -eq $title){$script:f=$h}; return $true},[IntPtr]::Zero)|Out-Null
  return $script:f
}
function Focus-Win([IntPtr]$h){
  [WC4]::ShowWindow($h,9)|Out-Null
  $fg=[WC4]::GetForegroundWindow(); $t1=[WC4]::GetCurrentThreadId(); $t2=[WC4]::GetWindowThreadProcessId($fg,[IntPtr]::Zero)
  [WC4]::AttachThreadInput($t1,$t2,$true)|Out-Null; [WC4]::SetForegroundWindow($h)|Out-Null; [WC4]::AttachThreadInput($t1,$t2,$false)|Out-Null
  Start-Sleep -Milliseconds 350
}
function Save-Shot([string]$path){
  $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp=New-Object System.Drawing.Bitmap($b.Width,$b.Height)
  $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.X,$b.Y,0,0,$bmp.Size); $g.Dispose()
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path)|Out-Null
  $bmp.Save($path,[System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
  Write-Output "Saved screenshot $path"
}
function Dump-Menus([string]$path){
  $lines=New-Object System.Collections.Generic.List[string]
  $lines.Add("=== Menus after action $Action ===")
  $root=[System.Windows.Automation.AutomationElement]::RootElement
  $wins=$root.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)
  foreach($w in $wins){
    $all=$w.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
    foreach($e in $all){
      $ct=$e.Current.ControlType.ProgrammaticName
      if($ct -like '*Menu*' -or $ct -like '*Separator*'){
        $r=$e.Current.BoundingRectangle
        $lines.Add("[$ct] name='$($e.Current.Name)' id='$($e.Current.AutomationId)' class='$($e.Current.ClassName)' rect=($([int]$r.X),$([int]$r.Y),$([int]$r.Width),$([int]$r.Height)) enabled=$($e.Current.IsEnabled)")
      }
    }
  }
  $lines | Set-Content -Encoding UTF8 $path
  Write-Output "Wrote menu dump $path ($($lines.Count) lines)"
}

$h=Get-Win $Title
if($h -eq [IntPtr]::Zero){throw 'Explorer window not found'}
Focus-Win $h
[System.Windows.Forms.SendKeys]::SendWait('{ESC}')
Start-Sleep -Milliseconds 250
if($SelectItem -ne ''){
  $sroot=[System.Windows.Automation.AutomationElement]::FromHandle($h)
  $scond=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,$SelectItem)
  $sel=$sroot.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$scond)
  if($null -eq $sel){throw "Select item $SelectItem not found"}
  $sel.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
  Start-Sleep -Milliseconds 300
}

switch($Action){
  'blankmenu' {
    [WC4]::SetCursorPos($X,$Y)|Out-Null
    [WC4]::mouse_event(0x0008,0,0,0,[UIntPtr]::Zero)
    [WC4]::mouse_event(0x0010,0,0,0,[UIntPtr]::Zero)
    Start-Sleep -Milliseconds 1000
    Save-Shot $Out
    Dump-Menus $Dump
  }
  'commandmenu' {
    $root=[System.Windows.Automation.AutomationElement]::FromHandle($h)
    $cond=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,$MenuButton)
    $btn=$root.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$cond)
    if($null -eq $btn){throw "Button $MenuButton not found"}
    if($MenuItem -ne ''){
      $btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
      Start-Sleep -Milliseconds 700
      $rroot=[System.Windows.Automation.AutomationElement]::RootElement
      $mcond=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,$MenuItem)
      $mi=$rroot.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$mcond)
      if($null -eq $mi){throw "Menu item $MenuItem not found"}
      $invoked = $false
      try { $mi.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); $invoked = $true } catch {}
      if(-not $invoked){
        try { $mi.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern).Toggle(); $invoked = $true } catch {}
      }
      if(-not $invoked){ throw "Menu item $MenuItem has no Invoke or Toggle pattern" }
      Start-Sleep -Milliseconds 1000
      Save-Shot $Out
    } else {
      $btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
      Start-Sleep -Milliseconds 900
      Save-Shot $Out
      Dump-Menus $Dump
    }
  }
  'details' {
    $root=[System.Windows.Automation.AutomationElement]::FromHandle($h)
    $items=$root.FindFirst([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,'Items View')))
    if($null -ne $items){ try{$items.SetFocus()}catch{} }
    [System.Windows.Forms.SendKeys]::SendWait('%+p')
    Start-Sleep -Milliseconds 1200
    $b=New-Object WC4+RECT
    Save-Shot $Out
  }
  'preview' {
    [System.Windows.Forms.SendKeys]::SendWait('%p')
    Start-Sleep -Milliseconds 1200
    Save-Shot $Out
  }
  'keys' {
    $root=[System.Windows.Automation.AutomationElement]::FromHandle($h)
    $items=$root.FindFirst([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,'Items View')))
    if($null -ne $items){ try{$items.SetFocus()}catch{} }
    [System.Windows.Forms.SendKeys]::SendWait($MenuItem)
    Start-Sleep -Milliseconds 1200
    Save-Shot $Out
  }
}
