#Requires -Version 5.1
<#
  trade_house - scripts/test-phase1.ps1
  Test de bout en bout de la phase 1 (authentification + durcissement).

    .\scripts\test-phase1.ps1

  Prerequis : le serveur tourne (npm run dev) et la base est installee.
#>
param(
  [string]$BaseUrl = 'http://localhost:3000',
  [string]$Psql    = 'C:\Program Files\PostgreSQL\18\bin\psql.exe',
  [string]$DbUser  = 'postgres',
  [string]$DbHost  = 'localhost',
  [string]$DbName  = 'trade_house',
  [string]$DbPass  = $env:PGPASSWORD
)

$ErrorActionPreference = 'Stop'
$script:ok = 0
$script:ko = 0

function Step($label) { Write-Host ''; Write-Host "== $label" }
function Check($label, $condition) {
  if ($condition) { $script:ok++; Write-Host "  [ok] $label" }
  else { $script:ko++; Write-Host "  [KO] $label" }
}

function NewSession { return New-Object Microsoft.PowerShell.Commands.WebRequestSession }

function Api {
  param([string]$Path, [string]$Method = 'GET', $Body = $null, $Session = $null)
  $params = @{
    Uri             = "$BaseUrl$Path"
    Method          = $Method
    UseBasicParsing = $true
    TimeoutSec      = 30
    ErrorAction     = 'Stop'
  }
  if ($Body) {
    $params.Body = ($Body | ConvertTo-Json -Depth 5)
    $params.ContentType = 'application/json'
  }
  if ($Session) { $params.WebSession = $Session }

  try {
    $r = Invoke-WebRequest @params
    return @{ Status = [int]$r.StatusCode; Json = ($r.Content | ConvertFrom-Json) }
  } catch {
    $status = 0
    $raw = $null
    $response = $_.Exception.Response
    if ($response) { $status = [int]$response.StatusCode }
    if ($_.ErrorDetails.Message) {
      $raw = $_.ErrorDetails.Message
    } elseif ($response) {
      try {
        $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
        $raw = $reader.ReadToEnd()
        $reader.Dispose()
      } catch { }
    }
    # sans cette fermeture, la requete suivante sur la meme session resterait
    # bloquee indefiniment : la connexion HTTP n'est jamais rendue
    if ($response) { try { $response.Close() } catch { } }
    $parsed = $null
    if ($raw) { try { $parsed = $raw | ConvertFrom-Json } catch { $parsed = $raw } }
    return @{ Status = $status; Json = $parsed }
  }
}

function Sql([string]$q) {
  $env:PGPASSWORD = $DbPass
  $out = & $Psql -U $DbUser -h $DbHost -d $DbName -tAc $q
  return ($out | Out-String).Trim()
}

function Totp([string]$secret) {
  $out = node -e "const {currentCode}=require('./.tmp-totp/totp.js');console.log(currentCode(process.argv[1]));" $secret
  return ($out | Out-String).Trim()
}

Write-Host 'Trade House - test de la phase 1 (authentification)' -ForegroundColor Cyan
$email = 'test.phase1@trade-house.local'

# --------------------------------------------------------------------------
Step '1. Connexion (A1)'
$s = NewSession
$r = Api '/api/auth/login' 'POST' @{ email = 'admin@trade-house.local'; password = 'Admin!2345' } $s
Check 'admin se connecte (200)' ($r.Status -eq 200 -and $r.Json.status -eq 'authenticated')
Check 'role renvoye = admin' ($r.Json.user.role -eq 'admin')
Check 'mot de passe errone refuse (401)' ((Api '/api/auth/login' 'POST' @{ email = 'admin@trade-house.local'; password = 'faux' }).Status -eq 401)
Check 'email inconnu refuse (401)' ((Api '/api/auth/login' 'POST' @{ email = 'inconnu@x.local'; password = 'Admin!2345' }).Status -eq 401)

# --------------------------------------------------------------------------
Step '2. Protection des routes'
Check '/api/auth/me sans cookie -> 401' ((Api '/api/auth/me').Status -eq 401)
$r = Api '/api/auth/me' 'GET' $null $s
Check '/api/auth/me avec cookie -> utilisateur' ($r.Status -eq 200 -and $r.Json.user.email -eq 'admin@trade-house.local')

