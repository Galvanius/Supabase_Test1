# Call-CalcolaDuplicatiProgressivo.ps1
# Invoca la Edge Function CalcolaDuplicatiProgressivo e stampa il valore restituito.
# Uso: .\Call-CalcolaDuplicatiProgressivo.ps1
# Opzionale: impostare la variabile d'ambiente FUNCTION_URL oppure passare come primo argomento.

param(
    [string]$FunctionUrl = $env:CALCOLA_DUPLICATI_URL,    # fallback su variabile d'ambiente
    [string]$ApiKey = $env:SUPABASE_SERVICE_ROLE_KEY       # opzionale: service role o anon key
)

if (-not $FunctionUrl) {
    Write-Error "Function URL non specificata. Imposta la variabile d'ambiente CALCOLA_DUPLICATI_URL o passa l'URL come primo argomento."
    exit 1
}

# Prepara header
$headers = @{
    "Content-Type" = "application/json"
}
if ($ApiKey) {
    # Aggiungi sia apikey che Authorization Bearer per compatibilità con endpoint Supabase
    $headers["apikey"] = $ApiKey
    $headers["Authorization"] = "Bearer $ApiKey"
}

try {
    Write-Host "Invocazione della funzione: $FunctionUrl" -ForegroundColor Cyan

    # POST senza body (la funzione nel deploy non richiede payload)
    $response = Invoke-RestMethod -Uri $FunctionUrl -Method Post -Headers $headers -ErrorAction Stop

    # Mostra il risultato in formato leggibile
    Write-Host "Risposta ricevuta:" -ForegroundColor Green
    if ($response -is [string]) {
        # Se viene restituita una stringa JSON
        $trim = $response.Trim()
        try {
            $json = $trim | ConvertFrom-Json
            $json | ConvertTo-Json -Depth 5
        } catch {
            Write-Host $trim
        }
    } else {
        $response | ConvertTo-Json -Depth 5
    }
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
        } catch {
            # ignore
        }
    }
    exit 2
}