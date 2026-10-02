# trade_house - generate-install-sql.ps1
<#
  Regenere db/install.sql a partir du contenu reel du dossier migrations.

  Pourquoi cet outil existe : install.sql etait une liste de \i ecrite a la
  main, et elle s etait arretee a 014. Les migrations suivantes (2FA, video,
  reglages, formation...) n etaient donc jamais installees sur une base neuve —
  alors qu elles semblaient livrees, puisque leurs fichiers existaient.

  C est la meme famille de defaut que les boutons « Inviter » et « Planifier
  une reunion » : un composant existant, jamais rendu. Ici, une migration
  existante, jamais listee. Aucun outil ne le signalait, parce que tout le reste
  fonctionnait.

  Le fichier genere commence par un en-tete « GENERE », et l outil refuse de le
  regenerer dans le vide : la liste est deduite des fichiers, jamais recopiee.

      .\db\tools\generate-install-sql.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
# $PSScriptDir = <projet>\db\tools ; on veut <projet>\db
$root = Split-Path -Parent $PSScriptRoot
$migrations = Join-Path $root 'migrations'

if (-not (Test-Path $migrations)) { throw "Dossier introuvable : $migrations" }

$files = Get-ChildItem $migrations -Filter '*.sql' | Sort-Object Name
if ($files.Count -eq 0) { throw 'Aucune migration trouvee.' }

$head = @(
  '-- ============================================================================',
  '-- trade_house - install.sql',
  '-- INSTALLE L''ENSEMBLE DU SCHEMA DANS LA BASE COURANTE.',
  '--',
  '--     psql -U postgres -d trade_house -f db/install.sql',
  '-- (db/setup.ps1 fait le travail complet : creation de la base + install)',
  '--',
  '--   *** FICHIER GENERE PAR db/tools/generate-install-sql.ps1 ***',
  '--   Ne pas le modifier a la main : ajouter une migration ne l installerait pas.',
  '--   Relancez l outil apres tout ajout dans db/migrations/.',
  '-- ============================================================================',
  '\set ON_ERROR_STOP on',
  '\timing on',
  "",
  "\echo",
  "\echo === trade_house - installation des migrations ==="
)

$tail = @(
  "",
  "\echo === Installation terminee ===",
  "\echo Verification :",
  "\echo   \d public.reports",
  "\echo   select * from app.settings();",
  "\echo   select version from app.schema_migrations order by version;"
)

$body = $files | ForEach-Object { '\i migrations/{0}' -f $_.Name }

$target = Join-Path $root 'install.sql'
($head + $body + $tail) | Set-Content -Path $target -Encoding UTF8

Write-Host "install.sql regenere : $($files.Count) migrations listees."
Write-Host "  $($files[0].Name) .. $($files[-1].Name)"