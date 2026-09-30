-- ============================================================================
-- trade_house - 010_auth.sql
-- Helpers d'authentification.
--
-- Pourquoi une migration separe ? Les migrations 001..009 sont deja appliquees
-- sur la base de developpement : on ne les modifie plus, on ajoute.
--
-- Pourquoi des fonctions SECURITY DEFINER ? Au moment de la connexion,
--personne n'est encore identifie (app.user_id est vide) et les politiques RLS
-- ne laisse passer aucune ligne de public.users. Sans ces fonctions, la
-- connexion serait impossible. Elles sont volontairement etroites : elles
-- exposent le strict necessaire et ne renvoient jamais le hash en dehors de
-- la verification de mot de passe cote API.
-- ============================================================================
\set ON_ERROR_STOP on

-- Journalisation en nommant explicitement l'auteur (lors d'un appel anonyme,
-- app.current_user_id() est vide).
create or replace function app.fn_audit_for(
  p_actor       uuid,
  p_action      varchar,
  p_entity_type varchar,
  p_entity_id   uuid,
  p_details     jsonb default '{}'::jsonb
) returns void
language sql as $$
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (p_actor, p_action, p_entity_type, p_entity_id, coalesce(p_details, '{}'::jsonb))
$$;

-- 1. Lecture du compte pour une tentative de connexion (contourne le RLS)
create or replace function app.user_for_login(p_email citext)
returns table (
  id             uuid,
  email          citext,
  password_hash  text,
  full_name      varchar,
  role           user_role,
  is_active      boolean,
  mfa_enforced   boolean,
  mfa_enrolled   boolean,
  preferred_locale varchar,
  timezone       varchar
)
language sql security definer set search_path = public, pg_temp as $$
  select u.id, u.email, u.password_hash, u.full_name, u.role, u.is_active,
         u.mfa_enforced, u.mfa_enrolled, u.preferred_locale, u.timezone
    from public.users u
   where u.email = p_email
$$;

-- 2. Ouverture de session (RG : un compte desactive ne peut plus se connecter)
create or replace function app.create_session(
  p_user_id    uuid,
  p_token_hash text,
  p_ip         inet   default null,
  p_user_agent text   default null,
  p_ttl_hours  int    default 12
) returns table (id uuid, expires_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id  uuid;
  v_exp timestamptz := now() + make_interval(hours => p_ttl_hours);
begin
  if not exists (select 1 from public.users u where u.id = p_user_id and u.is_active) then
    raise exception 'Compte inactif ou inexistant';
  end if;

  -- colonnes qualifiees : sans quoi " id " est ambigu avec les colonnes de
  -- sortie declarees par RETURNS TABLE (erreur PostgreSQL)
  insert into public.user_sessions (user_id, token_hash, ip_address, user_agent, expires_at)
  values (p_user_id, p_token_hash, p_ip, p_user_agent, v_exp)
  returning user_sessions.id, user_sessions.expires_at into v_id, v_exp;

  -- colonnes qualifiees partout : les parametres de sortie de RETURNS TABLE
  -- s'appellent " id " et " expires_at ", un " id " nu serait ambigu.
  update public.users set last_login_at = now() where public.users.id = p_user_id;
  perform app.fn_audit_for(p_user_id, 'user.login', 'user', p_user_id, '{}'::jsonb);

  return query select v_id, v_exp;
end $$;

-- 3. Lecture de la session courante a partir du jeton presents dans le cookie
create or replace function app.session_user(p_token_hash text)
returns table (
  user_id          uuid,
  email            citext,
  full_name        varchar,
  role             user_role,
  timezone         varchar,
  preferred_locale varchar,
  mfa_enforced     boolean,
  mfa_enrolled     boolean,
  session_expires_at timestamptz
)
language sql stable security definer set search_path = public, pg_temp as $$
  select u.id, u.email, u.full_name, u.role, u.timezone, u.preferred_locale,
         u.mfa_enforced, u.mfa_enrolled, s.expires_at
    from public.user_sessions s
    join public.users u on u.id = s.user_id
   where s.token_hash = p_token_hash
     and s.revoked_at is null
     and s.expires_at > now()
     and u.is_active
$$;

-- 4. Fermeture d'une session
create or replace function app.revoke_session(p_token_hash text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_count int;
  v_user  uuid;
begin
  with s as (
    update public.user_sessions
       set revoked_at = now()
     where token_hash = p_token_hash and revoked_at is null
    returning user_id
  )
  -- pas de max() sur uuid en PostgreSQL : on passe par array_agg
  select count(*)::int, (array_agg(user_id))[1] into v_count, v_user from s;

  if v_count = 0 then
    return false;
  end if;
  perform app.fn_audit_for(v_user, 'user.logout', 'user', v_user, '{}'::jsonb);
  return true;
end $$;

-- 5. Fermeture de toutes les sessions d'un utilisateur (changement de MDP)
create or replace function app.revoke_all_sessions(p_user_id uuid) returns int
language sql security definer set search_path = public, pg_temp as $$
  with s as (
    update public.user_sessions set revoked_at = now()
     where user_id = p_user_id and revoked_at is null
    returning 1
  )
  select count(*)::int from s
$$;

-- 6. Purge des sessions expirees (job quotidien)
create or replace function app.purge_expired_sessions() returns int
language sql security definer set search_path = public, pg_temp as $$
  with s as (
    delete from public.user_sessions
     where expires_at < now() - interval '30 days'
    returning 1
  )
  select count(*)::int from s
$$;

-- Maintien de last_seen_at (appele periodiquement par l'API)
create or replace function app.touch_session(p_token_hash text) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.user_sessions set last_seen_at = now()
   where token_hash = p_token_hash and revoked_at is null
$$;

-- 7. Journal des connexions recentes (F5 / RG-52)
create or replace function app.recent_logins(p_user_id uuid, p_limit int default 20)
returns table (ip_address inet, user_agent text, created_at timestamptz)
language sql security definer set search_path = public, pg_temp as $$
  select s.ip_address, s.user_agent, s.created_at
    from public.user_sessions s
   where s.user_id = p_user_id
   order by s.created_at desc
   limit least(greatest(p_limit, 1), 100)
$$;
