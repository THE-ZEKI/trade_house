#Requires -Version 5.1
<#
  trade_house Â· installation de la base de developpement
  Usage :
    .\db\setup.ps1                       # cree la base si absente + installe
    .\db\setup.ps1 -Recreate             # supprime et recree tout
    .\db\setup.ps1 -Password 'monmdp'    # sinon utiliser $env:PGPASSWORD
#>
[CmdletBinding()]
param(
  [string]$DbName   = 'trade_house',
  [string]$DbUser   = 'postgres',
  [string]$Password = $env:PGPASSWORD,
  # mot de passe du role applicatif trade_house_app (jamais dans les migrations)
  [string]$AppPassword = 'trade_house_dev',
  [string]$Host_    = 'localhost',
  [int]   $Port     = 5432,
  [switch]$Recreate,
  [switch]$SkipSeed
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$install = Join-Path $PSScriptRoot 'install.sql'

# --- 1. Localiser psql -----------------------------------------------------
$psql = (Get-Command psql -ErrorAction SilentlyContinue).Source
if (-not $psql) {
  $cand = Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue |
          Sort-Object Name -Descending | ForEach-Object { Join-Path $_.FullName 'bin\psql.exe' } |
          Where-Object { Test-Path $_ } | Select-Object -First 1
  $psql = $cand
}
if (-not $psql) { throw "psql introuvable. Ajoutez le dossier bin de PostgreSQL au PATH." }
Write-Host "psql : $psql"

# --- 2. Environnement de connexion ----------------------------------------
if ($Password) { $env:PGPASSWORD = $Password }
$env:PGCONNECT_TIMEOUT = '10'
$common = @('-U', $DbUser, '-h', $Host_, '-p', $Port, '-v', 'ON_ERROR_STOP=1')

function Invoke-Psql {
  # $Arguments et non $Args : $Args est une variable automatique de PowerShell
  param([string[]]$Arguments, [string]$Db = 'postgres')
  & $psql @common @Arguments '-d' $Db
  if ($LASTEXITCODE -ne 0) { throw "psql a echoue (code $LASTEXITCODE)" }
}

# --- 3. Verification de l'encodage des scripts -----------------------------
# Les .sql doivent rester en ASCII : psql peut les lire avec une autre
# page de code sur Windows et produire des messages illisibles.
Get-ChildItem (Join-Path $PSScriptRoot 'migrations') -Filter *.sql | ForEach-Object {
  $bytes = [System.IO.File]::ReadAllBytes($_.FullName)
  if ($bytes | Where-Object { $_ -gt 127 } | Select-Object -First 1) {
    Write-Warning "($($_.Name) contient des octets non ASCII : verifier l'encodage."
  }
}

# --- 4. Creation de la base ------------------------------------------------
$exists = Invoke-Psql -Arguments @('-tAc', "select 1 from pg_database where datname = '$DbName'")
if ($Recreate -and $exists.Trim() -eq '1') {
  Write-Host "Suppression de la base $DbName ..."
  Invoke-Psql -Arguments @('-c', "drop database if exists `"$DbName`"")
  $exists = ''
}
if ($exists.Trim() -ne '1') {
  Write-Host "Creation de la base $DbName ..."
  Invoke-Psql -Arguments @('-c', "create database `"$DbName`" owner `"$DbUser`" encoding 'UTF8' template template0")
} else {
  Write-Host "Base $DbName deja presente."
}

# --- 5. Migrations ---------------------------------------------------------
Write-Host 'Installation des migrations ...'
if ($SkipSeed) {
  $tmp = Join-Path $env:TEMP 'trade_house_install_noseed.sql'
  (Get-Content $install -Encoding UTF8) -replace '\\i migrations/009_seed.sql', '' |
    Set-Content $tmp -Encoding ASCII
  Invoke-Psql -Arguments @('-f', $tmp) -Db $DbName
} else {
  Push-Location $PSScriptRoot
  try { Invoke-Psql -Arguments @('-f', $install) -Db $DbName }
  finally { Pop-Location }
}

# --- 6. Mot de passe du role applicatif ------------------------------------
# L'application doit se connecter avec un role NON proprietaire, sinon les
# politiques RLS sont contournees. Le mot de passe n'est jamais stocke dans une
# migration : il est defini ici.
$pw = $AppPassword.Replace("'", "''")
$res = Invoke-Psql -Arguments @('-q', '-c', "alter role trade_house_app login password '$pw'")
if ($res | Where-Object { $_ -match 'ERREUR' }) { throw 'mot de passe du role applicatif non defini' }
Write-Host 'Role applicatif trade_house_app : login configure.'

# --- 7. Controle final ----------------------------------------------------
$count = Invoke-Psql -Arguments @('-tAc', "select count(*) from information_schema.tables where table_schema = 'public'")
Write-Host ''
Write-Host "Tables creees dans public : $($count.Trim())"
Invoke-Psql -Arguments @('-c', "select email, role, is_active from public.users order by role, email") -Db $DbName
Write-Host "Base prete : $DbName"
Write-Host ''
Write-Host "Chaine de connexion pour .env.local :"
Write-Host "  DATABASE_URL=`"postgresql://trade_house_app:$AppPassword@localhost:5432/$DbName`""

