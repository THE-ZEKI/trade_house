-- ============================================================================
-- trade_house - 012_security.sql
-- Durcissement de l'authentification :
--   1. limitation des tentatives (login, 2FA, reinitialisation) ;
--   2. protection contre le rejeu d'un code TOTP deja utilise ;
--   3. journalisation des echecs (detection de compromission).
--
-- Ces trois points fermaient des trous reels :
--   - un mot de passe pouvait etre devine sans limite ;
--   - un code TOTP de 6 chiffres restait rejouable pendant sa fenetre de 30 s ;
--   - les echecs n'etaient pas traces, donc invisibles.
-- ============================================================================
\set ON_ERROR_STOP on

-- 1. Parametres de limitation
alter table public.app_settings
  add column max_login_attempts   int not null default 5   check (max_login_attempts > 0),
  add column login_lockout_minutes int not null default 15  check (login_lockout_minutes > 0),
  add column max_mfa_attempts     int not null default 5   check (max_mfa_attempts > 0),
  add column mfa_lockout_minutes  int not null default 15   check (mfa_lockout_minutes > 0);

comment on column public.app_settings.max_login_attempts is
  'Nombre d echecs de connexion consecutifs avant blocage temporaire';

-- 2. Journal des tentatives (succes et echecs)
create table public.login_attempts (
  id         bigint generated always as identity primary key,
  email      citext,
  ip_address inet,
  user_id    uuid references public.users(id) on delete set null,
  event      varchar(40) not null
             check (event in ('password_login','mfa_challenge','password_reset','invitation')),
  success    boolean not null default false,
  created_at timestamptz not null default now()
);
create index login_attempts_email_idx on public.login_attempts (email, created_at desc);
create index login_attempts_ip_idx    on public.login_attempts (ip_address, created_at desc);
create index login_attempts_user_idx   on public.login_attempts (user_id, created_at desc)
  where user_id is not null;

-- 3. Journalisation d'une tentative
create or replace function app.record_auth_attempt(
  p_email  citext,
  p_ip     inet default null,
  p_event  varchar default 'password_login',
  p_success boolean default false
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.login_attempts (email, ip_address, user_id, event, success)
  values (p_email, p_ip,
          (select u.id from public.users u where u.email = p_email),
          p_event, p_success);
end $$;

-- 4. Verification du blocage temporaire.
--    On compte les echecs RECENTS par adresse email ET par adresse IP : un
--    attaquant qui change d'email depuis la meme IP reste bloque, et un mot de
--    passe partage depuis plusieurs IP est protege cote compte.
create or replace function app.check_auth_throttle(
  p_email citext,
  p_ip    inet    default null,
  -- PostgreSQL impose une valeur par defaut a tout parametre suivant un
  -- parametre qui en a une
  p_event varchar default 'password_login'
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s         public.app_settings;
  v_max     int;
  v_window  interval;
  v_email_f int;
  v_ip_f    int;
begin
  select * into s from public.app_settings where id = 1;
  v_max    := case when p_event = 'mfa_challenge' then s.max_mfa_attempts
                    else s.max_login_attempts end;
  v_window := case when p_event = 'mfa_challenge'
                   then make_interval(mins => s.mfa_lockout_minutes)
                   else make_interval(mins => s.login_lockout_minutes) end;

  select count(*) into v_email_f
    from public.login_attempts a
   where a.event = p_event
     and a.email is not distinct from p_email
     and not a.success
     and a.created_at > now() - v_window;

  if v_email_f >= v_max then
    raise exception 'Trop de tentatives, reessayez dans % minutes', s.login_lockout_minutes;
  end if;

  if p_ip is not null then
    -- On compte les COMPTES DISTINCTS attacked depuis cette IP, pas le nombre
    -- d echecs : sinon un attaquant qui essaie plusieurs identifiants depuis
    -- une seule IP (ou un reseau partage derriere un proxy) bloquerait tous
    -- les utilisateurs legitimes de cette meme adresse.
    select count(distinct a.email) into v_ip_f
      from public.login_attempts a
     where a.event = p_event
       and a.ip_address = p_ip
       and not a.success
       and a.email is not null
       and a.created_at > now() - v_window;
    if v_ip_f >= v_max * 2 then
      raise exception 'Trop de tentatives depuis cette adresse, reessayez plus tard';
    end if;
  end if;
end $$;

-- 5. Rejeu d'un code TOTP : un code ne peut servir qu'une fois.
--    last_used_step est monotone : un pas deja employe (ou un pas anterieur)
--    est refuse, meme si l'attaquant rejoue la requete dans la fenetre de 30 s.
alter table public.mfa_factors add column last_used_step bigint;

create or replace function app.consume_totp_step(p_user_id uuid, p_step bigint)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_last bigint;
begin
  select f.last_used_step into v_last
    from public.mfa_factors f
   where f.user_id = p_user_id and f.confirmed_at is not null
   order by f.confirmed_at desc
   limit 1
     for update;

  if v_last is not null and p_step <= v_last then
    return false;
  end if;

  update public.mfa_factors
     set last_used_step = p_step
   where user_id = p_user_id and confirmed_at is not null;
  return true;
end $$;

-- 6. Purge des tentatives anciennes (job quotidien, avec purge_expired_sessions)
create or replace function app.purge_auth_attempts() returns int
language sql security definer set search_path = public, pg_temp as $$
  with d as (
    delete from public.login_attempts
     where created_at < now() - interval '30 days'
    returning 1
  )
  select count(*)::int from d
$$;
