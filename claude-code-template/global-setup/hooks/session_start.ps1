# Claude Code SessionStart hook: record session start time
$input_json = $input | Out-String
try {
    $data = $input_json | ConvertFrom-Json
    $session_id = $data.session_id
} catch {
    $session_id = $null
}

$timestamp = (Get-Date).ToString('o')

# Session-specific file (prevents overwrite when multiple sessions open)
if ($session_id) {
    $safe_id = $session_id -replace '[^a-zA-Z0-9_-]', '_'
    $session_file = "$env:TEMP\claude_start_$safe_id.txt"
    $timestamp | Out-File -FilePath $session_file -Encoding UTF8 -NoNewline
}

# Also write shared fallback file
$timestamp | Out-File -FilePath "$env:TEMP\claude_session_start.txt" -Encoding UTF8 -NoNewline
