-- ============================================================================
-- trade_house - 032_notifications_accounts.sql
--
-- CE QUE LA RECHERCHE A REVELE, ET QUI CONTREDIT MON APPRICIATION PRECEDENTE.
--
-- J avais annonce que les reunions n etaient pas notifiees. C etait faux, et
-- la verification l a montre immediatement : create_meeting insere deja une
-- notification in_app par participant, et cancel_meeting comme
-- reschedule_meeting en inserent aussi. Les trois evenements de reunion
-- (meeting_created, meeting_cancelled, meeting_updated) sont donc cables
-- depuis le depart.
--
-- Je le note explicitement parce que ma premiere affirmation etait fausse, et
-- que la corriger evite de recreer des fonctions qui font deja ce qu on leur
-- demande. Tout ce qui suit porte sur les COMPTES.
--
-- Les trois evenements de compte (account_invited, account_disabled,
-- account_reactivated) sont declares depuis la migration 001 et n etaient
-- appeles par AUCUNE fonction. Un compte desactive ne prevenait personne : le
-- trader essayait de se connecter sans comprendre pourquoi, et l admin n avait
-- aucune trace dans la cloche.
--
-- DESTINATAIRES : les plus subtils du projet, et les trois cas ne se traitent
-- pas de la meme facon.
--
--   desactivation  -> le compte lui-meme, ET son manager s il en a un.
--     Le compte desactive ne peut plus se connecter : sa cloche est
--     inaccessible. Sans cet email, la seule maniere de comprendre la panne
--     est de contacter l admin, qui n a rien vu. Son manager, lui, garde son
--     acces et doit savoir pourquoi son trader a disparu de l equipe.
--
--   reactivation   -> le compte seul. Le manager n a pas besoin de savoir que
--     l admin a retabli une situation : rien n a change pour lui.
--
--   invitation     -> le compte invite. L email d invitation lui-meme part deja
--     par un autre chemin (issue_invitation puis sendEmail dans la route) ;
--     celui-ci est l ECHO in-app, visible des que le compte est actif.
-- ============================================================================
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Desactivation
--
-- L ordre compte : on desactive d'abord, on notifie ensuite. Le compte n a plus
-- acces a sa cloche, donc la notification doit existir AVANT qu il ne puisse
-- plus la lire : c est d autant plus vrai que l email part du job, qui lira
-- plus tard.
--
-- Le manager n est prevenu que s il existe. Sans cette condition,
-- notify_ids recevrait un null, qu il filtre deja, mais l intention reste
-- explicite.
-- ---------------------------------------------------------------------------
create or replace function app.deactivate_user(p_user_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_manager uuid;
begin
  if not app.is_admin() then
    raise exception 'RG-02 : seul l''admin peut desactiver un compte';
  end if;

  update public.users set is_active = false where id = p_user_id;
  update public.user_sessions set revoked_at = now()
   where user_id = p_user_id and revoked_at is null;

  perform app.fn_audit('user.deactivate', 'user', p_user_id, '{}'::jsonb);

  select manager_id into v_manager from public.users where id = p_user_id;

  perform app.notify_ids(
    array[p_user_id, v_manager],
    'account_disabled', 'user', p_user_id);
end $$;
-- ---------------------------------------------------------------------------
-- Reactivation : le compte seul, pas le manager.
--
-- Le manager n a pas besoin de savoir que l admin a retabli une situation :
-- rien n a change pour lui, et un correo de plus ne l aiderait pas.
-- ---------------------------------------------------------------------------
create or replace function app.reactivate_user(p_user_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.is_admin() then
    raise exception 'RG-02 : seul l''admin peut reactiver un compte';
  end if;
  update public.users set is_active = true where id = p_user_id;
  perform app.fn_audit('user.reactivate', 'user', p_user_id, '{}'::jsonb);

  perform app.notify_ids(array[p_user_id], 'account_reactivated', 'user', p_user_id);
end $$;

-- ---------------------------------------------------------------------------
-- Issue d une invitation : le compte invite est prevenu.
--
-- Fonction separee plutot qu un branchement dans app.issue_invitation, qui
-- sert aussi aux reinitialisations de mot de passe (purpose =
-- password_reset). Les deux usages n ont pas le meme evenement ni le meme
-- modele d email : brancher ici garde la distinction explicite.
--
-- Pas de notification pour l admin qui invite : c est son propre geste.
-- ---------------------------------------------------------------------------
create or replace function app.notify_account_invited(p_user_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.notify_ids(array[p_user_id], 'account_invited', 'user', p_user_id);
end $$;

grant execute on function app.notify_account_invited(uuid) to trade_house_app;
