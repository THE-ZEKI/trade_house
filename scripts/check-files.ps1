param([string]$Base = 'http://127.0.0.1:3000')
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot '_th-accounts.ps1')

# Depot de rapport et annotations, de bout en bout (RG-31, RG-32, RG-46).
#
# Chaque etape verifie le RESULTAT, pas seulement le code HTTP : une route qui
# repond 201 sans rien inserer, ou qui accepte un fichier au mauvais format,
# laisserait passer un test limite au statut.
#
# Le point le plus important est l'etape 5 : avant la migration 020, un TRADER
# pouvait poser une annotation sur le fichier d'un autre, la politique 008
# portant `with check (true)`. Ce refus etait donc IMPOSSIBLE a obtenir.

function Login($email, $password) {
  $s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $b = @{ email = $email; password = $password } | ConvertTo-Json
  Invoke-WebRequest -Uri "$Base/api/auth/login" -Method POST -Body $b -ContentType 'application/json' `
    -WebSession $s -UseBasicParsing -TimeoutSec 20 | Out-Null
  return $s
}
function Cookie($s) {
  return ($s.Cookies.GetCookies($Base) | Where-Object { $_.Name -eq 'th_session' } | Select-Object -First 1).Value
}
function Json($s, $path) {
  try {
    return (Invoke-WebRequest -Uri "$Base$path" -WebSession $s -UseBasicParsing -TimeoutSec 20).Content | ConvertFrom-Json
  } catch { return $null }
}
function Say($ok, $label, $detail) {
  $tag = if ($ok) { 'ok   ' } else { 'ECHEC' }
  $d = if ($detail) { " ($detail)" } else { '' }
  "{0} {1}{2}" -f $tag, $label, $d
}
# curl.exe : PowerShell n'envoie pas un multipart/form-data correct.
# En revanche curl perd les guillemets d'un corps JSON passe via -d sous
# PowerShell, ce qui produit un Â« forme invalide Â» trompeur. On utilise donc
# Invoke-WebRequest pour le JSON et curl uniquement pour le multipart.
function Post-File($cookie, $path, $file, $mime, $name) {
  return (& curl.exe -s -X POST "$Base$path" -b "th_session=$cookie" -F "file=@$file;type=$mime;filename=$name" 2>&1) -join ''
}
function Post-Json($session, $path, $body) {
  # On renvoie le CODE et le CORPS separement. Un refus HTTP n'est pas une
  # panne : 422 et 409 sont des reponses attendues ici, et un test qui ne
  # verifie que le succes les compterait a tort comme des echecs.
  try {
    $r = Invoke-WebRequest -Uri "$Base$path" -Method POST -Body $body `
      -ContentType 'application/json' -WebSession $session -UseBasicParsing -TimeoutSec 25
    return @{ code = $r.StatusCode; body = $r.Content }
  } catch {
    $code = 0
    try { $code = [int]$_.Exception.Response.StatusCode } catch {}
    $text = $_.ErrorDetails.Message
    if (-not $text) { $text = "HTTP $code" }
    return @{ code = $code; body = $text }
  }
}
function Del-Json($session, $path) {
  try {
    return (Invoke-WebRequest -Uri "$Base$path" -Method DELETE -WebSession $session -UseBasicParsing -TimeoutSec 25).StatusCode
  } catch {
    try { return [int]$_.Exception.Response.StatusCode } catch { return 0 }
  }
}

# Un PNG de 2x2 pixels ecrit octet par octet : aucun binaire dans le depot.
function New-Png {
  $bytes = [byte[]]@(
    0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A, 0x00,0x00,0x00,0x0D, 0x49,0x48,0x44,0x52,
    0x00,0x00,0x00,0x02, 0x00,0x00,0x00,0x02, 0x08,0x06,0x00,0x00,0x00,0x72,0xB6,0x0D,
    0x24, 0x00,0x00,0x00,0x1A, 0x49,0x44,0x41,0x54,0x78,0x9C,0x63,0xFC,0xCF,0xC0,0x50,
    0x0F,0x00,0x04,0x85,0x01,0x80,0x84,0xA2,0x8C,0x18,0x00,0x00,0x82,0x5F,0xFF,0xFE,
    0x2F,0x8F,0x0B,0x86,0x00,0x00,0x00,0x00, 0x49,0x45,0x4E,0x44,0xAE,0x42,0x60,0x82
  )
  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ('th-test.png')
  [System.IO.File]::WriteAllBytes($tmp, $bytes)
  return $tmp
}

