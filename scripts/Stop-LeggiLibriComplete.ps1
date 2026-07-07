# Stop-LeggiLibriComplete.ps1
# Imposta GAL_PARAMETER.LEGGI_LIBRI_COMP = 0 per interrompere il manager in esecuzione.

. "$PSScriptRoot\Set-LocalSupabase.ps1"
$local = Get-LocalSupabaseDefaults

$baseUrl = $env:SUPABASE_URL
if (-not $baseUrl) { $baseUrl = $local.SupabaseUrl }

$apiKey = $env:SUPABASE_SERVICE_ROLE_KEY
if (-not $apiKey) { $apiKey = $local.ServiceRoleKey }

$headers = @{
    "Content-Type" = "application/json"
    "apikey"       = $apiKey
    "Authorization" = "Bearer $apiKey"
    "Prefer"       = "return=representation"
}

$uri = "$baseUrl/rest/v1/GAL_PARAMETER?nome=eq.LEGGI_LIBRI_COMP"
$body = @{ valore_num = 0 } | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Uri $uri -Method Patch -Headers $headers -Body $body -ErrorAction Stop
    Write-Host "Stop richiesto: LEGGI_LIBRI_COMP impostato a 0." -ForegroundColor Yellow
    if ($response) { $response }
}
catch {
    Write-Host "Errore durante lo stop:" -ForegroundColor Red
    Write-Host $_.Exception.Message
    exit 2
}
