# Invoke-LeggiLibri-complete-manager.ps1
# Invoca leggi_libri_complete_manager: scansione ricorsiva FolderA/FolderB,
# confronto di ogni coppia PDF tramite leggi_libri_complete_worker.

param(
    [string]$FunctionUrl = $env:LEGGI_LIBRI_COMPLETE_MANAGER_URL,
    [string]$ApiKey = $env:SUPABASE_SERVICE_ROLE_KEY,
    [string]$FirstPrefix = "FolderA",
    [string]$SecondPrefix = "FolderB",
    [double]$Threshold = 0.7,
    [int]$MaxSamples = 48
)

. "$PSScriptRoot\Set-LocalSupabase.ps1"
$local = Get-LocalSupabaseDefaults

if (-not $FunctionUrl) { $FunctionUrl = $local.LeggiLibriCompleteManager }
if (-not $ApiKey) { $ApiKey = $env:SUPABASE_ANON_KEY }
if (-not $ApiKey) { $ApiKey = $local.ServiceRoleKey }

$headers = @{
    "Content-Type" = "application/json"
}
if ($ApiKey) {
    $headers["apikey"] = $ApiKey
    $headers["Authorization"] = "Bearer $ApiKey"
}

try {
    Write-Host "Invocazione manager: $FunctionUrl" -ForegroundColor Cyan
    Write-Host "Scansione ricorsiva $FirstPrefix vs $SecondPrefix (max $MaxSamples campioni/pagina)." -ForegroundColor DarkGray

    $body = @{
        firstPrefix  = $FirstPrefix
        secondPrefix = $SecondPrefix
        threshold    = $Threshold
        maxSamples   = $MaxSamples
    } | ConvertTo-Json

    $response = Invoke-RestMethod -Uri $FunctionUrl -Method Post -Headers $headers -Body $body -ErrorAction Stop
    if ($response) {
        $response
    } else {
        Write-Host "Nessun match sopra la soglia $Threshold." -ForegroundColor Yellow
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
        } catch { }
    }
    exit 2
}
