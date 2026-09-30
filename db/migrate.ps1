#Requires -Version 5.1
<#
  trade_house · migrate.ps1
  Applique UNIQUEMENT les migrations manquantes, sans recreer la base.

  Les migrations doivent etre jouees par le role proprietaire (postgres) :
  le role applicatif trade_house_app n'a volontairement pas le droit de
  creer des objets dans le schema app.

    .\db\migrate.ps1 -Password $env:PGPASSWORD
    .\db\migrate.ps1 -Password '...' -WhatIf     # liste sans executer
    .\db\migrate.ps1 -Password '...' -Reset     # repart de zero (base neuve)

  L'avancement est memorise dans la table app.schema_migrations : une
  migration rejouee par erreur ne se joue pas deux fois.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Password,
  [string]$DbName = 'trade_house',
  [string]$DbUser = 'postgres',
  [string]$Host_  = 'localhost',
  [int]   $Port    = 5432,
  [switch]$Reset,
  [switch]$WhatIf,
  # derniere migration deja appliquee, quand le journal est cree apres coup
  [string]$Baseline,
  # cree le premier administrateur juste apres les migrations (migration 015)
  [string]$AdminEmail,
  [string]$AdminName = 'Administrateur'
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
  param([string]$Arguments, [string]$Db = 'postgres')
  # psql ecrit les NOTICE sur stderr : on passe par cmd /c pour fusionner les
  # flux, sinon PowerShell (ErrorActionPreference = Stop) leve une erreur factice.
  $cmd = '"' + $bin + '" ' + $Arguments + ' -U ' + $DbUser + ' -h ' + $Host_ + ' -p ' + $Port + ' -d ' + $Db + ' 2>&1'
  return (& cmd /c $cmd)
}

# Toute erreur PostgreSQL doit INTERROMPRE le script. Sans cela, un mot de
# passe errone renvoie un resultat vide, le script conclut « rien a installer »
# et laisse croire a un etat sain : c'est exactement le piege constate.
function Assert-NoSqlError {
  param($Output, [string]$Contexte)
  $bad = @($Output | Where-Object { $_ -match 'FATAL|ERREUR|ERROR|authentification|password' })
  if ($bad.Count -gt 0) {
    $bad | Select-Object -First 3 | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    throw " Echec SQL ($Contexte) : " + ($bad | Select-Object -First 1)
  }
}

function Psql-Value {
  param([string]$Sql, [string]$Contexte = 'lecture')
  $out = Psql ('-tAc "' + ($Sql -replace '"', '\"') + '"') $DbName
  Assert-NoSqlError $out $Contexte
  return ($out | Where-Object { $_ -and $_ -notmatch 'psql:' } | Select-Object -First 1)
}

