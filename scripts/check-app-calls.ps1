# Verification des appels de fonctions metier.
#
# Pourquoi : une liste blanche existe pour empecher l'injection de nom de
# fonction depuis une requete. Elle a aussi bloque 24 appels parce que les
# routes ecrivaient tantôt 'validate_report', tantôt 'app.validate_report'.
# Le symptome — « Fonction non autorisee » — ne disait pas quelle forme
# employer, et TypeScript ne voyait rien : un appel a une chaine libre compile
# toujours.
#
# Ce test compare chaque appel a la liste blanche. Il est donc PRECOCE : il
# tourne avant meme le serveur, la, ou une erreur de compilation ne peut pas
# masquer une omission.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

$dbPath = Join-Path $root 'src\lib\db.ts'
if (-not (Test-Path $dbPath)) {
  Write-Host 'src/lib/db.ts introuvable' -ForegroundColor Red
  exit 2
}

$lines = [System.IO.File]::ReadAllLines($dbPath)
$start = ($lines | Select-String 'const APP_FUNCTIONS').LineNumber
if (-not $start) {
  Write-Host 'Liste APP_FUNCTIONS introuvable dans src/lib/db.ts' -ForegroundColor Red
  exit 2
}

$autorisees = New-Object System.Collections.Generic.HashSet[string]
for ($i = $start - 1; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -match '^\]\);') { break }
  foreach ($m in [regex]::Matches($lines[$i], "'(app\.[a-z_]+)'")) {
    [void]$autorisees.Add($m.Groups[1].Value)
  }
}

$refuses = New-Object System.Collections.Generic.List[string]
$total = 0

foreach ($f in Get-ChildItem (Join-Path $root 'src') -Recurse -Include '*.ts', '*.tsx') {
  $content = [System.IO.File]::ReadAllText($f.FullName)
  foreach ($m in [regex]::Matches($content, "callApp(?:Set)?(?:<[^>]*>)?\(\s*sql\s*,\s*'([^']+)'")) {
    $total++
    $fn = $m.Groups[1].Value
    if (-not $fn.Contains('.')) { $fn = "app.$fn" }
    if (-not $autorisees.Contains($fn)) {
      $rel = $f.FullName.Replace("$root\src\", '')
      $refuses.Add("$fn  <-  $rel")
    }
  }
}

Write-Host "Appels de fonctions metier : $total"
Write-Host "Liste blanche           : $($autorisees.Count) entrees"

if ($refuses.Count -gt 0) {
  Write-Host ''
  Write-Host "APPELS REFUSES ($($refuses.Count)) :" -ForegroundColor Red
  $refuses | Sort-Object -Unique | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
  exit 1
}

Write-Host ''
Write-Host 'Tous les appels sont dans la liste blanche.' -ForegroundColor Green
exit 0