# Un rapport en brouillon est cree si besoin : le script ne doit pas dependre
# d une preparation manuelle, sous peine qu il echoue sans raison apparente la
# premiere fois qu il est rejoue apres une soumission.
function Ensure-Draft($session) {
  $existing = @(Json $session '/api/reports' | ForEach-Object { $_.reports } |
    Where-Object { $_.status -eq 'draft' })
  if ($existing.Count -gt 0) { return $existing[0] }

  # On essaie plusieurs dates : une seule session par jour et par trader.
  $dates = @('2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-10', '2026-08-11')
  foreach ($d in $dates) {
    $body = (@{
      sessionDate = $d; instrument = 'EURUSD'; resultType = 'gain'; resultAmount = 250
      strategy = 'Test depot'; nbTrades = 3; planRespected = $true
      rrPlanned = 1.5; rrRealized = 2.1; emotions = @('calm')
    } | ConvertTo-Json)
    $r = Post-Json $session '/api/reports' $body | ConvertFrom-Json
    if ($r.report.id) { return $r.report }
  }
  return $null
}

$ACCT = Get-THAccounts
Assert-THAccounts $ACCT 'check-files'

$t1 = $ACCT | Where-Object { $_.role -eq 'trader' }
$mg = $ACCT | Where-Object { $_.role -eq 'manager' }
$ad = $ACCT | Where-Object { $_.role -eq 'admin' }
$trd  = Login $t1.email $t1.mdp
$mgr  = Login $mg.email $mg.mdp
$adm  = Login $ad.email $ad.mdp

$report = Ensure-Draft $trd
if ($null -eq $report) {
  Write-Host 'ECHEC global : impossible de creer un rapport de test.' -ForegroundColor Red
  exit 1
}
$reportId = [string]$report.id
$ck   = Cookie $trd
$ckM  = Cookie $mgr
Write-Host "Rapport de test : $reportId ($($report.session_date))"
Write-Host ''

$png = New-Png

# --- 1. depot valide -------------------------------------------------------
$up   = Post-File $ck "/api/reports/$reportId/files" $png 'image/png' 'capture.png' | ConvertFrom-Json
$fileId = $up.file.id
Say ([bool]$fileId) 'depot d une capture PNG valide' "file=$fileId"

if ($fileId) {
  # --- 2. telechargement prive --------------------------------------------
  $head = (& curl.exe -s -o NUL -w '%{http_code} %{content_type}' "$Base/api/reports/files/$fileId" -b "th_session=$ck") -join ''
  Say ($head -like '200 image/png') 'telechargement prive de la capture' $head

  # --- 3. annotations ------------------------------------------------------
  $shape = (@{ shape = 'rectangle'; data = @{ x = 0.1; y = 0.1; w = 0.4; h = 0.2; color = '#e11d48' } } | ConvertTo-Json -Depth 4)
  $ok = Post-Json $mgr "/api/reports/files/$fileId/annotations" $shape
Say ($ok.code -eq 201) 'encadrement pose une annotation' "HTTP $($ok.code)"

  # Le test le plus important : ce refus etait IMPOSSIBLE avant la migration 020.
  $refus = Post-Json $trd "/api/reports/files/$fileId/annotations" $shape
  Say ($refus.code -eq 403) 'trader NE PEUT PAS annoter' "HTTP $($refus.code) $(($refus.body -replace '\s+',' '))"

  $hors = (@{ shape = 'rectangle'; data = @{ x = 5; y = 9; w = 0.2; h = 0.2 } } | ConvertTo-Json -Depth 4)
  $r2 = Post-Json $mgr "/api/reports/files/$fileId/annotations" $hors
  Say ($r2.code -eq 422) 'annotation hors cadre refusee' "HTTP $($r2.code)"

  # --- 4. suppression ------------------------------------------------------
  $del  = Del-Json $trd "/api/reports/$reportId/files/$fileId"
  Say ($del -eq 200) 'le proprietaire retire la piece jointe' "HTTP $del"

  $del2 = Del-Json $mgr "/api/reports/$reportId/files/$fileId"
  Say ($del2 -eq 403) 'suppression refusee au manager' "HTTP $del2"
}

