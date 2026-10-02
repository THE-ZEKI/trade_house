param([string]$Base = 'http://127.0.0.1:3000')
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot '_th-accounts.ps1')

function Login($email, $password) {
  $s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $b = @{ email = $email; password = $password } | ConvertTo-Json
  Invoke-WebRequest -Uri "$Base/api/auth/login" -Method POST -Body $b -ContentType 'application/json' -WebSession $s -UseBasicParsing -TimeoutSec 20 | Out-Null
  return $s
}
function Check($s, $role, $path, $libelle, $attendu) {
  $html = (Invoke-WebRequest -Uri "$Base$path" -WebSession $s -UseBasicParsing -TimeoutSec 40).Content
  $trouve = $html.Contains($libelle)
  $ok = if ($trouve -eq $attendu) { 'ok   ' } else { 'ECHEC' }
  $sens = if ($attendu) { 'doit contenir  ' } else { 'ne doit PAS con.' }
  "{0} {1,-8} {2,-10} {3}" -f $ok, $role, $path, ($libelle + ' | ' + $sens)
}

$ACCT = Get-THAccounts
Assert-THAccounts $ACCT 'check-actions'

$a   = $ACCT | Where-Object { $_.role -eq 'admin' }
$m   = $ACCT | Where-Object { $_.role -eq 'manager' }
$t   = $ACCT | Where-Object { $_.role -eq 'trader' }
$admin = Login $a.email $a.mdp
$mgr   = Login $m.email $m.mdp
$trd   = Login $t.email $t.mdp

Check $admin 'admin'   '/users'    '>Inviter<'             $true
Check $mgr   'manager' '/users'    '>Inviter<'             $false
Check $trd   'trader'  '/users'    '>Inviter<'             $false
Check $admin   'admin'   '/meetings' 'Planifier une reunion'  $true
Check $mgr     'manager' '/meetings' 'Planifier une reunion'  $true
Check $trd     'trader'  '/meetings' 'Planifier une reunion'  $false