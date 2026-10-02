#Requires -RunAsAdministrator
<#
  trade_house · reset-db-owner-password.ps1

  Reinitialise le mot de passe du role PROPRIETAIRE `postgres`, indispensable
  pour jouer les migrations (app.* et les politiques RLS exigent d etre
  proprietaire des objets).

  Pourquoi passer par pg_hba.conf : on ne peut pas changer un mot de passe
  sans s'authentifier. Le principe est donc d'ouvrir temporairement une
  connexion locale en `trust`, de fixer le mot de passe, puis de REMETTRE LE
  FICHIER A L IDENTIQUE. Le script le fait lui-meme et verifie ensuite que la
  connexion par mot de passe fonctionne : si la restauration echouait, on ne
  laisserait pas une base ouverte a tout le reseau local.

      .\scripts\reset-db-owner-password.ps1 -Password 'unMotDePasseSolide'

  Necessite des droits administrateur (edition de pg_hba.conf + redemarrage
  du service).
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Password,
  [string]$NewUser = 'postgres',
  [string]$DbName = 'trade_house',
  [string]$DataDir = 'C:\Program Files\PostgreSQL\18\data',
  [string]$Service = 'postgresql-x64-18',
  [string]$Psql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
)

$ErrorActionPreference = 'Stop'

$hba = Join-Path $DataDir 'pg_hba.conf'
if (-not (Test-Path $hba)) { throw "pg_hba.conf introuvable : $hba" }
if (-not (Test-Path $Psql)) { throw "psql introuvable : $Psql" }

$backup = "$hba.tradesave.bak"
Copy-Item $hba $backup -Force
Write-Host "Sauvegarde : $backup"

function Restart-Pg {
  Write-Host '  redemarrage du service...'
  Restart-Service $Service -Force
  # On attend que la socket accepte de nouveau : sans cela, l' ALTER part
  # avant que le serveur ne soit pret et echoue sans raison lisible.
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-NetConnection -ComputerName 127.0.0.1 -Port 5432 -InformationLevel Quiet -WarningAction SilentlyContinue) { return }
  }
  throw 'Le service ne repond pas sur le port 5432 apres redemarrage.'
}

try {
  # --- 1. ouverture temporaire en `trust` ---------------------------------
  # Les regles de pg_hba.conf sont evaluees DANS L ORDRE : la premiere qui
  # correspond gagne. On insere donc en tete de fichier, pas a la fin.
  $trust = @(
    '# trade_house · ouverture temporaire (retiree a la fin du script)',
    'host    all             all             127.0.0.1/32            trust',
    'host    all             all             ::1/128                 trust'
  ) -join "`r`n"
  Set-Content -Path $hba -Value ($trust + "`r`n" + (Get-Content $hba -Raw)) -Encoding ASCII
  Write-Host 'Ouverture temporaire en `trust` (127.0.0.1 et ::1).'
  Restart-Pg

  # --- 2. fixation du mot de passe ----------------------------------------
  $escaped = $Password.Replace("'", "''")
  & $Psql -h 127.0.0.1 -U $NewUser -d $DbName -v ON_ERROR_STOP=1 `
    -c "alter role `"$NewUser`" with password '$escaped'" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "ALTER ROLE a echoue (code $LASTEXITCODE)." }
  Write-Host "Mot de passe de $NewUser modifie."

} finally {
  # --- 3. restauration, toujours ------------------------------------------
  Copy-Item $backup $hba -Force
  Write-Host 'pg_hba.conf restaure.'
  Restart-Pg
}

# --- 4. verification : la connexion par mot de passe doit fonctionner ------
$env:PGPASSWORD = $Password
& $Psql -h 127.0.0.1 -U $NewUser -d $DbName -t -c 'select 1' | Out-Null
if ($LASTEXITCODE -eq 0) {
  Write-Host ''
  Write-Host 'OK — connexion par mot de passe verifiee.' -ForegroundColor Green
  Write-Host ''
  Write-Host 'Dans votre terminal :'
  Write-Host ("  `$env:PGPASSWORD = '{0}'" -f $Password)
  Write-Host '  npm run db:migrate'
} else {
  Write-Host 'ECHEC — la connexion par mot de passe ne fonctionne toujours pas.' -ForegroundColor Red
  exit 1
}