# --------------------------------------------------------------------------
Step '3. Invitation (A2, RG-05)'
$managerId = Sql "select id from users where email='manager@trade-house.local'"
Sql "delete from users where email='$email'" | Out-Null
$r = Api '/api/auth/invitation' 'POST' @{ email = $email; fullName = 'Trader Phase 1'; role = 'trader'; managerId = $managerId } $s
Check 'invitation creee (201)' ($r.Status -eq 201)
$token = $r.Json.devToken
Check 'jeton renvoye en developpement' ([bool]$token)
Check 'email en doublon refuse (409)' ((Api '/api/auth/invitation' 'POST' @{ email = $email; fullName = 'Doublon'; role = 'trader'; managerId = $managerId } $s).Status -eq 409)
$active = Sql "select count(*) from user_invitations where user_id=(select id from users where email='$email') and consumed_at is null and revoked_at is null"
Check 'RG-05 : un seul lien actif apres renvoi' ($active -eq '1')

# --------------------------------------------------------------------------
Step '4. Activation du compte (RG-05, RG-65, RG-60)'
$r = Api '/api/auth/accept-invitation' 'POST' @{ token = $token; password = 'faible' }
Check 'mot de passe faible refuse (422, RG-65)' ($r.Status -eq 422 -and $r.Json.error.rule -eq 'RG-65')
$sNew = NewSession
$r = Api '/api/auth/accept-invitation' 'POST' @{ token = $token; password = 'Phase1!2026' } $sNew
Check 'activation acceptee (200)' ($r.Status -eq 200 -and $r.Json.status -eq 'activated')
Check 'RG-60 : mot de passe hache en base' ((Sql "select password_hash from users where email='$email'") -notlike '*Phase1*')
Check 'RG-05 : invitation consommee' ((Sql "select coalesce(invite_expires_at::text,'') from users where email='$email'") -eq '')
Check 'le nouveau compte peut se connecter' ((Api '/api/auth/login' 'POST' @{ email = $email; password = 'Phase1!2026' }).Status -eq 200)

# --------------------------------------------------------------------------
Step '5. Reinitialisation du mot de passe (A1)'
$r = Api '/api/auth/password/forgot' 'POST' @{ email = $email }
Check 'demande acceptee (200)' ($r.Status -eq 200)
$resetToken = $r.Json.devToken
Check 'jeton de reinitialisation fourni en dev' ([bool]$resetToken)
$r = Api '/api/auth/password/forgot' 'POST' @{ email = 'inconnu@x.local' }
Check 'email inconnu : meme reponse (pas d enumeration)' ($r.Status -eq 200 -and $r.Json.status -eq 'sent')
Check 'mot de passe reinitialise (200)' ((Api '/api/auth/password/reset' 'POST' @{ token = $resetToken; password = 'Phase2!2026' }).Status -eq 200)
Check 'toutes les sessions revoquees apres changement' ((Sql "select count(*) from user_sessions s join users u on u.id=s.user_id where u.email='$email' and s.revoked_at is null") -eq '0')
Check 'ancien mot de passe refuse' ((Api '/api/auth/login' 'POST' @{ email = $email; password = 'Phase1!2026' }).Status -eq 401)
$s2 = NewSession
Check 'nouveau mot de passe accepte' ((Api '/api/auth/login' 'POST' @{ email = $email; password = 'Phase2!2026' } $s2).Status -eq 200)

# --------------------------------------------------------------------------
Step '6. Double authentification (A5)'
$r = Api '/api/auth/mfa/setup' 'POST' $null $s2
Check 'secret TOTP genere (200)' ($r.Status -eq 200)
$secret = $r.Json.secret
Check 'secret en base32 de 32 caracteres' ($secret.Length -eq 32)
Check 'URL otpauth generee' ($r.Json.otpauthUrl -like 'otpauth://totp/*')
$enc = Sql "select encode(secret,'hex') from mfa_factors where user_id=(select id from users where email='$email') and confirmed_at is null"
Check 'le secret stocke est chiffre' ($enc.Length -gt 40)
Check 'mauvais code de confirmation refuse (401)' ((Api '/api/auth/mfa/confirm' 'POST' @{ code = '000000' } $s2).Status -eq 401)
$r = Api '/api/auth/mfa/confirm' 'POST' @{ code = (Totp $secret) } $s2
Check 'confirmation acceptee (200)' ($r.Status -eq 200)
$backup = $r.Json.backupCodes
Check '10 codes de secours generes' ($backup.Count -eq 10)
Check '10 codes de secours stockes' ((Sql "select app.backup_codes_remaining((select id from users where email='$email'))") -eq '10')
Check 'code de secours en clair absent de la base' ((Sql "select count(*) from mfa_backup_codes where code_hash = '$($backup[0])'") -eq '0')

