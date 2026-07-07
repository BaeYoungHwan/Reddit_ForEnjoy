# Claude Code Stop notify hook
[Console]::InputEncoding  = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$input_json = [Console]::In.ReadToEnd()
$session_id = $null
$project_name = "Claude Code"
try {
    $data = $input_json | ConvertFrom-Json
    $session_id = $data.session_id
    if ($data.cwd) {
        $project_name = Split-Path $data.cwd -Leaf
    }
} catch {}

# Determine start file: prefer session-specific, fall back to shared
$startFile = "$env:TEMP\claude_session_start.txt"
if ($session_id) {
    $safe_id = $session_id -replace '[^a-zA-Z0-9_-]', '_'
    $session_file = "$env:TEMP\claude_start_$safe_id.txt"
    if (Test-Path $session_file) {
        $startFile = $session_file
    }
}

if (-not (Test-Path $startFile)) { exit 0 }

try {
    $raw = (Get-Content $startFile -Raw -Encoding UTF8).Trim([char]0xFEFF).Trim()
    $startTime = [DateTime]::Parse($raw)
    $elapsed = (Get-Date) - $startTime
} catch { exit 0 }

if ($elapsed.TotalMinutes -lt 3) { exit 0 }

$title = "Claude Code 완료"
$body = "${project_name} 프로젝트에서 작업이 완료했습니다"

# Clean up session-specific file
if ($session_id -and (Test-Path $session_file)) {
    Remove-Item $session_file -ErrorAction SilentlyContinue
}

# Beep
[console]::Beep(1047, 80)
Start-Sleep -Milliseconds 40
[console]::Beep(1568, 200)

# Win32 focus API
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Win32Focus {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    public const int SW_RESTORE = 9;
}
"@

function Focus-ClaudeWindow {
    $target = Get-Process | Where-Object {
        $_.ProcessName -match "(?i)^claude$" -and $_.MainWindowHandle -ne [IntPtr]::Zero
    } | Select-Object -First 1

    if (-not $target) {
        $target = Get-Process | Where-Object {
            $_.ProcessName -match "(?i)(WindowsTerminal|^wt$|pwsh|powershell|cmd)" -and
            $_.MainWindowTitle -match "(?i)claude" -and
            $_.MainWindowHandle -ne [IntPtr]::Zero
        } | Select-Object -First 1
    }

    if ($target) {
        [Win32Focus]::ShowWindow($target.MainWindowHandle, [Win32Focus]::SW_RESTORE)
        [Win32Focus]::SetForegroundWindow($target.MainWindowHandle)
    }
}

# Register app ID if not already registered
$regPath = 'HKCU:\Software\Classes\AppUserModelId\Claude.Code'
if (-not (Test-Path $regPath)) {
    New-Item -Path $regPath -Force | Out-Null
    Set-ItemProperty -Path $regPath -Name 'DisplayName' -Value 'Claude Code'
}

# Toast notification
try {
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

    $safeTitle = [System.Security.SecurityElement]::Escape($title)
    $safeBody = [System.Security.SecurityElement]::Escape($body)

    $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
    $xml.LoadXml("<toast><visual><binding template='ToastGeneric'><text>$safeTitle</text><text>$safeBody</text></binding></visual></toast>")

    $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
    $clicked = New-Object System.Threading.ManualResetEvent($false)
    $handler = { Focus-ClaudeWindow; [void]$clicked.Set() }
    $toast.add_Activated($handler.GetNewClosure())
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Claude.Code").Show($toast)
    [void]$clicked.WaitOne(30000)
    exit 0
} catch { }

# Fallback: Balloon Tip
try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing

    $n = New-Object System.Windows.Forms.NotifyIcon
    $n.Icon = [System.Drawing.SystemIcons]::Information
    $n.BalloonTipTitle = $title
    $n.BalloonTipText = $body
    $n.BalloonTipIcon = "Info"
    $n.Visible = $true
    $n.add_BalloonTipClicked({ Focus-ClaudeWindow })
    $n.ShowBalloonTip(6000)

    $end = (Get-Date).AddSeconds(6)
    while ((Get-Date) -lt $end) {
        [System.Windows.Forms.Application]::DoEvents()
        Start-Sleep -Milliseconds 100
    }
    $n.Dispose()
} catch { }
