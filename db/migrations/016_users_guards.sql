-- ============================================================================
-- trade_house - 016_users_guards.sql
-- Durcissement de l'ecriture sur public.users.
--
-- Constat (verifie sur la base, pas suppose) :
--   la politique users_update autorise l'UPDATE sur sa PROPRE ligne
--   (utilisateur = app.current_user_id() ou admin). Consequence mesuree, en
--   se connectant avec le role applicatif et en se placant dans le contexte
--   d'un trader :
--       update users set manager_id  = null   -> AUTORISE
--       update users set is_active   = true   -> AUTORISE
--       update users set password_hash = 'x'  -> AUTORISE
--   Seul role = 'admin' etait bloque, par une contrainte CHECK.
--
--   Autrement dit, la base laissait un trader modifier son propre mot de
--   passe (en contournant app.fn_password_meets_policy), se reactiver et
--   rompre son rattachement a son manager. RG-02 et RG-12 sont ecrits dans les
--   FONCTIONS, donc ils ne protegeaient que les chemins qui passent par elles.
--
-- Correctif : le role applicatif ne peut plus ecrire directement dans users.
-- Toutes les ecritures passent deja par des fonctions SECURITY DEFINER
-- (create_user, update_profile, set_password, deactivate_user, reactivate_user,
-- set_mfa_enforced, accept_invitation, create_session), qui s'executent avec
-- les droits du proprietaire et ne sont donc pas affectees.
--
-- La regle reste donc dans la base, mais au bon niveau : la politiqu RLS
-- exprime QUI, les droits de colonne expriment QUOI.
-- ============================================================================
\set ON_ERROR_STOP on

revoke update on public.users from trade_house_app;

comment on table public.users is
  'Ecriture interdite au role applicatif : passer par app.update_profile / '
  'app.set_password / app.deactivate_user / app.reactivate_user (SECURITY DEFINER).';
