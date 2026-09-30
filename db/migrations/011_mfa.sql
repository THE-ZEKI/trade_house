-- ============================================================================
-- trade_house - 011_mfa.sql
-- Double authentification (A5) : depot du secret TOTP, confirmation, codes de
-- secours, et reglage de l'obligation par l'admin.
--
-- Les secrets TOTP sont chiffres par l'application (AES-256-GCM) avant d'etre
-- stockes : public.mfa_factors.secret ne contient jamais le secret en clair.
-- ============================================================================
\set ON_ERROR_STOP on

-- 1. L'admin rend la 2FA obligatoire pour un compte (RG-06)
create or replace function app.set_mfa_enforced(p_user_id uuid, p_enabled boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.is_admin() then
    raise exception 'RG-06 : seul l''admin peut rendre la 2FA obligatoire';
  end if;
  update public.users set mfa_enforced = p_enabled where public.users.id = p_user_id;
  perform app.fn_audit('user.mfa_enforced', 'user', p_user_id,
                       jsonb_build_object('enabled', p_enabled));
end $$;

-- 2. Depot d'un secret chiffre (toute confirmation en attente remplace l'autre)
create or replace function app.store_mfa_secret(p_user_id uuid, p_secret bytea)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if app.current_user_id() is distinct from p_user_id and not app.is_admin() then
    raise exception 'Modification de la 2FA non autorisee';
  end if;

  delete from public.mfa_factors
   where user_id = p_user_id and confirmed_at is null;

  insert into public.mfa_factors (user_id, factor_type, secret)
  values (p_user_id, 'totp', p_secret)
  returning id into v_id;
  return v_id;
end $$;

-- 3. Confirmation : le secret est prouve par un code valide
create or replace function app.confirm_mfa(p_user_id uuid, p_secret bytea)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count int;
begin
  if app.current_user_id() is distinct from p_user_id and not app.is_admin() then
    raise exception 'Modification de la 2FA non autorisee';
  end if;

  update public.mfa_factors
     set secret = p_secret, confirmed_at = now()
   where user_id = p_user_id and confirmed_at is null;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'Aucun secret en attente de confirmation';
  end if;

  update public.users set mfa_enrolled = true where public.users.id = p_user_id;
  perform app.fn_audit('user.mfa_enrolled', 'user', p_user_id, '{}'::jsonb);
end $$;

-- 4. Lecture du secret confirme (uniquement pour la verification du code)
create or replace function app.mfa_secret(p_user_id uuid)
returns bytea language sql security definer set search_path = public, pg_temp as $$
  select f.secret from public.mfa_factors f
   where f.user_id = p_user_id and f.confirmed_at is not null
   order by f.confirmed_at desc limit 1
$$;

-- 5. Desactivation (soit par l'interesse, soit par l'admin)
create or replace function app.disable_mfa(p_user_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if app.current_user_id() is distinct from p_user_id and not app.is_admin() then
    raise exception 'Modification de la 2FA non autorisee';
  end if;
  delete from public.mfa_factors where user_id = p_user_id;
  delete from public.mfa_backup_codes where user_id = p_user_id;
  update public.users set mfa_enrolled = false where public.users.id = p_user_id;
  -- RG-63 : la desactivation d'une 2FA est un evenement sensible
  perform app.fn_audit('user.mfa_disabled', 'user', p_user_id, '{}'::jsonb);
end $$;

-- 6. Codes de secours (haches SHA-256, a usage unique)
create or replace function app.store_backup_codes(p_user_id uuid, p_hashes text[])
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count int;
begin
  if app.current_user_id() is distinct from p_user_id and not app.is_admin() then
    raise exception 'Modification de la 2FA non autorisee';
  end if;
  delete from public.mfa_backup_codes where user_id = p_user_id;
  insert into public.mfa_backup_codes (user_id, code_hash)
  select p_user_id, unnest(p_hashes);
  select count(*)::int into v_count from public.mfa_backup_codes where user_id = p_user_id;
  return v_count;
end $$;

-- Un code de secours est consomme a la premiere utilisation
create or replace function app.consume_backup_code(p_user_id uuid, p_hash text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  update public.mfa_backup_codes
     set used_at = now()
   where user_id = p_user_id and code_hash = p_hash and used_at is null
  returning id into v_id;
  return v_id is not null;
end $$;

-- Combien de codes de secours restent disponibles
create or replace function app.backup_codes_remaining(p_user_id uuid)
returns int language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::int from public.mfa_backup_codes
   where user_id = p_user_id and used_at is null
$$;

-- 8. Lecture de l'etat 2FA pour la validation d'un second facteur.
--    SECURITY DEFINER comme les autres : a cet instant, le mot de passe est
--    verifie mais AUCUNE session n'existe encore, le RLS ne laisserait donc
--    passer aucune ligne de mfa_factors.
create or replace function app.mfa_state(p_email citext)
returns table (
  user_id    uuid,
  email      citext,
  full_name  varchar,
  role       user_role,
  is_active  boolean,
  secret     bytea
)
language sql security definer set search_path = public, pg_temp as $$
  select u.id, u.email, u.full_name, u.role, u.is_active,
         (select f.secret from public.mfa_factors f
           where f.user_id = u.id and f.confirmed_at is not null
           order by f.confirmed_at desc limit 1)
    from public.users u
   where u.email = p_email
$$;

-- 9. Recherche de compte pour une reinitialisation de mot de passe.
--    Comme app.user_for_login, SECURITY DEFINER : a cet instant personne n'est
--    identifie et le RLS ne laisserait passer aucune ligne.
--    Ne renvoie volontairement PAS le hash : cette fonction sert a savoir si
--    un jeton doit etre emis, rien de plus.
create or replace function app.account_for_recovery(p_email citext)
returns table (id uuid, email citext, full_name varchar, is_active boolean)
language sql security definer set search_path = public, pg_temp as $$
  select u.id, u.email, u.full_name, u.is_active
    from public.users u
   where u.email = p_email
$$;
