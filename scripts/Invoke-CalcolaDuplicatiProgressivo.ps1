# Invoke-CalcolaDuplicatiProgressivo.ps1
# Invoca la Edge Function "CalcolaDuplicatiProgressivo" sul Supabase locale.
# Per il cloud, imposta CALCOLA_DUPLICATI_URL e SUPABASE_* prima di eseguire.

param(
    [string]$FunctionUrl = $env:CALCOLA_DUPLICATI_URL,
    [string]$ApiKey = $env:SUPABASE_SERVICE_ROLE_KEY
)

. "$PSScriptRoot\Set-LocalSupabase.ps1"
$local = Get-LocalSupabaseDefaults

if (-not $FunctionUrl) { $FunctionUrl = $local.CalcolaDuplicati }
if (-not $ApiKey) { $ApiKey = $env:SUPABASE_ANON_KEY }
if (-not $ApiKey) { $ApiKey = $local.ServiceRoleKey }

if ($ApiKey -notmatch '^eyJ') {
    Write-Error "API key non valida: atteso token JWT che inizia con 'eyJ'."
    exit 1
}

$headers = @{
    "Content-Type"  = "application/json"
    "apikey"        = $ApiKey
    "Authorization" = "Bearer $ApiKey"
}

try {
    Write-Host "Invocazione (locale): $FunctionUrl" -ForegroundColor Cyan
    $response = Invoke-RestMethod -Uri $FunctionUrl -Method Post -Headers $headers -ErrorAction Stop
    $response
}
catch {
    Write-Host "Errore durante l'invocazione:" -ForegroundColor Red
    Write-Host $_.Exception.Message
    if ($_.Exception.Response -ne $null) {
        try {
            $errBody = ($_ | Select-Object -ExpandProperty Exception).Response.GetResponseStream()
            if ($errBody) {
                $sr = New-Object System.IO.StreamReader($errBody)
                $content = $sr.ReadToEnd()
                Write-Host "Body di risposta:" -ForegroundColor Yellow
                Write-Host $content
            }
        } catch { }
    }
    exit 2
}
