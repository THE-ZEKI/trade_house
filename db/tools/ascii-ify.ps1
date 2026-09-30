#Requires -Version 5.1
<#
  trade_house · tools/ascii-ify.ps1
  Les scripts .sql sont volontairement forces en ASCII : sur Windows, psql lit
  les fichiers avec la page de code du systeme si le client n'est pas en UTF-8,
  et les messages d'erreur deviennent illisibles. On translittere donc
  (« » -> ", · et — -> -, accents -> ASCII) sans toucher au sens.

  Usage : .\db\tools\ascii-ify.ps1          # applique a tous les .sql
         .\db\tools\ascii-ify.ps1 -Check   # signale sans modifier
#>
[CmdletBinding()]
param([switch]$Check)

$ErrorActionPreference = 'Stop'
$db = Split-Path -Parent $PSScriptRoot

$map = @{
  [char]0x00AB = '"';  [char]0x00BB = '"'      # guillemets francais
  [char]0x00B7 = '-';  [char]0x2014 = '-'; [char]0x2013 = '-'   # point median, tirets
  [char]0x00A7 = '-';  [char]0x2026 = '...'
  [char]0x0153 = 'oe'; [char]0x0152 = 'OE'; [char]0x00E6 = 'ae'; [char]0x00C6 = 'AE'
}

$changed = 0
Get-ChildItem $db -Recurse -Filter *.sql | ForEach-Object {
  $file = $_
  $text = [System.IO.File]::ReadAllText($file.FullName, [System.Text.Encoding]::UTF8)
  $before = $text

  # 1. decompose puis supprime les diacritiques
  $text = $text.Normalize([System.Text.NormalizationForm]::FormD)
  $text = -join ($text.ToCharArray() | Where-Object { [int]$_ -lt 0x0300 -or [int]$_ -gt 0x036F })
  # 2. ponctuation typographique
  foreach ($k in $map.Keys) { $text = $text.Replace([string]$k, [string]$map[$k]) }
  # 3. reliquats
  $text = -join ($text.ToCharArray() | Where-Object { [int]$_ -le 127 })

  if ($text -ne $before) {
    $changed++
    if ($Check) { Write-Host "non ASCII : $($file.Name)" }
    else {
      [System.IO.File]::WriteAllText($file.FullName, $text, (New-Object System.Text.ASCIIEncoding))
      Write-Host "converti : $($file.Name)"
    }
  }
}

if ($Check -and $changed -eq 0) { Write-Host 'Tous les .sql sont en ASCII.' }
elseif (-not $Check) { Write-Host "$changed fichier(s) converti(s) en ASCII." }
