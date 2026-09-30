#Requires -Version 5.1
<#
  trade_house Â· test.ps1
  Recree la base, installe les migrations et joue db/tests/smoke.sql.
  A utiliser apres toute modification de migration.

    .\db\test.ps1 -Password 'votre_mot_de_passe'
    .\db\test.ps1 -Password '...' -Keep     # ne recree pas la base
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Password,
  [string]$DbName   = 'trade_house',
  [string]$DbUser   = 'postgres',
  [string]$Host_    = 'localhost',
  [int]   $Port     = 5432,
  # mot de passe du role applicatif trade_house_app (jamais dans les migrations)
  [string]$AppPassword = 'trade_house_dev',
  [switch]$Keep
)

$ErrorActionPreference = 'Stop'
$env:PGPASSWORD = $Password
$env:PGCLIENTENCODING = 'UTF8'

$bin = (Get-Command psql -ErrorAction SilentlyContinue).Source
if (-not $bin) {
  $bin = Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory | Sort-Object Name -Descending |
         ForEach-Object { Join-Path $_.FullName 'bin\psql.exe' } |
         Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $bin) { throw 'psql introuvable' }

function Psql {
  # psql ecrit les NOTICE sur stderr : on passe par cmd /c pour fusionner les
  # flux, sinon PowerShell (ErrorActionPreference = Stop) leve une erreur factice.
  param([string]$Arguments, [string]$Db = 'postgres')
  $cmd = '"' + $bin + '" ' + $Arguments + ' -U ' + $DbUser + ' -h ' + $Host_ + ' -p ' + $Port + ' -d ' + $Db + ' 2>&1'
  $output = & cmd /c $cmd
  return $output
}

Write-Host '== 1. Validation statique =='
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
  python db\tools\validate_sql.py
  if ($LASTEXITCODE -ne 0) { throw 'validation syntaxique en echec' }
  python db\tools\validate_schema.py
  if ($LASTEXITCODE -ne 0) { throw 'validation semantique en echec' }
} finally { Pop-Location }

Write-Host ''
Write-Host '== 2. Base de donnees =='
if (-not $Keep) {
  Psql '-q -c "select pg_terminate_backend(pid) from pg_stat_activity where datname=''trade_house'' and pid<>pg_backend_pid();"' 'postgres' | Out-Null
  Psql ('-q -c "drop database if exists ""' + $DbName + '"""') 'postgres' | Out-Null
  Psql ('-q -c "create database ""' + $DbName + '"" owner ""' + $DbUser + '"" encoding ''UTF8'' template template0"') 'postgres' | Out-Null
  Write-Host "base $DbName recreee"
}

Write-Host ''
Write-Host '== 3. Installation des migrations =='
if ($Keep) {
  # les migrations sont jouables une seule fois : avec -Keep on ne rejoue pas
  Write-Host 'ignoree (-Keep)'
} else {
  Push-Location $PSScriptRoot
  try { $install = Psql '-q -v ON_ERROR_STOP=1 -f install.sql' $DbName }
  finally { Pop-Location }
  $err = $install | Where-Object { $_ -match 'ERREUR|FATAL' }
  if ($err) { $err | Select-Object -First 3; throw 'installation en echec' }
  Write-Host 'installation OK'
}

# Mot de passe du role applicatif : jamais dans la migration.
# L'application se connecte avec ce role, sinon le RLS est contourne.
$pw = $AppPassword.Replace("'", "''")
$setRole = Psql ('-q -c "alter role trade_house_app login password ''' + $pw + '''"') 'postgres'
if ($setRole | Where-Object { $_ -match 'ERREUR' }) { throw 'mot de passe du role applicatif non defini' }
Write-Host "role applicatif : login configure"


Write-Host ''
Write-Host '== 4. Test des regles metier =='
Push-Location $PSScriptRoot
try { $smoke = Psql '-f tests\smoke.sql' $DbName }
finally { Pop-Location }

$lines = $smoke |
  ForEach-Object { $_ -replace '.*NOTICE:\s*', '' } |
  Where-Object { $_ -match '\[ok\]|\[KO\]|ERREUR' }
$lines | ForEach-Object { Write-Host $_ }

$ko = @($lines | Where-Object { $_ -match '\[KO\]|ERREUR' }).Count
$ok = @($lines | Where-Object { $_ -match '\[ok\]' }).Count
Write-Host ''
Write-Host "Assertions reussies : $ok"
if ($ko -gt 0) { Write-Host "ECHEC : $ko anomalie(s)"; exit 1 }
Write-Host 'SUCCES : toutes les assertions sont passees.'
