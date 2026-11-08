param(
  [Parameter(Mandatory = $true)][ValidateSet('frame', 'restore')][string]$Mode,
  [int]$HidePid = 0,
  [string]$HideTitleLike = 'DeepSeek',
  [int]$WasMax = 0,
  [string]$OutDir = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type -Namespace DssSnap -Name Native -MemberDefinition @'
public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
[DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, System.Text.StringBuilder s, int n);
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
'@

[void][DssSnap.Native]::SetProcessDPIAware()

function Get-WindowTitle([IntPtr]$h) {
  $sb = New-Object System.Text.StringBuilder 512
  [void][DssSnap.Native]::GetWindowTextW($h, $sb, 512)
  return $sb.ToString()
}

function Find-HostWindow {
  param([int]$ProcId, [string]$TitleLike)

  $script:hitPid = [IntPtr]::Zero
  $script:hitTitle = [IntPtr]::Zero
  $cb = [DssSnap.Native+EnumWindowsProc] {
    param([IntPtr]$h, [IntPtr]$l)
    if (-not [DssSnap.Native]::IsWindowVisible($h)) { return $true }
    $title = Get-WindowTitle $h
    if ([string]::IsNullOrWhiteSpace($title)) { return $true }
    $wpid = [uint32]0
    [void][DssSnap.Native]::GetWindowThreadProcessId($h, [ref]$wpid)
    if ($ProcId -gt 0 -and $wpid -eq [uint32]$ProcId -and $script:hitPid -eq [IntPtr]::Zero) {
      $script:hitPid = $h
    }
    if ($TitleLike -and $title -like "*$TitleLike*" -and $script:hitTitle -eq [IntPtr]::Zero) {
      $script:hitTitle = $h
    }
    return $true
  }
  [void][DssSnap.Native]::EnumWindows($cb, [IntPtr]::Zero)

  if ($script:hitPid -ne [IntPtr]::Zero) { return $script:hitPid }
  if ($script:hitTitle -ne [IntPtr]::Zero) { return $script:hitTitle }
  return [IntPtr]::Zero
}

function Write-Json($obj) {
  Write-Output ('@@' + ($obj | ConvertTo-Json -Compress))
}

$hwnd = Find-HostWindow -ProcId $HidePid -TitleLike $HideTitleLike
if ($hwnd -eq [IntPtr]::Zero) {
  Write-Json ([ordered]@{ ok = $false; error = 'window-not-found' })
  exit 1
}

if ($Mode -eq 'restore') {
  if ($WasMax -eq 1) { [void][DssSnap.Native]::ShowWindow($hwnd, 3) }
  else { [void][DssSnap.Native]::ShowWindow($hwnd, 9) }
  [void][DssSnap.Native]::SetForegroundWindow($hwnd)
  Write-Json ([ordered]@{ ok = $true })
  exit 0
}

# ---- frame: 藏起来 → 冻结整块虚拟屏幕 → 最大化并送回前台 ----
$wasMax = if ([DssSnap.Native]::IsZoomed($hwnd)) { 1 } else { 0 }
[void][DssSnap.Native]::ShowWindow($hwnd, 0)
Start-Sleep -Milliseconds 280

$vsx = [DssSnap.Native]::GetSystemMetrics(76)   # SM_XVIRTUALSCREEN
$vsy = [DssSnap.Native]::GetSystemMetrics(77)   # SM_YVIRTUALSCREEN
$vsw = [DssSnap.Native]::GetSystemMetrics(78)   # SM_CXVIRTUALSCREEN
$vsh = [DssSnap.Native]::GetSystemMetrics(79)   # SM_CYVIRTUALSCREEN
if ($vsw -le 0 -or $vsh -le 0) { $vsx = 0; $vsy = 0; $vsw = 1920; $vsh = 1080 }

$dir = if ($OutDir) { $OutDir } else { Join-Path $env:TEMP 'dsh-screen-snap' }
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$file = Join-Path $dir ('frame_' + (Get-Date -Format 'yyyyMMdd_HHmmss_fff') + '.png')

$bmp = New-Object System.Drawing.Bitmap($vsw, $vsh)
$g = [System.Drawing.Graphics]::FromImage($bmp)
try {
  $g.CopyFromScreen($vsx, $vsy, 0, 0, (New-Object System.Drawing.Size($vsw, $vsh)))
} finally {
  $g.Dispose()
}
$bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

[void][DssSnap.Native]::ShowWindow($hwnd, 5)
[void][DssSnap.Native]::SetForegroundWindow($hwnd)

Write-Json ([ordered]@{
  ok     = $true
  path   = $file
  vsx    = $vsx
  vsy    = $vsy
  vsw    = $vsw
  vsh    = $vsh
  wasMax = $wasMax
})
