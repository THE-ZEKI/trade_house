<#
  trade_house · generate-neon-sql.ps1

  Produit db/deploy/neon-install.sql : les migrations concatenees en un seul
  fichier, pretes a etre collees dans l editeur SQL de Neon.

  Pourquoi un fichier genere plutot qu une liste a jouer a la main :

  Neon n execute que du SQL, sans psql. Les migrations contiennent des
  commandes meta (\set, \i, \echo) et un ordre strict ; les jouer une par une
  dans le navigateur est long et, en cas d erreur, on ne sait plus ou l on en
  est. Un fichier unique est atomique cote Neon et relisible d un coup d oeil.

  Deux differences avec db/install.sql, et elles sont voulues :

    - les COMMANDES META de psql sont retirees : Neon les refuse en erreur de
      syntaxe ;
    - les COMPTES DE DEVELOPPEMENT de 009_seed.sql sont retires. Leurs mots de
      passe (Admin!2345, Manager!2345...) sont publics dans le depot : les
      installer en production donnerait un administrateur a quiconque se
      connecte. Le premier administrateur se cree avec app.bootstrap_admin,
      dont l appel est rappele en fin de fichier.

  On NE touche pas a db/supabase_compat.sql : ce projet gere lui-meme ses
  comptes et pose l identite avec app.set_user(). Voir l en-tete du fichier
  genere.

      .\db\tools\generate-neon-sql.ps1
#>
[CmdletBinding()]
param(
    # Vide par defaut : le dossier de sortie est calcule dans le corps du
    # script. $PSScriptRoot n est pas fiable dans la valeur par defaut d un
    # parametre (il est vide au moment de l evaluation), d ou le calcul ici.
    [string]$OutDir = ''
)

$ErrorActionPreference = 'Stop'

$dbDir = Split-Path $PSScriptRoot -Parent
if (-not $OutDir) { $OutDir = Join-Path $dbDir 'deploy' }

$migDir = Join-Path $dbDir 'migrations'
if (-not (Test-Path $migDir)) { throw "dossier de migrations introuvable : $migDir" }

$files = Get-ChildItem $migDir -Filter '*.sql' | Sort-Object Name
if ($files.Count -eq 0) { throw 'aucune migration trouvee' }

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }
$dest = Join-Path $OutDir 'neon-install.sql'

$header = @'
-- ============================================================================
-- trade_house - neon-install.sql
-- INSTALLATION COMPLETE POUR UN PROJET NEON
-- ============================================================================
--
-- GENERE par db/tools/generate-neon-sql.ps1 depuis db/migrations/.
-- Ne pas editer a la main : ajouter une migration sans regenerer ce fichier
-- deployerait une base incomplete.
--
-- A coller dans l editeur SQL de Neon (Dashboard > SQL Editor > New query).
--
-- CE QUE CE FICHIER CONTIENT
--   - les migrations, dans l ordre, sans les commandes meta de psql
--     (\set, \i, \echo) que Neon n accepte pas ;
--   - les parametres globaux (app_settings), indispensables au fonctionnement ;
--   - le role applicatif trade_house_app, NON proprietaire.
--
-- CE QU IL NE CONTIENT PAS, ET POURQUOI
--   - les comptes de developpement de 009_seed.sql. Ils ont des mots de passe
--     connus (Admin!2345, Manager!2345...), publics dans le depot : les
--     laisser en production donnerait a quiconque se connecte un
--     administrateur. Sur une base neuve, aucun compte n est cree : c est
--     app.bootstrap_admin qui fabrique le premier administrateur.
--
-- NE PAS APPLIQUER db/supabase_compat.sql
--   Ce fichier bascule app.current_user_id() sur auth.uid(), l identite
--   Supabase. Ce projet gere LUI-MEME ses comptes, sessions et 2FA, et pose
--   l identite avec app.set_user() a chaque requete (src/lib/db.ts). Avec
--   auth.uid(), qui renvoie toujours NULL hors session Supabase, le RLS
--   laisserait passer zero ligne et toutes les pages seraient vides.
--
-- ============================================================================

