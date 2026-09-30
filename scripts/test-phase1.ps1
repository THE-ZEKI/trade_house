#Requires -Version 5.1
<#
  trade_house · scripts/test-phase1.ps1
  Test de bout en bout de la phase 1 (authentification) sur le serveur de dev.

    .\scripts\test-phase1.ps1

  Le serveur doit tourner (npm run dev) et la base etre installee.
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
function Ok($label) { $script:ok++; Write-Host "  [ok] $label" }
function Ko($label) { $script:ko++; Write-Host "  [KO] $label" }
function Check($label, $condition) { if ($condition) { Ok $label } else { Ko $label } }

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
    return @{ Status = [int]$r.StatusCode; Json = ($r.Content | ConvertFrom-Json); Raw = $r.Content }
  } catch {
    $status = 0
    $raw = $null
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    # PowerShell 5.1 laisse parfois ErrorDetails vide : on relit le flux
    if ($_.ErrorDetails.Message) {
      $raw = $_.ErrorDetails.Message
    } elseif ($_.Exception.Response) {
      try {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $raw = $reader.ReadToEnd()
        $reader.Close()
      } catch { }
    }
    $body = $null
    if ($raw) { try { $body = $raw | ConvertFrom-Json } catch { $body = $raw } }
    return @{ Status = $status; Json = $body; Raw = $raw }
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

function NewSession { return New-Object Microsoft.PowerShell.Commands.WebRequestSession }

Write-Host 'Trade House - test de la phase 1 (authentification)' -ForegroundColor Cyan
$email = 'test.phase1@trade-house.local'

# --------------------------------------------------------------------------
Step '1. Connexion (A1)'
$s = NewSession
$r = Api '/api/auth/login' 'POST' @{ email = 'admin@trade-house.local'; password = 'Admin!2345' } $s
Check 'admin se connecte (200)' ($r.Status -eq 200 -and $r.Json.status -eq 'authenticated')
Check 'role renvoye = admin' ($r.Json.user.role -eq 'admin')
$r = Api '/api/auth/login' 'POST' @{ email = 'admin@trade-house.local'; password = 'faux' }
Check 'mot de passe errone refuse (401)' ($r.Status -eq 401)
$r = Api '/api/auth/login' 'POST' @{ email = 'inconnu@x.local'; password = 'Admin!2345' }
Check 'email inconnu refuse (401)' ($r.Status -eq 401)

# --------------------------------------------------------------------------
Step '2. Protection des routes'
$r = Api '/api/auth/me'
Check '/api/auth/me sans cookie -> 401' ($r.Status -eq 401)
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
$r2 = Api '/api/auth/invitation' 'POST' @{ email = $email; fullName = 'Trader Phase 1'; role = 'trader'; managerId = $managerId } $s
Check 'email en doublon refuse (409)' ($r2.Status -eq 409)
$active = Sql "select count(*) from user_invitations where user_id=(select id from users where email='$email') and consumed_at is null and revoked_at is null"
Check 'RG-05 : un seul lien actif apres renvoi' ($active -eq '1')

# --------------------------------------------------------------------------
Step '4. Activation du compte (RG-05, RG-65, RG-60)'
$r = Api '/api/auth/accept-invitation' 'POST' @{ token = $token; password = 'faible' }
Check 'mot de passe faible refuse (422, RG-65)' ($r.Status -eq 422 -and $r.Json.error.rule -eq 'RG-65')
$sNew = NewSession
$r = Api '/api/auth/accept-invitation' 'POST' @{ token = $token; password = 'Phase1!2026' } $sNew
Check 'activation acceptee (200)' ($r.Status -eq 200 -and $r.Json.status -eq 'activated')
$stored = Sql "select password_hash from users where email='$email'"
Check 'RG-60 : mot de passe hache en base' ($stored -notlike '*Phase1*')
$expiry = Sql "select coalesce(invite_expires_at::text,'') from users where email='$email'"
Check 'RG-05 : invitation consommee' ($expiry -eq '')
$r = Api '/api/auth/login' 'POST' @{ email = $email; password = 'Phase1!2026' } $sNew
Check 'le nouveau compte peut se connecter' ($r.Status -eq 200)

# --------------------------------------------------------------------------
Step '5. Reinitialisation du mot de passe (A1)'
$r = Api '/api/auth/password/forgot' 'POST' @{ email = $email }
Check 'demande acceptee (200)' ($r.Status -eq 200)
$resetToken = $r.Json.devToken
Check 'jeton de reinitialisation fourni en dev' ([bool]$resetToken)
$r = Api '/api/auth/password/forgot' 'POST' @{ email = 'inconnu@x.local' }
Check 'email inconnu : meme reponse (pas d enumeration)' ($r.Status -eq 200 -and $r.Json.status -eq 'sent')
$r = Api '/api/auth/password/reset' 'POST' @{ token = $resetToken; password = 'Phase2!2026' }
Check 'mot de passe reinitialise (200)' ($r.Status -eq 200)
$left = Sql "select count(*) from user_sessions s join users u on u.id=s.user_id where u.email='$email' and s.revoked_at is null"
Check 'toutes les sessions revoquees apres changement' ($left -eq '0')
$r = Api '/api/auth/login' 'POST' @{ email = $email; password = 'Phase1!2026' }
Check 'ancien mot de passe refuse' ($r.Status -eq 401)
$s2 = NewSession
$r = Api '/api/auth/login' 'POST' @{ email = $email; password = 'Phase2!2026' } $s2
Check 'nouveau mot de passe accepte' ($r.Status -eq 200)

# --------------------------------------------------------------------------
Step '6. Double authentification (A5)'
$r = Api '/api/auth/mfa/setup' 'POST' $null $s2
Check 'secret TOTP genere (200)' ($r.Status -eq 200)
$secret = $r.Json.secret
Check 'secret en base32 de 32 caracteres' ($secret.Length -eq 32)
Check 'URL otpauth generee' ($r.Json.otpauthUrl -like 'otpauth://totp/*')
$encrypted = Sql "select encode(secret,'hex') from mfa_factors where user_id=(select id from users where email='$email') and confirmed_at is null"
Check 'le secret stocke est chiffre' ($encrypted.Length -gt 40)
$r = Api '/api/auth/mfa/confirm' 'POST' @{ code = '000000' } $s2
Check 'mauvais code de confirmation refuse (401)' ($r.Status -eq 401)
$r = Api '/api/auth/mfa/confirm' 'POST' @{ code = (Totp $secret) } $s2
Check 'confirmation acceptee (200)' ($r.Status -eq 200)
$backup = $r.Json.backupCodes
Check '10 codes de secours generes' ($backup.Count -eq 10)
$remaining = Sql "select app.backup_codes_remaining((select id from users where email='$email'))"
Check '10 codes de secours stockes' ($remaining -eq '10')
$plainInDb = Sql "select count(*) from mfa_backup_codes where code_hash = '$($backup[0])'"
Check 'code de secours en clair absent de la base' ($plainInDb -eq '0')

# --------------------------------------------------------------------------
Step '7. Connexion avec 2FA'
$r = Api '/api/auth/login' 'POST' @{ email = $email; password = 'Phase2!2026' }
Check 'mot de passe correct mais 2FA exigee' ($r.Status -eq 200 -and $r.Json.status -eq 'mfa_challenge_required')
$r = Api '/api/auth/mfa/challenge' 'POST' @{ email = $email; code = '000000' }
Check 'mauvais code TOTP refuse (401)' ($r.Status -eq 401)
$s3 = NewSession
$r = Api '/api/auth/mfa/challenge' 'POST' @{ email = $email; code = (Totp $secret) } $s3
Check 'code TOTP valide -> session (200)' ($r.Status -eq 200 -and $r.Json.status -eq 'authenticated')
$me = Api '/api/auth/me' 'GET' $null $s3
Check 'session 2FA operationnelle' ($me.Status -eq 200 -and $me.Json.user.email -eq $email)
$s4 = NewSession
$r = Api '/api/auth/mfa/challenge' 'POST' @{ email = $email; code = $backup[0] } $s4
Check 'code de secours accepte' ($r.Status -eq 200 -and $r.Json.usedBackupCode -eq $true)
Check 'code a usage unique (9 restants)' ($r.Json.backupCodesRemaining -eq 9)
$r = Api '/api/auth/mfa/challenge' 'POST' @{ email = $email; code = $backup[0] } $s4
Check 'le meme code de secours est refuse une 2e fois' ($r.Status -eq 401)

# --------------------------------------------------------------------------
Step '8. Obligation 2FA et desactivation'
$userId = Sql "select id from users where email='$email'"
$r = Api '/api/auth/mfa/enforce' 'POST' @{ userId = $userId; enabled = $true } $s
Check 'admin peut rendre la 2FA obligatoire' ($r.Status -eq 200)
Check 'mfa_enforced = true en base' ((Sql "select mfa_enforced from users where email='$email'") -eq 't')
$r = Api '/api/auth/mfa/enforce' 'POST' @{ userId = $userId; enabled = $false } $s2
Check 'un trader ne peut pas le faire (403)' ($r.Status -eq 403)
$r = Api '/api/auth/mfa' 'DELETE' @{ password = 'mauvais' } $s3
Check 'desactivation refusee sans le bon mot de passe' ($r.Status -eq 401)
$r = Api '/api/auth/mfa' 'DELETE' @{ password = 'Phase2!2026' } $s3
Check 'desactivation confirmee (200)' ($r.Status -eq 200)
Check 'mfa_enrolled = false en base' ((Sql "select mfa_enrolled from users where email='$email'") -eq 'f')

# --------------------------------------------------------------------------
Step '9. Deconnexion et journal'
$r = Api '/api/auth/logout' 'POST' $null $s3
Check 'deconnexion (200)' ($r.Status -eq 200)
$revoked = Sql "select count(*) from user_sessions s join users u on u.id=s.user_id where u.email='$email' and s.revoked_at is not null"
Check 'session revoquee en base' ([int]$revoked -ge 1)
$audit = Sql "select count(*) from audit_log where action in ('user.login','user.logout','user.mfa_enrolled','user.mfa_disabled')"
Check 'journal d audit alimente (RG-63)' ([int]$audit -ge 2)

Step 'Nettoyage'
Sql "delete from users where email='$email'" | Out-Null
Check 'compte de test supprime' ((Sql "select count(*) from users where email='$email'") -eq '0')

Write-Host ''
Write-Host ("Assertions reussies : {0}" -f $script:ok)
if ($script:ko -gt 0) {
  Write-Host ("ECHEC : {0} anomalie(s)" -f $script:ko) -ForegroundColor Red
  exit 1
}
Write-Host 'SUCCES : phase 1 validee de bout en bout.' -ForegroundColor Green