# --------------------------------------------------------------------------
Step '7. Connexion avec 2FA'
Check 'mot de passe correct mais 2FA exigee' ((Api '/api/auth/login' 'POST' @{ email = $email; password = 'Phase2!2026' }).Json.status -eq 'mfa_challenge_required')
Check 'mauvais code TOTP refuse (401)' ((Api '/api/auth/mfa/challenge' 'POST' @{ email = $email; code = '000000' }).Status -eq 401)
$s3 = NewSession
$r = Api '/api/auth/mfa/challenge' 'POST' @{ email = $email; code = (Totp $secret) } $s3
Check 'code TOTP valide -> session (200)' ($r.Status -eq 200 -and $r.Json.status -eq 'authenticated')
$r = Api '/api/auth/me' 'GET' $null $s3
Check 'session 2FA operationnelle' ($r.Status -eq 200 -and $r.Json.user.email -eq $email)
$s4 = NewSession
$r = Api '/api/auth/mfa/challenge' 'POST' @{ email = $email; code = $backup[0] } $s4
Check 'code de secours accepte' ($r.Status -eq 200 -and $r.Json.usedBackupCode -eq $true)
Check 'code a usage unique (9 restants)' ($r.Json.backupCodesRemaining -eq 9)
Check 'le meme code de secours est refuse une 2e fois' ((Api '/api/auth/mfa/challenge' 'POST' @{ email = $email; code = $backup[0] }).Status -eq 401)

# --------------------------------------------------------------------------
Step '8. Obligation 2FA et desactivation'
$userId = Sql "select id from users where email='$email'"
Check 'admin peut rendre la 2FA obligatoire' ((Api '/api/auth/mfa/enforce' 'POST' @{ userId = $userId; enabled = $true } $s).Status -eq 200)
Check 'mfa_enforced = true en base' ((Sql "select mfa_enforced from users where email='$email'") -eq 't')
Check 'un trader ne peut pas le faire (403)' ((Api '/api/auth/mfa/enforce' 'POST' @{ userId = $userId; enabled = $false } $s2).Status -eq 403)
Check 'desactivation refusee sans le bon mot de passe' ((Api '/api/auth/mfa' 'DELETE' @{ password = 'mauvais' } $s3).Status -eq 401)
Check 'desactivation confirmee (200)' ((Api '/api/auth/mfa' 'DELETE' @{ password = 'Phase2!2026' } $s3).Status -eq 200)
Check 'mfa_enrolled = false en base' ((Sql "select mfa_enrolled from users where email='$email'") -eq 'f')

# --------------------------------------------------------------------------
Step '9. Deconnexion et journal'
Check 'deconnexion (200)' ((Api '/api/auth/logout' 'POST' $null $s3).Status -eq 200)
Check 'session revoquee en base' ([int](Sql "select count(*) from user_sessions s join users u on u.id=s.user_id where u.email='$email' and s.revoked_at is not null") -ge 1)
Check 'journal d audit alimente (RG-63)' ([int](Sql "select count(*) from audit_log where action in ('user.login','user.logout','user.mfa_enrolled','user.mfa_disabled')") -ge 2)

