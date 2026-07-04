# Set-LocalSupabase.ps1
# Imposta variabili d'ambiente per Supabase locale (Supabase_Test2 / supabase start).
# Chiavi JWT standard dello stack locale — solo per sviluppo, non usare in produzione.

$script:LocalSupabaseUrl = "http://127.0.0.1:54321"
$script:LocalFunctionsBase = "$LocalSupabaseUrl/functions/v1"
$script:LocalAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
$script:LocalServiceRoleKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"

function Set-LocalSupabaseEnv {
    $env:SUPABASE_URL = $script:LocalSupabaseUrl
    $env:SUPABASE_ANON_KEY = $script:LocalAnonKey
    $env:SUPABASE_SERVICE_ROLE_KEY = $script:LocalServiceRoleKey
    $env:CALCOLA_DUPLICATI_URL = "$script:LocalFunctionsBase/CalcolaDuplicatiProgressivo"
    $env:GET_DUPLICATI_URL = "$script:LocalFunctionsBase/GetDuplicati"
    $env:LEGGI_LIBRI_URL = "$script:LocalFunctionsBase/leggi_libri"
}

function Get-LocalSupabaseDefaults {
    [PSCustomObject]@{
        SupabaseUrl      = $script:LocalSupabaseUrl
        FunctionsBase    = $script:LocalFunctionsBase
        AnonKey          = $script:LocalAnonKey
        ServiceRoleKey   = $script:LocalServiceRoleKey
        CalcolaDuplicati = "$script:LocalFunctionsBase/CalcolaDuplicatiProgressivo"
        GetDuplicati     = "$script:LocalFunctionsBase/GetDuplicati"
        LeggiLibri       = "$script:LocalFunctionsBase/leggi_libri"
    }
}
