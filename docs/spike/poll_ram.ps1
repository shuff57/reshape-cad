param(
    [int]$BrowserPid = 37828,
    [int]$DurationSec = 60,
    [string]$OutFile = "C:\Users\shuff57\Documents\GitHub\reshape-cad\docs\spike\ram_log.csv"
)

"timestamp,pid,type,workingSetMB" | Out-File -FilePath $OutFile -Encoding utf8

$deadline = (Get-Date).AddSeconds($DurationSec)
while ((Get-Date) -lt $deadline) {
    try {
        $procs = Get-CimInstance Win32_Process -Filter "Name='chrome.exe' AND ParentProcessId=$BrowserPid" -ErrorAction SilentlyContinue
        foreach ($p in $procs) {
            $type = 'browser'
            if ($p.CommandLine -match '--type=([a-z-]+)') { $type = $matches[1] }
            try {
                $ws = (Get-Process -Id $p.ProcessId -ErrorAction Stop).WorkingSet64
                $wsMB = [math]::Round($ws / 1MB, 2)
                $ts = Get-Date -Format "o"
                "$ts,$($p.ProcessId),$type,$wsMB" | Out-File -FilePath $OutFile -Append -Encoding utf8
            } catch {}
        }
    } catch {}
    Start-Sleep -Milliseconds 500
}
