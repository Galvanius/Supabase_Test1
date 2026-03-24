# Invoke-LeggiLibri.ps1
# Invoca la Edge Function "leggi_libri".
#
# Richiede:
# - $env:LEGGI_LIBRI_URL (es. https://<project-ref>.supabase.co/functions/v1/leggi_libri)
# - $env:SUPABASE_ANON_KEY (oppure $env:SUPABASE_SERVICE_ROLE_KEY)
#

param(
    [string]$FunctionUrl = $env:LEGGI_LIBRI_URL,
    [string]$ApiKey = $env:SUPABASE_SERVICE_ROLE_KEY,
    [string]$FirstPrefix = "FolderA",
    [string]$SecondPrefix = "FolderB",
    [double]$Threshold = 0.7
)

if (-not $FunctionUrl) {
    Write-Error "Function URL non specificata. Imposta LEGGI_LIBRI_URL o passa l'URL come primo argomento."
    exit 1
}

if (-not $ApiKey) {
    $ApiKey = $env:SUPABASE_ANON_KEY
}

$headers = @{
    "Content-Type" = "application/json"
}
if ($ApiKey) {
    $headers["apikey"] = $ApiKey
    $headers["Authorization"] = "Bearer $ApiKey"
}

try {
    Write-Host "Invocazione: $FunctionUrl" -ForegroundColor Cyan

    $body = @{
        firstPrefix  = $FirstPrefix
        secondPrefix = $SecondPrefix
        threshold    = $Threshold
    } | ConvertTo-Json

    $response = Invoke-RestMethod -Uri $FunctionUrl -Method Post -Headers $headers -Body $body -ErrorAction Stop
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

