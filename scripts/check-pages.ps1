# Verification des ecrans : chaque page, chaque role.
# Objectif : attraper les 404 et les 500 avant que l'utilisateur ne les voie.
#
# PREREQUIS : le serveur doit tourner. Dans un autre terminal :
#     npm run dev
# Ce script ne demarre rien lui-meme - deux serveurs simultanes sur le meme
# port echoueraient silencieusement, et le diagnostic serait trompeur.

param(
  [string]$Base = 'http://127.0.0.1:3000'
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot '_th-accounts.ps1')

# Test de joignabilite en tete : trois " echec de connexion " d'affilee ne
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

# Une ressource qui n existe pas DOIT repondre 404 ou 403. Un 200 y serait un
# defaut de cloisonnement bien plus grave qu'une page manquante.
function Test-Forbidden($s, [string]$path, [string]$what) {
  try {
    $r = Invoke-WebRequest -Uri "$Base$path" -WebSession $s -UseBasicParsing -TimeoutSec 25
    $code = $r.StatusCode
  } catch {
    $code = [int]$_.Exception.Response.StatusCode
  }
  if ($code -eq 404 -or $code -eq 403) {
    "{0,-8} {1,-3} {2}" -f 'ok', $code, $what
  } else {
    "{0,-8} {1,-3} {2}" -f 'ALERTE', $code, $what
  }
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

function Get-Html($s, [string]$path) {
  try {
    return (Invoke-WebRequest -Uri "$Base$path" -WebSession $s -UseBasicParsing -TimeoutSec 25).Content
  } catch {
    return ''
  }
}

# Verifie qu un libelle est PRESENT ou ABSENT dans le HTML rendu.
#
# Pourquoi : un composant peut etre importe, compile, et simplement ne jamais etre
# rendu. C est exactement ce qui est arrive sur /users (InviteUser) et /meetings
# (CreateMeeting) : les imports etaient la, l attribut `actions` du PageHeader
# manquait, aucun outil ne l avait signale, et les deux boutons etaient invisibles.
# Un test HTTP qui ne verifie que le code 200 laisse passer ce defaut ; il faut
# donc controler la presence reelle du bouton dans la page servie.
function Test-Contient($s, [string]$path, [string]$libelle, [bool]$attendu) {
  $html = Get-Html $s $path
  if ($html -eq '') { return "{0,-8} {1,-3} {2}" -f 'ALERTE', '-', "$path (page illisible)" }
  $trouve = $html -like "*$libelle*"
  if ($trouve -eq $attendu) {
    return "{0,-8} {1,-3} {2}" -f 'ok', 200, "$path contient '$libelle'"
  }
  $sens = if ($attendu) { 'devrait contenir' } else { 'ne devrait PAS contenir' }
  return "{0,-8} {1,-3} {2}" -f 'ECHEC', 200, "$path $sens '$libelle'"
}

$reportId  = $env:TH_REPORT_ID
$meetingId = $env:TH_MEETING_ID
$traderId  = $env:TH_TRADER_ID

$ACCOUNTS = Get-THAccounts
Assert-THAccounts $ACCOUNTS 'check-pages'

# Un identifiant de rapport ou de reunion est DECOUVERT, jamais fourni.
#
# Raison : ils venaient de variables d'environnement. Sans elles, le script
# produisait " /traders/ " et un 308 - une faute de configuration presentee
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

  # Un rapport n est teste avec un role que s il est REELLEMENT visible par
  # ce role. Un trader ne voit pas les rapports des autres : lui faire ouvrir
  # le rapport d un collegue retournerait 404, ce qui est le RLS qui
  # fonctionne, et non une panne. On interroge donc l API avec LA session
  # du role reellement teste.
  $ownReports  = @(Get-Json $s '/api/reports'  | ForEach-Object { $_.reports })
  $ownMeetings = @(Get-Json $s '/api/meetings' | ForEach-Object { $_.meetings })
  $myReportId  = if ($ownReports.Count)  { [string]$ownReports[0].id }  else { $null }
  $myMeetingId = if ($ownMeetings.Count) { [string]$ownMeetings[0].id } else { $null }

  $paths = @('/', '/reports', '/meetings', '/profile', '/notifications')
  if ($a.role -eq 'admin') { $paths += @('/users', '/audit', '/settings') }
  if ($a.role -in @('admin', 'manager') -and $traderId) { $paths += "/traders/$traderId" }
  if ($myReportId)  { $paths += "/reports/$myReportId" }
  if ($a.role -eq 'trader') { $paths += '/reports/new' }
  if ($myMeetingId) { $paths += "/meetings/$myMeetingId" }

  # Verification negative explicite : un trader ne doit PAS voir le rapport
  # d un collegue. C est le controle le plus utile de la liste.
  if ($a.role -eq 'trader' -and $reportId -and $myReportId -ne $reportId) {
    Write-Host ''
    Write-Host '  -- cloisonnement entre traders --'
    Test-Forbidden $s "/reports/$reportId" 'rapport d un autre trader'
  }

  foreach ($p in $paths) { Test-Page $s $p }

  Write-Host ''
  Write-Host '  -- actions reellement rendues --'
  # RG-06 : "Inviter" est reserve a l administration. RG-30 : la planification
  # revient a l encadrement. Le reste du monde ne doit pas les voir.
  $peutInviter  = ($a.role -eq 'admin')
  $peutPlanifier = ($a.role -in @('admin', 'manager'))

  # On controle le libelle du BOUTON declencheur, pas celui de la modale :
  # "Inviter un compte" n apparait qu une fois la fenetre ouverte, et
  # chercher cette chaine ferait echouer le test sur une page parfaitement
  # correcte. "Invoker" est le texte du bouton lui-meme.
  if ($a.role -eq 'admin') { Test-Contient $s '/users' '>Inviter<' $true }
  Test-Contient $s '/meetings' 'Planifier une reunion' $peutPlanifier
}
