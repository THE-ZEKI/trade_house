# Verification des ecrans : chaque page, chaque role.
# Objectif : attraper les 404 et les 500 avant que l'utilisateur ne les voie.
#
# PREREQUIS : le serveur doit tourner. Dans un autre terminal :
#     npm run dev
# Ce script ne demarre rien lui-meme — deux serveurs simultanes sur le meme
# port echoueraient silencieusement, et le diagnostic serait trompeur.

param(
  [string]$Base = 'http://127.0.0.1:3000'
)

$ErrorActionPreference = 'Stop'

# Test de joignabilite en tete : trois « echec de connexion » d'affilee ne
# disent rien d'utile sur les ecrans, seulement que le serveur manque.
try {
  Invoke-WebRequest "$Base/login" -TimeoutSec 10 -UseBasicParsing | Out-Null
} catch {
  Write-Host "SERVEUR INJOIGNABLE sur $Base" -ForegroundColor Red
  Write-Host "  Lancez d'abord :  npm run dev" -ForegroundColor Yellow
  Write-Host "  Puis rejouez    :  npm run check:pages"
  exit 2
}

# Une page qui repond 200 mais affiche une erreur Next ne doit pas passer.
# Attention : Next embarque la page 404 dans le bundle de CHAQUE route (le
# composant _not-found fait partie du payload), donc ce texte apparait partout.
# On ne controle donc que les marqueurs d'erreur de rendu et d'application.
$ERREURS = @(
  'Application error',
  'Internal Server Error',
  'Une erreur est survenue',
  'Erreur de rendu'
)

function Login([string]$email, [string]$password) {
  $s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $body = @{ email = $email; password = $password } | ConvertTo-Json
  $r = Invoke-WebRequest -Uri "$Base/api/auth/login" -Method POST -Body $body `
       -ContentType 'application/json' -WebSession $s -UseBasicParsing -TimeoutSec 20
  return $s
}

function Test-Page($s, [string]$path) {
  try {
    $r = Invoke-WebRequest -Uri "$Base$path" -WebSession $s -UseBasicParsing -TimeoutSec 25
    $code = $r.StatusCode
    $body = $r.Content
  } catch {
    $code = [int]$_.Exception.Response.StatusCode
    $body = ''
    # un 500 reste a examiner : le corps contient le motif de l'erreur
    try { $body = $_.Exception.Response.GetResponseStream() } catch {}
  }
  $ko = $false
  foreach ($e in $ERREURS) {
    if ($body -is [string] -and $body -like "*$e*") { $ko = $true; Write-Host "    ! marqueur '$e'" }
  }
  $flag = if ($code -ne 200) { 'ECHEC' } elseif ($ko) { 'ALERTE' } else { 'ok' }
  "{0,-8} {1,-3} {2}" -f $flag, $code, $path
}

$reportId  = $env:TH_REPORT_ID
$meetingId = $env:TH_MEETING_ID
$traderId  = $env:TH_TRADER_ID

$ACCOUNTS = @(
  @{ role = 'admin';   email = 'admin@trade-house.local';   mdp = 'Admin!2345' },
  @{ role = 'manager'; email = 'manager@trade-house.local'; mdp = 'Manager!2345' },
  @{ role = 'trader';  email = 'trader1@trade-house.local';  mdp = 'Trader!2345' }
)

# Un identifiant de rapport ou de reunion est DECOUVERT, jamais fourni.
#
# Raison : ils venaient de variables d'environnement. Sans elles, le script
# produisait « /traders/ » et un 308 — une faute de configuration presentee
# comme une panne de l'application. Un test capable d'echouer pour une cause
# qui n'est pas l'application n'est pas fiable : il doit trouver ses donnees.
$sAdmin = Login $ACCOUNTS[0].email $ACCOUNTS[0].mdp

function Get-Json($s, [string]$path) {
  try {
    return (Invoke-WebRequest -Uri "$Base$path" -WebSession $s -UseBasicParsing -TimeoutSec 20).Content |
      ConvertFrom-Json
  } catch {
    return $null
  }
}

# On passe par l'API et non par la base : le test verifie ce que voit
# reellement un utilisateur authentifie, RLS compris.
$traders  = @(Get-Json $sAdmin '/api/users'   | ForEach-Object { $_.users }   | Where-Object { $_.role -eq 'trader' })
$reports  = @(Get-Json $sAdmin '/api/reports' | ForEach-Object { $_.reports })
$meetings = @(Get-Json $sAdmin '/api/meetings'| ForEach-Object { $_.meetings })

if ($traders.Count  -eq 0) { Write-Host '  ATTENTION : aucun trader trouve'   -ForegroundColor Yellow }
if ($reports.Count  -eq 0) { Write-Host '  ATTENTION : aucun rapport trouve'   -ForegroundColor Yellow }
if ($meetings.Count -eq 0) { Write-Host '  ATTENTION : aucune reunion trouvee' -ForegroundColor Yellow }

$traderId  = if ($traders.Count)  { [string]$traders[0].id }  else { $null }
$reportId  = if ($reports.Count)  { [string]$reports[0].id }  else { $null }
$meetingId = if ($meetings.Count) { [string]$meetings[0].id } else { $null }

foreach ($a in $ACCOUNTS) {
  Write-Host ''
  Write-Host "=== $($a.role) : $($a.email) ==="
  try {
    $s = Login $a.email $a.mdp
  } catch {
    Write-Host "  ECHEC connexion : $($_.Exception.Message)"
    continue
  }

  $paths = @('/', '/reports', '/meetings', '/profile', '/notifications')
  if ($a.role -eq 'admin') { $paths += @('/users', '/audit', '/settings') }
  if ($a.role -in @('admin', 'manager') -and $traderId)  { $paths += "/traders/$traderId" }
  if ($reportId)  { $paths += "/reports/$reportId" }
  if ($a.role -eq 'trader') { $paths += '/reports/new' }
  if ($meetingId) { $paths += "/meetings/$meetingId" }

  foreach ($p in $paths) { Test-Page $s $p }
}
