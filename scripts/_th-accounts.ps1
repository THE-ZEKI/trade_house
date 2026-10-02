# Identifiants des controles d'ecran.
#
# Pourquoi une source unique : les scripts se connectent reellement, avec de
# vrais mots de passe. Les laisser en dur dans chaque fichier obligeait a
# maintenir le meme jeu d'essai a quatre endroits, et rendait impossible de
# viser une base qui n'a pas ces comptes - c'est le cas d'une base de
# PRODUCTION, ou aucun compte de developpement n'existe (et n doit exister).
#
# Un test qui echoue faute de comptespresents comme une panne de
# l'application, alors que l'application est parfaitement saine : c'est le
# pire des diagnostics, parce qu'il fait chercher un bug qui n'existe pas.
# Ici, un identifiant manquant est signale comme une configuration absente.
#
# Usage (PowerShell) :
#   $env:TH_ADMIN_EMAIL='vous@domaine'; $env:TH_ADMIN_PASSWORD='...'
#   $env:TH_MANAGER_EMAIL='...';        $env:TH_MANAGER_PASSWORD='...'
#   $env:TH_TRADER_EMAIL='...';         $env:TH_TRADER_PASSWORD='...'
#   .\scripts\check-pages.ps1
#
# Les mots de passe ne sont JAMAIS ecrits dans un fichier du depot : ils
# vivent dans l'environnement du poste qui teste. Les variables absentes
# gardent les valeurs du jeu 009_seed, uniquement parce que le
# developpement local en depend encore ; sur une base de production, il
# faut les definir explicitement.

function Get-THAccounts {
    $defauts = @(
        @{ role = 'admin';   var = 'TH_ADMIN';   email = 'admin@trade-house.local';   mdp = 'Admin!2345' },
        @{ role = 'manager'; var = 'TH_MANAGER'; email = 'manager@trade-house.local'; mdp = 'Manager!2345' },
        @{ role = 'trader';  var = 'TH_TRADER';  email = 'trader1@trade-house.local';  mdp = 'Trader!2345' }
    )

    $comptes = foreach ($d in $defauts) {
        $email = [Environment]::GetEnvironmentVariable($d.var + '_EMAIL')
        $mdp   = [Environment]::GetEnvironmentVariable($d.var + '_PASSWORD')
        # Un email fourni sans mot de passe reste tel quel : l'echec de
        # connexion sera alors nomme par le script appelant, pas devine ici.
        [pscustomobject]@{
            role      = $d.role
            var       = $d.var
            email     = $(if ($email) { $email } else { $d.email })
            mdp       = $(if ($email) { $mdp } else { $d.mdp })
            configure = [bool]$email
        }
    }
    return $comptes
}

# Signale une configuration absente. Deux situations, deux traitements :
#
#   - aucun identifiant fourni  -> on retombe sur le jeu 009. C'est normal en
#     developpement, et un avertissement suffit. Sur une base qui n'a pas ces
#     comptes (production), le script echouera plus loin avec un 401 : le
#     message ci-dessous doit alors etre lu AVANT les resultats, pas apres.
#   - certains fournis, d'autres non -> configuration incomplete. La, on sort :
#     melanger des comptes reels et des comptes d'essai produirait des
#     verdicts sans aucun sens (le RLS compare le role, pas l'origine).
function Assert-THAccounts($comptes, [string]$nomDuScript) {
    $configures = @($comptes | Where-Object { $_.configure })
    $manquants  = @($comptes | Where-Object { -not $_.configure })

    if ($configures.Count -eq 0) {
        Write-Host ''
        Write-Host "ATTENTION : identifiants par defaut (jeu 009_seed)." -ForegroundColor Yellow
        Write-Host "  $nomDuScript suppose des comptes de developpement existants." -ForegroundColor Yellow
        Write-Host '  Sur une base qui ne les a pas (production), chaque connexion' -ForegroundColor Yellow
        Write-Host '  renverra 401. Definissez TH_ADMIN_EMAIL, TH_MANAGER_EMAIL et' -ForegroundColor Yellow
        Write-Host '  TH_TRADER_EMAIL (avec les _PASSWORD correspondants) pour viser' -ForegroundColor Yellow
        Write-Host '  vos propres comptes.'
        return
    }

    if ($manquants.Count -gt 0) {
        Write-Host ''
        Write-Host "CONFIGURATION INCOMPLETE : $nomDuScript ne peut pas s'executer." -ForegroundColor Red
        foreach ($m in $manquants) {
            Write-Host ("  manquant : {0}  ->  `$env:{1}_EMAIL / `$env:{1}_PASSWORD" -f $m.role, $m.var) -ForegroundColor Cyan
        }
        Write-Host ''
        Write-Host '  Definir les trois roles, ou aucun : melanger comptes reels et' -ForegroundColor Yellow
        Write-Host '  comptes d essai ne donne aucun verdict exploitable.' -ForegroundColor Yellow
        exit 2
    }
}
