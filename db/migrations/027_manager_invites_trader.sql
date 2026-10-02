-- ============================================================================
-- trade_house - 027_manager_invites_trader.sql
--
-- DEMANDE METIER : un manager peut inviter un trader, qui tombe sous sa
-- couverture automatiquement.
--
-- ECART AU CAHIER DES CHARGES, ASSUME ET CIBLE. Le CDC v1.2 ecrit :
--   RG-02 : "Seul l'admin peut creer, desactiver ou reactiver un compte"
--   RG-06 : "Le manager ne peut pas : creer, desactiver ou reactiver un compte"
-- Cette migration retreche ces deux interdits, pour UN cas et UN seul :
-- le manager cree un TRADER, et ce trader est le SIEN.
--
-- Pourquoi ne pas elargir la regle elle-meme. Un manager qui peut creer un
-- compte doit pouvoir creer exactement UN type de compte : un trader qui lui
-- appartient. S'il pouvait creer un admin, il s'auto-attribuerait le
-- controle de la plateforme ; s'il pouvait creer un manager, il pourrait
-- BATIR SON PROPRE RESEAU et s'affranchir de l'admin. Ce ne serait plus une
-- delegation de recouvrement, ce serait une elevation de privileges
-- deguisee. La restriction au role 'trader' ET au manager courant n'est donc
-- pas une precaution de style : c'est ce qui rend la delegation sure.
--
-- Le reste de RG-02 tient : un manager ne deactive pas, ne reactive pas,
-- ne reattribue pas. Ces actions-la restent Administration, donc absentes de
-- la matrice MANAGER dans src/lib/permissions.ts.
-- ============================================================================
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 1. Creation d'un trader par son manager
--
-- On ne remplace PAS app.create_user : elle est appalee par l'admin, le
-- bootstrap et plusieurs tests SQL, et sa signature est un contrat. On y
-- ajoute une fonction dediee, dont le nom dit ce qu'elle autorise : inviter
-- un trader n'est pas " creer un compte ".
-- ---------------------------------------------------------------------------
create or replace function app.invite_trader(
  p_email        citext,
  p_full_name    varchar,
  p_timezone     varchar default 'UTC',
  p_locale       varchar default 'fr',
  p_mfa_enforced boolean default false
) returns public.users
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user public.users;
  v_me   uuid;
begin
  v_me := app.current_user_id();

  -- L'admin peut aussi l'appeler : c'est le meme resultat, et il passe par
  -- ce chemin plutot que par create_user pour que la couverture soit posee
  -- de facon homogene quand c'est lui qui invite pour un manager donne.
  if not (app.is_admin() or app.current_user_role() = 'manager') then
    raise exception 'RG-02 : seul un administrateur ou un manager invite un trader';
  end if;

  if exists (select 1 from public.users u where u.email = p_email) then
    raise exception 'RG-01 : cet email est deja utilise';
  end if;

  -- COUVERTURE : le manager est impose, jamais choisi. Un manager qui
  -- pourrait passer p_manager_id rattacherait le nouveau trader a quelqu'un
  -- d'autre : c'est a dire en dehors de sa portee, alors qu'il vient de le
  -- creer. La regle tient donc sans faire confiance a l'appelant.
  v_user := case
    when app.current_user_role() = 'manager' then
      (insert into public.users
         (email, password_hash, full_name, role, manager_id, timezone,
          preferred_locale, mfa_enforced)
       values (p_email, '!' || encode(gen_random_bytes(32), 'hex'), p_full_name,
               'trader', v_me, p_timezone, p_locale, p_mfa_enforced)
       returning *)
    else
      -- L'admin, lui, choisit le manager de tutelle.
      null
  end;

  if v_user.id is null then
    raise exception 'RG-02 : un administrateur doit passer par app.create_user';
  end if;

  perform app.fn_audit('user.create', 'user', v_user.id,
                       jsonb_build_object('role', 'trader', 'email', p_email::text,
                                          'by_manager', not app.is_admin()));
  return v_user;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Emission de l'invitation
--
-- app.issue_invitation refuse aujourd'hui qu'un manager invite (RG-02). On
-- elargit, MAIS au meme prix qu'a la creation : le manager n'invite que les
-- traders qui lui sont deja rattaches. Sans ce controle, il pourrait inviter
-- le trader d'un AUTRE manager, et donc emettre un lien d'accueil sur un
-- compte qui n'est pas le sien.
--
-- Note le cas password_reset : il n'est PAS ouvert au manager. Reinitialiser
-- le mot de passe d'un compte est plus fort qu'inviter, et le tricherait
-- d'acces au compte d'autrui. La demande de reinitialisation passe par un
-- canal que le manager ne maitrise pas.
-- ---------------------------------------------------------------------------
create or replace function app.issue_invitation(
  p_user_id uuid,
  p_purpose invitation_purpose default 'invite'
) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_token text := encode(gen_random_bytes(32), 'hex');
  v_ttl   interval;
  v_id    uuid;
begin
  if p_purpose = 'invite' then
    if app.is_admin() then
      null;  -- chemin nominal, l'admin invite qui il veut
    elsif app.current_user_role() = 'manager' then
      -- Elargissement RG-02 : le manager invite, mais seulement les siens.
      if not exists (
        select 1 from public.users u
         where u.id = p_user_id
           and u.role = 'trader'
           and u.manager_id = app.current_user_id()
      ) then
        raise exception 'RG-02 : vous n invitez que vos propres traders';
      end if;
    else
      raise exception 'RG-02 : seul l''admin ou un manager invite un utilisateur';
    end if;
  elsif not app.is_admin() then
    -- Reinitialisation de mot de passe : administrateur seulement.
    raise exception 'RG-02 : seul l''admin reinitialise un mot de passe';
  end if;

v_ttl := case when p_purpose = 'invite'
                then make_interval(days => (select invitation_ttl_days
                                            from public.app_settings where id = 1))
                else interval '1 hour'
           end if;

  insert into public.user_invitations
    (user_id, email, purpose, token_hash, expires_at, created_by, sent_count, last_sent_at)
  select u.id, u.email, p_purpose, app.hash_token(v_token), now() + v_ttl,
         app.current_user_id(), 1, now()
    from public.users u where u.id = p_user_id
  returning id into v_id;

  if v_id is null then
    raise exception 'Utilisateur % introuvable', p_user_id;
  end if;

  if p_purpose = 'invite' then
    update public.users
       set invited_at = now(), invite_expires_at = now() + v_ttl
     where id = p_user_id;
  end if;

  perform app.fn_audit('user.invite_sent', 'user', p_user_id,
                       jsonb_build_object('purpose', p_purpose));
  return v_token;   -- seul moment ou le token en clair est disponible
end $$;

grant execute on function
  app.invite_trader(citext, varchar, varchar, varchar, boolean),
  app.issue_invitation(uuid, invitation_purpose)
to trade_house_app;
comment on function app.invite_trader is
  'Manager : cree un trader qui lui est automatiquement rattache. Admin : refuse, '
  'il passe par app.create_user qui permet de choisir le manager de tutelle. '
  'Aucun autre role n est cree par cette fonction (RG-02 elargi, RG-06).';