'@
$footer = @'

-- ============================================================================
-- ETAPES SUIVANTES, DANS L EDITEUR SQL
-- ============================================================================
--
-- 1. DEFINIR LE MOT DE PASSE DU ROLE APPLICATIF
--
--    A FAIRE ABSOLUMENT : sans cela, l application ne peut pas se connecter.
--    Remplace le mot de passe ci-dessous par une valeur forte et unique.
--    C est le SEUL mot de passe a choisir : tout le reste est genere.
--
-- alter role trade_house_app login password 'CHANGEZ-MOI-avant-de-coller';
--
-- 2. CREER LE PREMIER ADMINISTRATEUR
--
--    app.create_user exige un administrateur (RG-02) : sans lui, personne ne
--    peut creer le premier compte. On appelle donc directement le bootstrap.
--    Remplace l adresse ci-dessous par la tienne.
--
--    select app.bootstrap_admin('admin@votre-domaine.fr'::citext, 'Administrateur'::varchar);
--
--    Le compte cree n a PAS de mot de passe : passer par « mot de passe
--    oublie » a la premiere connexion pour en definir un et activer le 2FA.
--
-- 3. VERIFIER QUE LA SECURITE EST EFFECTIVE
--
--    Cette requete doit renvoyer false | false. Si l une des deux est true,
--    le role contourne le RLS et toute la separation des roles du projet
--    (un trader qui ne voit que ses donnees, un manager que son equipe)
--    disparait SANS LA MOINDRE ERREUR VISIBLE.
--
--    select rolname, rolsuper, rolbypassrls from pg_roles where rolname = 'trade_house_app';
--
-- 4. CONTROLE FINAL, une fois l application deployee et ses variables posees :
--
--    curl https://<ton-domaine>/api/health
--    -> attendu : { "status": "ok", "rls": { "effective": true } }
--
-- ============================================================================
$parts = New-Object System.Collections.Generic.List[string]
foreach ($f in $files) {
    $raw = [IO.File]::ReadAllText($f.FullName)
    $body = (($raw -split "`r?`n") |
             Where-Object { $_ -notmatch '^\s*\\(set|echo|timing|i|pset|connect)\b' }) -join "`r`n"

    # 009_seed.sql : retirer le bloc `do $$ ... $$` qui cree les comptes d essai,
    # en conservant l insertion dans app_settings et la creation du role.
    if ($f.BaseName -eq '009_seed.sql') {
        $start = $body.IndexOf('do $$')
        if ($start -ge 0) {
            $end = $body.IndexOf('$$;', $start)
            if ($end -gt $start) {
                $body = $body.Remove($start, ($end + 3) - $start).TrimEnd()
            }
        }
    }

    $sep = '-- -----------------------------------------------------------------------------' + "`r`n" +
           "-- $($f.Name)" + "`r`n" +
           '-- -----------------------------------------------------------------------------'
    $parts.Add($sep + "`r`n" + $body)
}

[IO.File]::WriteAllText($dest, $header + ($parts -join "`r`n`r`n") + $footer,
                        (New-Object System.Text.UTF8Encoding($false)))

# Controle : aucun mot de passe d essai ne doit subsister dans le fichier
# produit. C est la seule verif qui compte vraiment ici, car le fichier est
# destine a etre colle dans une base de production.
$leftovers = Select-String -Path $dest -Pattern 'Admin!2345|Manager!2345|Trader!2345'
if ($leftovers) {
    throw 'comptes de developpement encore presents dans le fichier genere'
}

Write-Host "neon-install.sql regenere : $($files.Count) migrations, $((Get-Item $dest).Length) octets"
Write-Host "  $($files[0].Name) .. $($files[-1].Name)"
'@
$migDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'migrations'
if (-not (Test-Path $migDir)) { throw "dossier de migrations introuvable : $migDir" }

$files = Get-ChildItem $migDir -Filter '*.sql' | Sort-Object Name
if ($files.Count -eq 0) { throw 'aucune migration trouvee' }

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }
$dest = Join-Path $OutDir 'neon-install.sql'