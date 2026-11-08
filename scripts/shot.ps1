param(
    [ValidateSet('behind', 'topmost', 'foreground', 'screen', 'list')]
    [string]$Mode = 'behind',
    [string]$OutDir = '',
    [string]$OutFile = '',
    [int]$HidePid = 0,
    [string]$HideTitleLike = 'DeepSeek',
    [string[]]$ExcludeProcess = @('DeepSeek Harness')
)

# Screenshot a window to PNG. No dependencies beyond the .NET Framework in Windows.
#
#   behind     (default) hide the host window, capture the window that was behind it,
#              then put the host window back. This is the mode an in-app button needs:
#              clicking a button makes the host foreground, so "capture the foreground"
#              would only ever capture the host itself.
#   topmost    highest visible window that is not the host
#   foreground whatever has focus right now (call it from a hotkey, not from a button)
#   screen     the whole virtual desktop
#   list       print visible top-level windows (handle | pid | WxH | title), no capture

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

Add-Type -Namespace WinCap -Name Native -MemberDefinition @'
public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
'@

[void][WinCap.Native]::SetProcessDPIAware()

if ([string]::IsNullOrWhiteSpace($OutDir)) { $OutDir = Join-Path (Get-Location) 'out\shots' }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$skipPids = @{}
foreach ($name in $ExcludeProcess) {
    Get-Process -Name $name -ErrorAction SilentlyContinue | ForEach-Object { $skipPids[[uint32]$_.Id] = $true }
}
# Exclude our own ancestor chain as well: when the host spawns this script the host
# process is an ancestor, so a "topmost" pick can never land on the caller itself.
$walk = [uint32]$PID
for ($i = 0; $i -lt 10 -and $walk -gt 0; $i++) {
    $skipPids[$walk] = $true
    $parent = (Get-CimInstance Win32_Process -Filter "ProcessId = $walk" -ErrorAction SilentlyContinue).ParentProcessId
    if (-not $parent) { break }
    $walk = [uint32]$parent
}
if ($HidePid -gt 0) { $skipPids[[uint32]$HidePid] = $true }

function Get-WindowBounds([IntPtr]$h) {
    $r = New-Object WinCap.Native+RECT
    if (-not [WinCap.Native]::GetWindowRect($h, [ref]$r)) { return $null }
    if ($r.Right -le $r.Left -or $r.Bottom -le $r.Top) { return $null }
    return [System.Drawing.Rectangle]::FromLTRB($r.Left, $r.Top, $r.Right, $r.Bottom)
}

function Get-WindowTitle([IntPtr]$h) {
    $sb = New-Object System.Text.StringBuilder 256
    [void][WinCap.Native]::GetWindowTextW($h, $sb, 256)
    return $sb.ToString()
}

function Invoke-WindowEnum([scriptblock]$body) {
    $script:pick = $null
    $cb = [WinCap.Native+EnumWindowsProc]$body
    [void][WinCap.Native]::EnumWindows($cb, [IntPtr]::Zero)
    return $script:pick
}

function Save-Shot([System.Drawing.Rectangle]$rect, [string]$file) {
    $bmp = New-Object System.Drawing.Bitmap $rect.Width, $rect.Height
    try {
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        try { $g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bmp.Size) } finally { $g.Dispose() }
        if ([string]::IsNullOrWhiteSpace($file)) {
            $file = Join-Path $OutDir ('shot_{0}_{1}x{2}.png' -f (Get-Date -Format 'yyyyMMdd_HHmmss'), $rect.Width, $rect.Height)
        } else {
            $file = Join-Path $OutDir $file
        }
        $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $bmp.Dispose() }
    Write-Output $file
}