# --------------------------------------------------------------------------
Step '10. Durcissement (012_security)'
# 10.1 Blocage apres trop de tentatives
$victim = 'bruteforce@trade-house.local'
Sql "delete from users where email='$victim'" | Out-Null
Api '/api/auth/invitation' 'POST' @{ email = $victim; fullName = 'Cible'; role = 'trader'; managerId = $managerId } $s | Out-Null
$tok = (Api '/api/auth/password/forgot' 'POST' @{ email = $victim }).Json.devToken
Api '/api/auth/accept-invitation' 'POST' @{ token = $tok; password = 'Cible!2026' } (NewSession) | Out-Null
$first = (Api '/api/auth/login' 'POST' @{ email = $victim; password = 'faux' }).Status
Check 'tentative errone refusee (401)' ($first -eq 401)
for ($i = 0; $i -lt 5; $i++) { Api '/api/auth/login' 'POST' @{ email = $victim; password = "essai$i" } | Out-Null }
$blocked = Api '/api/auth/login' 'POST' @{ email = $victim; password = 'Cible!2026' }
Check 'blocage 429, meme avec le bon mot de passe' ($blocked.Status -eq 429)
Check 'les echecs sont journalises' ([int](Sql "select count(*) from login_attempts where email='$victim' and not success") -ge 5)
Sql "delete from login_attempts where email='$victim'" | Out-Null

# 10.2 Rejeu d'un code TOTP
$replay = 'rejeu@trade-house.local'
Sql "delete from users where email='$replay'" | Out-Null
Api '/api/auth/invitation' 'POST' @{ email = $replay; fullName = 'Rejeu'; role = 'trader'; managerId = $managerId } $s | Out-Null
$tok = (Api '/api/auth/password/forgot' 'POST' @{ email = $replay }).Json.devToken
$sRep = NewSession
Api '/api/auth/accept-invitation' 'POST' @{ token = $tok; password = 'Rejeu!2026' } $sRep | Out-Null
$sec2 = (Api '/api/auth/mfa/setup' 'POST' $null $sRep).Json.secret
$bk2 = (Api '/api/auth/mfa/confirm' 'POST' @{ code = (Totp $sec2) } $sRep).Json.backupCodes
$codeNow = Totp $sec2
Check 'premier usage du code TOTP accepte' ((Api '/api/auth/mfa/challenge' 'POST' @{ email = $replay; code = $codeNow }).Status -eq 200)
Check 'rejeu du meme code refuse (401)' ((Api '/api/auth/mfa/challenge' 'POST' @{ email = $replay; code = $codeNow }).Status -eq 401)
Check 'le code de secours suivant fonctionne' ((Api '/api/auth/mfa/challenge' 'POST' @{ email = $replay; code = $bk2[1] }).Status -eq 200)
Sql "delete from login_attempts where email='$replay'" | Out-Null

# 10.3 Changer son mot de passe exige le mot de passe actuel
$sCh = NewSession
Api '/api/auth/login' 'POST' @{ email = 'trader2@trade-house.local'; password = 'Trader!2345' } $sCh | Out-Null
$r = Api '/api/auth/password/change' 'POST' @{ newPassword = 'Autre!2026' } $sCh
Check 'changement refuse sans mot de passe actuel' ($r.Status -eq 401 -or $r.Status -eq 422)
Check 'changement accepte avec le mot de passe actuel' ((Api '/api/auth/password/change' 'POST' @{ currentPassword = 'Trader!2345'; newPassword = 'Autre!2026' } $sCh).Status -eq 200)
# controle AVANT toute nouvelle connexion : la session precedente doit etre tombee
Check 'session precedente revoquee' ((Sql "select count(*) from user_sessions s join users u on u.id=s.user_id where u.email='trader2@trade-house.local' and s.revoked_at is null") -eq '0')
Check 'nouveau mot de passe actif' ((Api '/api/auth/login' 'POST' @{ email = 'trader2@trade-house.local'; password = 'Autre!2026' }).Status -eq 200)
Sql "update users set password_hash = crypt('Trader!2345', gen_salt('bf')) where email='trader2@trade-house.local'" | Out-Null

# --------------------------------------------------------------------------
Step 'Nettoyage'
Sql "delete from users where email in ('$email','$victim','$replay')" | Out-Null
Check 'comptes de test supprimes' ((Sql "select count(*) from users where email in ('$email','$victim','$replay')") -eq '0')
Check 'le compte admin est intact' ((Sql "select count(*) from users where email='admin@trade-house.local' and is_active") -eq '1')

Write-Host ''
Write-Host ("Assertions reussies : {0}" -f $script:ok)
if ($script:ko -gt 0) {
  Write-Host ("ECHEC : {0} anomalie(s)" -f $script:ko) -ForegroundColor Red
  exit 1
}
Write-Host 'SUCCES : phase 1 validee de bout en bout.' -ForegroundColor Green


