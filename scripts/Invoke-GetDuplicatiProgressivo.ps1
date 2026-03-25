# Invoke-GetDuplicatiProgressivo.ps1
# Invoca la Edge Function "GetDuplicatiProgressivo" (lettura senza incremento).
#
# Richiede:
# - $env:GET_DUPLICATI_URL (opzionale) oppure passare -FunctionUrl
# - $env:SUPABASE_ANON_KEY (consigliato) oppure $env:SUPABASE_SERVICE_ROLE_KEY

param(
    [string]$FunctionUrl = $env:GET_DUPLICATI_URL,
    [string]$ApiKey = $env:SUPABASE_SERVICE_ROLE_KEY
)

if (-not $FunctionUrl) {
    Write-Error "Function URL non specificata. Imposta GET_DUPLICATI_URL o passa l'URL come primo argomento."
    exit 1
}

if (-not $ApiKey) {
    $ApiKey = $env:SUPABASE_ANON_KEY
}

if (-not $ApiKey) {
    Write-Error "API key non specificata. Imposta SUPABASE_ANON_KEY o SUPABASE_SERVICE_ROLE_KEY."
    exit 1
}

# Le chiavi anon/service role JWT iniziano quasi sempre con "eyJ..."
if ($ApiKey -notmatch '^eyJ') {
    Write-Error "API key non valida: atteso token JWT che inizia con 'eyJ'."
    exit 1
}

$headers = @{
    "Content-Type" = "application/json"
    "apikey" = $ApiKey
    "Authorization" = "Bearer $ApiKey"
}

try {
    Write-Host "Invocazione: $FunctionUrl" -ForegroundColor Cyan
    $response = Invoke-RestMethod -Uri $FunctionUrl -Method Post -Headers $headers -Body '{}' -ErrorAction Stop
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