# Pick the frontmost visible window that is not the caller.
$pickFrontmost = {
    param([IntPtr]$h, [IntPtr]$l)
    if ($script:pick) { return $false }
    if (-not [WinCap.Native]::IsWindowVisible($h)) { return $true }
    if ([WinCap.Native]::IsIconic($h)) { return $true }
    $procId = [uint32]0
    [void][WinCap.Native]::GetWindowThreadProcessId($h, [ref]$procId)
    if ($skipPids.ContainsKey($procId)) { return $true }
    $b = Get-WindowBounds $h
    if ($null -eq $b) { return $true }
    if ($b.Width -lt 200 -or $b.Height -lt 150) { return $true }
    $script:pick = @{ Hwnd = $h; Bounds = $b }
    return $false
}

if ($Mode -eq 'list') {
    $script:listRows = New-Object System.Collections.ArrayList
    [void](Invoke-WindowEnum {
        param([IntPtr]$h, [IntPtr]$l)
        if (-not [WinCap.Native]::IsWindowVisible($h)) { return $true }
        $b = Get-WindowBounds $h
        if ($null -eq $b) { return $true }
        $procId = [uint32]0
        [void][WinCap.Native]::GetWindowThreadProcessId($h, [ref]$procId)
        [void]$script:listRows.Add(('{0} | pid={1} | {2}x{3} | {4}' -f $h, $procId, $b.Width, $b.Height, (Get-WindowTitle $h)))
        return $true
    })
    foreach ($row in $script:listRows) { Write-Output $row }
    exit 0
}

if ($Mode -eq 'screen') {
    Write-Output (Save-Shot ([System.Windows.Forms.SystemInformation]::VirtualScreen) $OutFile)
    exit 0
}

if ($Mode -eq 'foreground') {
    $h = [WinCap.Native]::GetForegroundWindow()
    if ($h -eq [IntPtr]::Zero) { throw 'no foreground window' }
    if ([WinCap.Native]::IsIconic($h)) { throw 'foreground window is minimized' }
    $b = Get-WindowBounds $h
    if ($null -eq $b) { throw 'empty window bounds' }
    Write-Output (Save-Shot $b $OutFile)
    exit 0
}

if ($Mode -eq 'behind') {
    # 1. locate the caller's window — the one to step out of the way
    $host_hwnd = [IntPtr]::Zero
    $found = Invoke-WindowEnum {
        param([IntPtr]$h, [IntPtr]$l)
        if ($script:pick -ne $null) { return $false }
        if (-not [WinCap.Native]::IsWindowVisible($h)) { return $true }
        $b = Get-WindowBounds $h
        if ($null -eq $b) { return $true }
        if ($HidePid -gt 0) {
            $procId = [uint32]0
            [void][WinCap.Native]::GetWindowThreadProcessId($h, [ref]$procId)
            if ($procId -eq [uint32]$HidePid) { $script:pick = $h }
            return $true
        }
        if ((Get-WindowTitle $h) -like "*$HideTitleLike*") { $script:pick = $h }
        return $true
    }
    if ($found -ne $null) { $host_hwnd = [IntPtr]$found }
    if ($host_hwnd -eq [IntPtr]::Zero) { throw "host window not found (title like '$HideTitleLike'); pass -HidePid" }

    # 2. hide it, grab what was behind, and always put it back
    [void][WinCap.Native]::ShowWindow($host_hwnd, 0)  # SW_HIDE
    try {
        Start-Sleep -Milliseconds 260
        $behind = Invoke-WindowEnum $pickFrontmost
        $rect = if ($behind) { $behind.Bounds } else { [System.Windows.Forms.SystemInformation]::VirtualScreen }
        Write-Output (Save-Shot $rect $OutFile)
    } finally {
        [void][WinCap.Native]::ShowWindow($host_hwnd, 5)  # SW_SHOW
        [void][WinCap.Native]::SetForegroundWindow($host_hwnd)
    }
    exit 0
}

# topmost
$front = Invoke-WindowEnum $pickFrontmost
if (-not $front) { throw 'no capturable window (all minimized or excluded)' }
Write-Output (Save-Shot $front.Bounds $OutFile)