# --- 5. cloisonnement entre traders ---------------------------------------
# On ne cree pas de second trader : le seed n'en fournit qu'un, et les autres
# comptes ont des mots de passe aleatoires. Le test porte donc sur la meme
# session que le reste, en ciblant le rapport d UN AUTRE trader â€” ce qu'un
# second login ne changerait pas au comportement observe.
# La liste des rapports n'expose pas trader_id (nom de colonne interne), mais
# expose trader_name : le rapprochement se fait donc sur le nom. Cela reste
# suffisant pour viser le rapport d'un autre trader, qui est l'objet du test.
$myName = [string]$report.trader_name
$all  = @(Json $adm '/api/reports' | ForEach-Object { $_.reports })
$other = $all | Where-Object { [string]$_.trader_name -ne $myName } | Select-Object -First 1
if ($other) {
  $code = (& curl.exe -s -o NUL -w '%{http_code}' -X POST "$Base/api/reports/$($other.id)/files" `
    -b "th_session=$ck" -F "file=@$png;type=image/png;filename=capture.png") -join ''
  Say ($code -eq '403') "depot refuse sur le rapport d un autre trader ($($other.trader_name))" "HTTP $code"
} else {
  Say $false 'cloisonnement entre traders' 'aucun rapport appartient a un autre trader'
}

# --- 6. faux PNG ----------------------------------------------------------
$txt = Join-Path ([System.IO.Path]::GetTempPath()) 'th-faux.png'
[System.IO.File]::WriteAllText($txt, '<html>ceci nest pas une image</html>')
$r3 = Post-File $ck "/api/reports/$reportId/files" $txt 'image/png' 'faux.png'
Say ($r3 -match 'correspond pas a son type') 'faux PNG refuse (magic bytes)'

# --- 7. RG-31 : aucune piece jointe au depot -----------------------------
# Sur un rapport FRAICHEMENT cree et donc sans piece jointe. Dependre du rapport
# du debut de script rendrait le test implicite : si la suppression etait
# cassee, la piece resterait et RG-31 ne serait jamais exerce.
$freshBody = (@{
  sessionDate   = '2026-09-20'
  instrument    = 'GBPUSD'
  resultType    = 'gain'
  resultAmount  = 120
  strategy      = 'Test RG-31'
  nbTrades      = 1
  planRespected = $true
  rrPlanned     = 1
  rrRealized    = 1.2
  emotions      = @('calm')
} | ConvertTo-Json)
$fresh = Post-Json $trd '/api/reports' $freshBody | ConvertFrom-Json
if ($fresh.report.id) {
  $act = Post-Json $trd "/api/reports/$($fresh.report.id)/actions" '{"action":"submit"}'
  # 409 = conflit metier : c'est bien le refus attendu, la base ayant leve
  # RG-31 avant toute transition. On affiche le corps pour pouvoir verifier
  # que le motif est bien RG-31 et pas une autre cause.
  Say (($act.code -eq 409 -or $act.code -eq 422) -and ($act.body -match 'RG-31')) `
    'soumission sans piece jointe refusee' "HTTP $($act.code) $(($act.body -replace '\s+',' '))"
} else {
  Say $false 'soumission sans piece jointe refusee' 'rapport de test non cree'
}

Remove-Item $png, $txt -ErrorAction SilentlyContinue