# --- test de connexion, avant toute chose ---------------------------------
Write-Host '== Verification de la connexion =='
$who = Psql-Value "select current_user" 'connexion'
if (-not $who) {
  throw @"
Connexion impossible en tant que « $DbUser » sur $Host_`:$Port.

Soit le mot de passe est errone, soit ce role n'a pas les droits de proprietaire
sur la base. Les migrations doivent etre jouees par le role proprietaire, car
le role applicatif n'a volontairement pas le droit de creer des objets dans le
schema app.

    .\db\setup.ps1 -Password '...'
"@
}
Write-Host "connecte en tant que : $who"

$migDir = Join-Path $PSScriptRoot 'migrations'
$files = Get-ChildItem $migDir -Filter '*.sql' | Sort-Object Name

Write-Host ''
Write-Host "== Migrations ($($files.Count) fichiers) =="

# --- table de suivi -------------------------------------------------------
$journalExists = Psql-Value "select count(*) from information_schema.tables where table_schema='app' and table_name='schema_migrations'"
if ($journalExists -ne '1') {
  $out = Psql '-q -c "create table if not exists app.schema_migrations (version text primary key, applied_at timestamptz not null default now())"' $DbName
  Assert-NoSqlError $out 'creation du journal'
  Write-Host 'table de suivi creee (app.schema_migrations)'
}

if (-not $Baseline) {
  $hasTables = Psql-Value "select count(*) from information_schema.tables where table_schema='public'"
  if ($hasTables -gt '0') {
    $last = (($files | Select-Object -Last 1).BaseName)
    throw @"
La base est deja installee mais le journal est vide : on ne sait pas jusqu'ou
les migrations ont ete appliquees. Relancez en indiquant la derniere migration
connue, par exemple :

    .\db\migrate.ps1 -Password '...' -Baseline 014_recurrence

(Sans cet argument, le script refuserait de rejouer 001..$last a l'aveugle.)
"@
  }
  Write-Host 'base vierge : toutes les migrations seront appliquees'
}

if ($Baseline) {
  $base = $files | Where-Object { $_.BaseName -eq $Baseline }
  if (-not $base) { throw "migration inconnue : $Baseline" }
  $all = $files | Select-Object -First ([array]::IndexOf($files, $base) + 1)
  $vals = ($all | ForEach-Object { "('$($_.BaseName)')" }) -join ','
  $out = Psql ('-q -c "insert into app.schema_migrations (version) values ' + $vals + ' on conflict do nothing"') $DbName
  Assert-NoSqlError $out 'initialisation du journal'
  Write-Host "journal initialise : $($all.Count) migration(s) marquee(s) jusqu'a $Baseline"
}

if ($Reset) {
  Psql '-q -c "truncate app.schema_migrations"' | Out-Null
  Write-Host 'journal remis a zero (-Reset) : toutes les migrations seront rejouees'
}

$joined = Psql-Value "select string_agg(version, ',') from app.schema_migrations"
$installed = @()
if ($joined -and ($joined -ne '')) { $installed = $joined.Split(',') }

$pending = @($files | Where-Object { $installed -notcontains $_.BaseName })
if ($pending.Count -eq 0) {
  Write-Host 'base a jour, rien a faire.'
  exit 0
}
Write-Host "$($pending.Count) migration(s) a appliquer :"
$pending | ForEach-Object { Write-Host "  - $($_.Name)" }

if ($WhatIf) { Write-Host '(-WhatIf : rien n a ete execute)'; exit 0 }

# --- application ----------------------------------------------------------
# Chaque migration est jouee dans SA propre transaction : si la 015 echoue, les
# 001..014 restent en place et l'on peut corriger puis relancer.
$applied = 0
foreach ($f in $pending) {
  Write-Host ''
  Write-Host "--> $($f.Name)"
  $out = Psql ('-q -v ON_ERROR_STOP=1 -f "' + $f.FullName + '"') $DbName
  $err = @($out | Where-Object { $_ -match 'ERREUR|FATAL' })
  if ($err.Count -gt 0) {
    $err | Select-Object -First 3 | ForEach-Object { Write-Host $_ }
    throw "migration en echec : $($f.Name)"
  }
  # marquage seulement apres succes
  $v = $f.BaseName.Replace("'", "''")
  $mark = Psql ('-q -c "insert into app.schema_migrations (version) values (''' + $v + ''') on conflict do nothing"') $DbName
  if ($mark | Where-Object { $_ -match 'ERREUR' }) { throw "journalisation impossible : $($f.Name)" }
  $applied++
  Write-Host "    appliquee"
}

Write-Host ''
Write-Host "SUCCES : $applied migration(s) appliquee(s)."

# --- premier administrateur (optionnel) -----------------------------------
# La porte de sortie de l'installation : sans elle, personne ne peut creer le
# premier compte, puisque app.create_user exige un administrateur (RG-02).
if ($AdminEmail) {
  Write-Host ''
  Write-Host '== Premier administrateur =='
  $mail = $AdminEmail.Replace("'", "''")
  $who = $AdminName.Replace("'", "''")
  $out = Psql ('-q -v ON_ERROR_STOP=1 -c "select app.bootstrap_admin(''' + $mail + '''::citext, ''' + $who + '''::varchar)"') $DbName
  $bad = @($out | Where-Object { $_ -match 'FATAL|ERREUR|desactive' })
  if ($bad.Count -gt 0) {
    $bad | Select-Object -First 2 | ForEach-Object { Write-Host $_ -ForegroundColor Yellow }
    Write-Host 'bootstrap refuse (un administrateur existe deja ?) : rien n a ete modifie'
  } else {
    Write-Host "administrateur cree : $AdminEmail"
    Write-Host "il n'a pas encore de mot de passe : utiliser « mot de passe oublie »"
  }
}
