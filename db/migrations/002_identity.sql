-- ============================================================================
-- trade_house - 002_identity.sql
-- Parametres globaux - comptes (RG-01..06, A1..A5) - invitations - 2FA
-- sessions - journal d'audit (RG-63)
-- ============================================================================
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 1. Parametres globaux (singleton) - les seuils mentionnes " parametrables "
--    dans le CDC n'avaient aucune table. Modifiable par l'admin uniquement (RG-06).
-- ---------------------------------------------------------------------------
create table public.app_settings (
  id                        smallint primary key default 1 check (id = 1),
  -- Rapports
  late_submission_days      int  not null default 7   check (late_submission_days > 0),    -- RG-36
  correction_critical_days  int  not null default 7   check (correction_critical_days > 0),-- RG-47
  stale_submission_hours    int  not null default 72  check (stale_submission_hours > 0),  -- RG-48
  max_files_per_report      int  not null default 10  check (max_files_per_report > 0),    -- RG-32
  max_screenshot_mb         int  not null default 10  check (max_screenshot_mb > 0),       -- RG-32
  max_pdf_mb                int  not null default 20  check (max_pdf_mb > 0),               -- RG-32
  -- Reunions / presence / salle
  default_reminders         text[] not null default array['invitation','d_minus_1','h_minus_1'], -- RG-14
  default_duration_min      int  not null default 60  check (default_duration_min > 0),
  attendance_present_ratio  numeric(4,3) not null default 0.500
                            check (attendance_present_ratio > 0 and attendance_present_ratio <= 1), -- RG-23
  late_arrival_minutes      int  not null default 10  check (late_arrival_minutes >= 0),    -- RG-23
  room_open_before_minutes  int  not null default 10  check (room_open_before_minutes >= 0),-- RG-20
  room_close_after_minutes  int  not null default 120 check (room_close_after_minutes > 0), -- RG-20
  -- Emails
  invitation_ttl_days       int  not null default 7   check (invitation_ttl_days > 0),      -- RG-05
  reminder_retry_count      int  not null default 3   check (reminder_retry_count >= 0),    -- RG-16
  reminder_retry_minutes    int  not null default 10  check (reminder_retry_minutes > 0),   -- RG-16
  -- Internationalisation (RG-53)
  default_locale            varchar(10) not null default 'fr',
  available_locales         text[] not null default array['fr','en'],
  -- Stockage des fichiers (RG-33 : espace prive, liens signes temporaires)
  storage_provider          varchar(20) not null default 'local'
                            check (storage_provider in ('local','s3','supabase')),
  storage_bucket            varchar(100) not null default 'trade-house-private',
  -- Retention (RG-64) - valeurs a valider avec le client
  retention_recording_months int check (retention_recording_months > 0),
  retention_report_months    int check (retention_report_months > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- ---------------------------------------------------------------------------
-- 2. Comptes - RG-01 (email unique), RG-02 (dernier admin actif),
--    RG-05 (invitation 7 j), RG-06 (1 trader = 1 manager)
-- ---------------------------------------------------------------------------
create table public.users (
  id                  uuid primary key default gen_random_uuid(),
  email               citext not null unique,               -- RG-01 : identifiant
  password_hash       text not null,                        -- RG-60 : bcrypt/argon2, jamais en clair
  full_name           varchar(150) not null,
  phone               varchar(30),
  role                user_role not null,
  timezone            varchar(60) not null default 'UTC',   -- RG-19
  preferred_locale    varchar(10) not null default 'fr',    -- RG-53
  manager_id          uuid references public.users(id) on delete set null,
  is_active           boolean not null default true,        -- A3 : jamais de suppression physique
  -- 2FA (A5)
  mfa_enrolled        boolean not null default false,
  mfa_enforced        boolean not null default false,       -- true => 2FA obligatoire (admins)
  -- Invitation (A2 / RG-05)
  invited_at          timestamptz,
  invite_expires_at   timestamptz,
  -- Cycle de vie
  last_login_at       timestamptz,
  password_changed_at timestamptz not null default now(),
  anonymized_at       timestamptz,                          -- RGPD : pseudonymisation
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint users_no_self_manager      check (manager_id is null or manager_id <> id),
  constraint users_manager_is_trader     check (role = 'trader' or manager_id is null),
  constraint users_invitation_window     check (invited_at is null or invite_expires_at is null
                                                 or invite_expires_at > invited_at)
);

create index users_manager_idx on public.users (manager_id) where manager_id is not null;
create index users_role_idx    on public.users (role, is_active);

-- FK differee : app_settings -> users (table users doit d'abord exister)
alter table public.app_settings
  add constraint app_settings_updated_by_fkey
  foreign key (updated_by) references public.users(id) on delete set null;


-- ---------------------------------------------------------------------------
-- 3. Sessions (authentification PostgreSQL dev)
--    En Supabase, cette table est remplacee par auth.sessions ; le contrat
--    applicatif reste identique (jeton hache, expiration, revocation).
-- ---------------------------------------------------------------------------
create table public.user_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  token_hash   text not null unique,       -- jamais le jeton en clair
  ip_address   inet,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz
);
create index user_sessions_active_idx on public.user_sessions (user_id, expires_at desc)
  where revoked_at is null;

-- ---------------------------------------------------------------------------
-- 4. 2FA (A5) - TOTP : le secret est chiffre par l'application (KMS) ou via
--    pgp_sym_encrypt ; il n'est jamais stocke en clair.
-- ---------------------------------------------------------------------------
create table public.mfa_factors (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  factor_type  varchar(20) not null default 'totp' check (factor_type in ('totp','email')),
  secret       bytea not null,
  label        varchar(60) not null default 'Application d''authentification',
  confirmed_at timestamptz,
  last_used_at timestamptz,
  created_at   timestamptz not null default now()
);
create unique index mfa_factors_one_confirmed_idx
  on public.mfa_factors (user_id, factor_type) where confirmed_at is not null;

-- Codes de secours : sans eux, une perte de telephone = blocage definitif
create table public.mfa_backup_codes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  code_hash  text not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index mfa_backup_codes_idx on public.mfa_backup_codes (user_id) where used_at is null;

-- ---------------------------------------------------------------------------
-- 5. Invitations et reinitialisation (A1, A2, RG-05)
--    Decision D3 : les liens sont emis par le fournisseur d'identite ; cette
--    table porte la POLITIQUE metier (duree de vie 7 j, revocation du lien
--    precedent au renvoi, compteur d'envois, audit).
-- ---------------------------------------------------------------------------
create table public.user_invitations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  email       citext not null,
  purpose     invitation_purpose not null,
  token_hash  text not null unique,        -- le token en clair n'est renvoye qu'a la creation
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  revoked_at  timestamptz,
  sent_count  int not null default 0,
  last_sent_at timestamptz,
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint user_invitations_future check (expires_at > created_at)
);
-- Un seul lien actif par utilisateur et par usage : le renvoi invalide l'ancien (RG-05)
create unique index user_invitations_active_idx
  on public.user_invitations (user_id, purpose)
  where consumed_at is null and revoked_at is null;
create index user_invitations_expiry_idx on public.user_invitations (expires_at)
  where consumed_at is null and revoked_at is null;

-- ---------------------------------------------------------------------------
-- 6. Journal d'audit (F5, RG-52, RG-63) - accessible a l'admin seul (RG-06)
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references public.users(id) on delete set null,
  action      varchar(80) not null,        -- codes : user.deactivate, report.validate...
  entity_type varchar(40) not null,        -- 'user','meeting','report','correction'...
  entity_id   uuid,
  details     jsonb not null default '{}'::jsonb,
  ip_address  inet,
  created_at  timestamptz not null default now()
);
create index audit_log_created_idx on public.audit_log (created_at desc);
create index audit_log_entity_idx  on public.audit_log (entity_type, entity_id);
create index audit_log_actor_idx   on public.audit_log (actor_id, created_at desc);


-- ---------------------------------------------------------------------------
-- 7. Fonctions d'identite (definies ici car elles referencent les tables)
-- ---------------------------------------------------------------------------
create or replace function app.current_user_role() returns user_role
language sql stable security definer set search_path = public, pg_temp as $$
  select u.role from public.users u
  where u.id = app.current_user_id() and u.is_active
$$;

create or replace function app.is_admin() returns boolean
language sql stable as $$ select coalesce(app.current_user_role() = 'admin', false) $$;

create or replace function app.is_manager() returns boolean
language sql stable as $$ select coalesce(app.current_user_role() = 'manager', false) $$;

create or replace function app.is_trader() returns boolean
language sql stable as $$ select coalesce(app.current_user_role() = 'trader', false) $$;

-- Admin OU manager du trader concerne (RG-06)
create or replace function app.can_manage_trader(p_trader_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when app.current_user_id() is null then false
    when app.current_user_role() = 'admin' then true
    when app.current_user_role() = 'manager'
      then exists (select 1 from public.users t
                   where t.id = p_trader_id and t.manager_id = app.current_user_id())
    else false
  end
$$;

-- Le trader ne voit que ses propres donnees (RG-04)
create or replace function app.can_view_trader(p_trader_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when app.current_user_id() is null then false
    when app.current_user_id() = p_trader_id then true
    else app.can_manage_trader(p_trader_id)
  end
$$;

-- Lecture typee des parametres (singleton)
create or replace function app.settings() returns public.app_settings
language sql stable security definer set search_path = public, pg_temp as $$
  select * from public.app_settings where id = 1
$$;

-- Journalisation (RG-63)
create or replace function app.fn_audit(
  p_action      varchar,
  p_entity_type varchar,
  p_entity_id   uuid,
  p_details     jsonb default '{}'::jsonb
) returns void
language sql as $$
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (app.current_user_id(), p_action, p_entity_type, p_entity_id,
          coalesce(p_details, '{}'::jsonb))
$$;

-- ---------------------------------------------------------------------------
-- 8. Triggers comptes
-- ---------------------------------------------------------------------------
create trigger users_touch_trg before update on public.users
  for each row execute function app.fn_touch_updated_at();
create trigger app_settings_touch_trg before update on public.app_settings
  for each row execute function app.fn_touch_updated_at();
create trigger user_invitations_touch_trg before update on public.user_invitations
  for each row execute function app.fn_touch_updated_at();

-- RG-06 : un trader ne peut etre rattache qu'a un manager (ou admin) existant
create or replace function app.fn_users_manager_guard() returns trigger
language plpgsql as $$
declare v_role user_role;
begin
  if new.manager_id is not null then
    select u.role into v_role from public.users u where u.id = new.manager_id;
    if v_role is null then
      raise exception 'Manager % inexistant', new.manager_id;
    end if;
    if v_role not in ('manager','admin') then
      raise exception 'RG-06 : un trader doit etre rattache a un manager ou un admin';
    end if;
  end if;
  return new;
end $$;

create trigger users_manager_guard_trg before insert or update of manager_id on public.users
  for each row execute function app.fn_users_manager_guard();

-- RG-02 : le dernier administrateur actif ne peut pas etre desactive
create or replace function app.fn_users_deactivate_guard() returns trigger
language plpgsql as $$
begin
  if old.is_active and new.is_active = false then
    if app.current_user_id() is not null and app.current_user_id() = new.id then
      raise exception 'Un utilisateur ne peut pas desactiver son propre compte';
    end if;
    if new.role = 'admin' and not exists (
        select 1 from public.users u where u.role = 'admin' and u.is_active and u.id <> new.id) then
      raise exception 'RG-02 : le dernier administrateur actif ne peut pas etre desactive';
    end if;
  end if;
  return new;
end $$;

create trigger users_deactivate_guard_trg before update of is_active on public.users
  for each row execute function app.fn_users_deactivate_guard();

-- RG-05 : la creation d'une invitation revoque le lien actif precedent
create or replace function app.fn_invitations_revoke_previous() returns trigger
language plpgsql as $$
begin
  update public.user_invitations
     set revoked_at = now()
   where user_id = new.user_id
     and purpose = new.purpose
     and id <> new.id
     and consumed_at is null
     and revoked_at is null;
  return new;
end $$;

-- RG-05 : la creation d'une invitation revoque le lien actif precedent.
-- BEFORE et non AFTER : l'index unique partiel est verifie a l'insertion de la
-- ligne, un AFTER declencherait trop tard (violation de unicite).
create trigger user_invitations_revoke_trg before insert on public.user_invitations
  for each row execute function app.fn_invitations_revoke_previous();
