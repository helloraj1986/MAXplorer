param(
  [string]$Title = 'fixture',
  [string]$Out = 'D:\RKM_SYNC\fileExplorer\reference\uia-explorer.txt',
  [int]$MaxDepth = 12
)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $Title)
$win = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
if($null -eq $win){
  $cond2 = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'CabinetWClass')
  $wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond2)
  if($wins.Count -gt 0){ $win = $wins[0] }
}
if($null -eq $win){ throw "Window '$Title' not found" }
$lines = New-Object System.Collections.Generic.List[string]
$lines.Add("WINDOW: $($win.Current.Name) class=$($win.Current.ClassName) id=$($win.Current.AutomationId) rect=$($win.Current.BoundingRectangle)")
function Walk($el, $depth){
  if($depth -gt $MaxDepth){ return }
  $c = $el.Current
  $rect = $c.BoundingRectangle
  $patterns = @()
  foreach($p in @(
    @('Invoke',[System.Windows.Automation.InvokePattern]::Pattern),
    @('Select',[System.Windows.Automation.SelectionItemPattern]::Pattern),
    @('Expand',[System.Windows.Automation.ExpandCollapsePattern]::Pattern),
    @('Toggle',[System.Windows.Automation.TogglePattern]::Pattern),
    @('Value',[System.Windows.Automation.ValuePattern]::Pattern),
    @('Scroll',[System.Windows.Automation.ScrollPattern]::Pattern),
    @('Grid',[System.Windows.Automation.GridPattern]::Pattern)
  )){
    try { $null = $el.GetCurrentPattern($p[1]); $patterns += $p[0] } catch {}
  }
  $indent = ('  ' * $depth)
  $lines.Add(("{0}[{1}] name='{2}' id='{3}' class='{4}' rect=({5},{6},{7},{8}) enabled={9} offscreen={10} patterns={11}" -f $indent,$c.ControlType.ProgrammaticName,$c.Name,$c.AutomationId,$c.ClassName,[int]$rect.X,[int]$rect.Y,[int]$rect.Width,[int]$rect.Height,$c.IsEnabled,$c.IsOffscreen,($patterns -join ',')))
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $child = $walker.GetFirstChild($el)
  while($null -ne $child){
    Walk $child ($depth + 1)
    $child = $walker.GetNextSibling($child)
  }
}
Walk $win 0
$lines | Set-Content -Encoding UTF8 $Out
Write-Output "Wrote $Out with $($lines.Count) lines"
