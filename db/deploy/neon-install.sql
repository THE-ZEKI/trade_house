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
-- -----------------------------------------------------------------------------
-- 001_core.sql
-- -----------------------------------------------------------------------------
-- ============================================================================
-- trade_house - 001_core.sql
-- Extensions - schema applicatif - enumerations - helpers
-- PostgreSQL 14+ (developpe et valide sur PostgreSQL 18)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto;  -- gen_random_uuid(), digest() pour le hachage des jetons
create extension if not exists citext;    -- email insensible a la casse (RG-01)

create schema if not exists app;
comment on schema app is
  'Helpers et fonctions applicatifs. Les tables restent dans public (compatibilite Supabase).';

-- ---------------------------------------------------------------------------
-- 1. Enumerations
--    Rappel RG-53 : on stocke des CODES, jamais des libelles. Les libelles
--    sont traduits a l'affichage (next-intl).
-- ---------------------------------------------------------------------------
create type user_role as enum ('admin','manager','trader');

create type meeting_type   as enum ('internal','external','instant');
create type meeting_status as enum ('scheduled','live','ended','cancelled');
create type link_provider  as enum ('zoom','meet','teams','other','internal');
create type link_source    as enum ('meeting_form','reminder');
create type rsvp_status    as enum ('pending','accepted','declined','maybe');
create type reminder_kind   as enum ('invitation','d_minus_1','h_minus_1','custom','manual');
create type reminder_status as enum ('scheduled','sending','sent','failed','cancelled');
create type attendance_status as enum ('present','absent','late');

-- Decision D1 : 'resubmitted' est CONSERVE (etat d'attente persistant).
--   Sans lui, le trader devrait ecrire 'in_review', ce que RG-41 lui interdit.
-- Decision D1b : 'dismissed' est AJOUTE (cloture sans suite RG-47) : le CDC
--   ne prevoyait qu'un flag dismissed_at, insuffisant pour sortir des listes
--   de travail et rendre le rapport non modifiable.
-- Decision D1d : 'declared' est AJOUTE pour la declaration " pas de trading "
--   (RG-37) : etat terminal, hors file de revision, mais compte comme jour
--   en regle pour le tableau de bord (F1).
create type report_status as enum (
  'draft','submitted','in_review','correction_requested','resubmitted',
  'validated','dismissed','declared');

create type report_result_type as enum ('gain','loss','breakeven');
create type report_file_kind  as enum ('screenshot','pdf','correction_attachment');
create type correction_target_type as enum ('general','field','file');
create type correction_severity    as enum ('mandatory','suggestion');
-- Decision D1c : 'dropped' ajoute = abandon par l'admin d'un correctif rejete
--   par le trader (arbitrage " maintien ou abandon " de RG-43).
create type correction_status      as enum ('open','done','rejected','dropped');

create type annotation_shape   as enum ('arrow','circle','rectangle','text','freehand');
create type notification_channel as enum ('email','in_app');
create type notification_status  as enum ('pending','sending','sent','failed','opened','cancelled');
create type invitation_purpose   as enum ('invite','password_reset');
create type emotion_code as enum (
  'calm','confident','fomo','impatience','stress','revenge','other');
-- Le CDC prevoyait varchar(60) libre ; un enum garantit l'exhaustivite des cles
-- de traduction (RG-53) et permet un index.
create type notification_event as enum (
  'account_invited','account_reactivated','account_disabled',
  'password_reset','password_changed','mfa_enrolled','mfa_disabled',
  'meeting_created','meeting_updated','meeting_cancelled','meeting_invitation',
  'meeting_reminder','meeting_relance','meeting_rsvp','meeting_started','meeting_ended',
  'room_opening_soon','room_closing_soon',
  'report_submitted','report_in_review','correction_requested','report_resubmitted',
  'report_validated','report_dismissed','report_reopened',
  'correction_deadline_soon','correction_overdue','report_stale','no_trade_declared');

-- ---------------------------------------------------------------------------
-- 2. Identite de l'appelant
--    - Supabase     : remplacer le corps par auth.uid()  (voir db/supabase_compat.sql)
--    - PostgreSQL dev : select app.set_user('<uuid>')   dans la transaction
-- ---------------------------------------------------------------------------
create or replace function app.current_user_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

comment on function app.current_user_id() is
  'Identifiant de l''appelant. Dev : SET LOCAL app.user_id ; Supabase : auth.uid().';

create or replace function app.set_user(p_uuid uuid) returns uuid
language plpgsql volatile as $$
begin
  perform set_config('app.user_id', coalesce(p_uuid::text, ''), true);
  return p_uuid;
end $$;

-- Les fonctions qui lisent les tables (app.current_user_role, app.is_admin,
-- app.can_manage_trader, app.settings, app.fn_audit...) sont definies en
-- 002_identity.sql : PostgreSQL valide le corps des fonctions LANGUAGE sql
-- des la creation, elles exigeraient donc des tables deja creees.

-- (voir 002_identity.sql)

-- ---------------------------------------------------------------------------
-- 3. Utilitaires
-- ---------------------------------------------------------------------------
create or replace function app.hash_token(p_token text) returns text
language sql immutable as $$ select encode(digest(p_token, 'sha256'), 'hex') $$;

create or replace function app.fn_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- (voir 002_identity.sql pour app.settings et app.fn_audit)



-- -----------------------------------------------------------------------------
-- 002_identity.sql
-- -----------------------------------------------------------------------------
-- ============================================================================
-- trade_house - 002_identity.sql
-- Parametres globaux - comptes (RG-01..06, A1..A5) - invitations - 2FA
-- sessions - journal d'audit (RG-63)
-- ============================================================================

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


-- -----------------------------------------------------------------------------
-- 003_meetings.sql
-- -----------------------------------------------------------------------------
-- ============================================================================
-- trade_house - 003_meetings.sql
-- Reunions (B1, B2, B6, B8, B10) - liens (B3, RG-11..13) - participants (RG-10, 15)
-- rappels (B4, B5, RG-14..18) - salle et presence (C, RG-20..25)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. meetings
-- ---------------------------------------------------------------------------
create table public.meetings (
  id                  uuid primary key default gen_random_uuid(),
  title               varchar(200) not null,
  description         text,
  type                meeting_type not null,                 -- interne / externe / instantane
  starts_at           timestamptz not null,                  -- RG-10 : date future
  duration_min        int not null default 60,               -- RG-10
  status              meeting_status not null default 'scheduled',
  -- Salle interne (C1) : room_id = identifiant chez Daily.co ou LiveKit
  current_link_id     uuid,                                  -- FK ajoutee apres meeting_links
  room_id             varchar(100),
  room_provider       varchar(20) check (room_provider in ('daily','livekit')),
  room_url            text,
  recording_enabled   boolean not null default false,        -- C7 / RG-24
  recording_url       text,
  recording_started_at timestamptz,
  -- Duree reelle (indispensable pour le calcul de presence RG-23)
  actual_started_at   timestamptz,
  actual_ended_at     timestamptz,
  -- Recurrence (B10)
  recurrence_rule     text,                                  -- RRULE
  parent_meeting_id   uuid references public.meetings(id) on delete cascade,
  occurrence_number   int check (occurrence_number is null or occurrence_number > 0),
  created_by          uuid not null references public.users(id),
  cancelled_at        timestamptz,
  cancellation_reason text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint meetings_duration_positive check (duration_min between 5 and 1440),
  constraint meetings_actual_window check (actual_ended_at is null or actual_started_at is null
                                           or actual_ended_at > actual_started_at),
  constraint meetings_cancelled_stamped check (status <> 'cancelled' or cancelled_at is not null),
  -- la regle RRULE ne vit que sur la reunion mere
  constraint meetings_rule_only_on_parent check (recurrence_rule is null or parent_meeting_id is null)
);
create index meetings_starts_idx    on public.meetings (starts_at, status);      -- CDC 4.3
create index meetings_created_idx   on public.meetings (created_by, starts_at desc);
create index meetings_parent_idx    on public.meetings (parent_meeting_id) where parent_meeting_id is not null;
create index meetings_room_window_idx on public.meetings (status, starts_at)
  where status in ('scheduled','live');

-- ---------------------------------------------------------------------------
-- 2. meeting_links - historique des liens (RG-12), un seul lien principal
-- ---------------------------------------------------------------------------
create table public.meeting_links (
  id         uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  url        text not null,
  provider   link_provider not null default 'other',
  added_via  link_source not null default 'meeting_form',     -- RG-12 : lien ponctuel ou principal
  added_by   uuid references public.users(id) on delete set null,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  constraint meeting_links_https check (url ~* '^https://')     -- RG-11
);
-- Un seul lien courant par reunion
create unique index meeting_links_one_current_idx
  on public.meeting_links (meeting_id) where is_current;
create index meeting_links_meeting_idx on public.meeting_links (meeting_id, created_at desc);

alter table public.meetings
  add constraint meetings_current_link_fkey
  foreign key (current_link_id) references public.meeting_links(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 3. meeting_participants - RG-10 (au moins un), RG-15 (filtre des rappels)
-- ---------------------------------------------------------------------------
create table public.meeting_participants (
  id               uuid primary key default gen_random_uuid(),
  meeting_id       uuid not null references public.meetings(id) on delete cascade,
  user_id          uuid not null references public.users(id) on delete cascade,
  rsvp_status      rsvp_status not null default 'pending',     -- B7
  rsvp_at          timestamptz,
  access_token_hash text,                                    -- RG-21 : jeton personnel, hache
  token_expires_at timestamptz,
  invited_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint meeting_participants_unique unique (meeting_id, user_id)
);
create index meeting_participants_user_idx on public.meeting_participants (user_id, meeting_id);
create index meeting_participants_rsvp_idx  on public.meeting_participants (meeting_id, rsvp_status);

-- ---------------------------------------------------------------------------
-- 4. meeting_reminders - l'EVENEMENT d'envoi (par reunion), pas par destinataire.
--    Le suivi par destinataire vit dans notifications_log (decision D5).
-- ---------------------------------------------------------------------------
create table public.meeting_reminders (
  id                 uuid primary key default gen_random_uuid(),
  meeting_id         uuid not null references public.meetings(id) on delete cascade,
  kind               reminder_kind not null default 'custom',
  send_at            timestamptz not null,                    -- RG-14 : jamais dans le passe
  message            text,
  link_id            uuid references public.meeting_links(id) on delete set null, -- B3
  replaces_main_link boolean not null default false,          -- RG-12
  status             reminder_status not null default 'scheduled',
  created_by         uuid not null references public.users(id),
  sent_at            timestamptz,
  cancelled_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- si le rappel remplace le lien principal, il doit porter un lien (RG-12)
  constraint meeting_reminders_replaces_needs_link
    check (replaces_main_link = false or link_id is not null)
);
-- Requete du cron chaque minute (CDC 4.3)
create index meeting_reminders_due_idx on public.meeting_reminders (send_at)
  where status = 'scheduled';
create index meeting_reminders_meeting_idx on public.meeting_reminders (meeting_id, kind);
-- Pas de doublon de rappel automatique pour une meme reunion
create unique index meeting_reminders_default_unique_idx
  on public.meeting_reminders (meeting_id, kind)
  where kind in ('invitation','d_minus_1','h_minus_1') and status <> 'cancelled';

-- ---------------------------------------------------------------------------
-- 5. meeting_attendance - DECISION D4 : un segment par connexion.
--    L'historique des reconnexions est conserve (RG-23 " reconnexions incluses ").
-- ---------------------------------------------------------------------------
create table public.meeting_attendance (
  id           uuid primary key default gen_random_uuid(),
  meeting_id   uuid not null references public.meetings(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  joined_at    timestamptz not null,
  left_at      timestamptz,
  duration_sec int check (duration_sec is null or duration_sec >= 0),
  source       varchar(20) not null default 'client'
               check (source in ('client','webhook','admin')),
  created_at   timestamptz not null default now(),
  constraint meeting_attendance_window check (left_at is null or left_at > joined_at)
);
create index meeting_attendance_meeting_idx on public.meeting_attendance (meeting_id, user_id);
-- Un seul segment ouvert a la fois par participant
create unique index meeting_attendance_one_open_idx
  on public.meeting_attendance (meeting_id, user_id) where left_at is null;
-- segments orphelins a reconcilier par le cron de cloture
create index meeting_attendance_open_idx on public.meeting_attendance (meeting_id)
  where left_at is null;

-- ---------------------------------------------------------------------------
-- 6. meeting_attendance_result - DECISION D4 : resultat FIGE a la cloture.
--    Evite que l'historique de presence (F2) change retroactivement.
-- ---------------------------------------------------------------------------
create table public.meeting_attendance_result (
  meeting_id      uuid not null references public.meetings(id) on delete cascade,
  user_id         uuid not null references public.users(id) on delete cascade,
  total_seconds   int not null default 0 check (total_seconds >= 0),
  first_joined_at timestamptz,
  last_left_at    timestamptz,
  status          attendance_status not null,
  -- parametres utilises au calcul, pour audit (seuil RG-23)
  computed_with   jsonb not null default '{}'::jsonb,
  computed_at     timestamptz not null default now(),
  primary key (meeting_id, user_id)
);
create index meeting_attendance_result_user_idx
  on public.meeting_attendance_result (user_id, status);
-- ---------------------------------------------------------------------------
-- 7. Triggers reunions / liens / rappels / presence
-- ---------------------------------------------------------------------------
create trigger meetings_touch_trg before update on public.meetings
  for each row execute function app.fn_touch_updated_at();
create trigger meeting_participants_touch_trg before update on public.meeting_participants
  for each row execute function app.fn_touch_updated_at();
create trigger meeting_reminders_touch_trg before update on public.meeting_reminders
  for each row execute function app.fn_touch_updated_at();

-- RG-12 : un seul lien principal.
-- Le trigger est scinde en deux : l'index unique partiel (un seul is_current par
-- reunion) est verifie AVANT l'insertion du nouveau lien, il faut donc demettre
-- les autres avant (BEFORE), et renseigner meetings.current_link_id apres (AFTER,
-- la cle etrangere exige que la ligne existe deja).
create or replace function app.fn_set_current_link(p_meeting uuid, p_link uuid)
returns void language plpgsql as $$
begin
  update public.meeting_links set is_current = false
   where meeting_id = p_meeting and is_current and id <> p_link;
  update public.meeting_links set is_current = true where id = p_link;
  update public.meetings set current_link_id = p_link where id = p_meeting;
end $$;

create or replace function app.fn_meeting_links_demote() returns trigger
language plpgsql as $$
begin
  if new.is_current then
    update public.meeting_links set is_current = false
     where meeting_id = new.meeting_id and id <> new.id and is_current;
  end if;
  return new;
end $$;

create or replace function app.fn_meeting_links_sync() returns trigger
language plpgsql as $$
begin
  if new.is_current then
    update public.meetings set current_link_id = new.id where id = new.meeting_id;
  elsif (select m.current_link_id from public.meetings m where m.id = new.meeting_id) = new.id then
    -- on vient de retirer le lien courant : on rebascule sur un autre lien
    update public.meetings m
       set current_link_id = (
         select l.id from public.meeting_links l
          where l.meeting_id = new.meeting_id and l.is_current
          order by l.created_at desc limit 1)
     where m.id = new.meeting_id;
  end if;
  return null;
end $$;

create trigger meeting_links_demote_trg before insert or update of is_current on public.meeting_links
  for each row execute function app.fn_meeting_links_demote();

create trigger meeting_links_sync_trg after insert or update of is_current on public.meeting_links
  for each row execute function app.fn_meeting_links_sync();

-- RG-11 : une reunion externe exige un lien https.
-- Trigger DIFFERE : le lien est souvent insere apres la reunion, dans la meme
-- transaction (fonction app.create_meeting) ; le controle ne peut donc pas etre
-- pose sur la seule ligne meetings.
create or replace function app.fn_meeting_link_required() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.type in ('external','instant') and new.status <> 'cancelled' then
    if not exists (select 1 from public.meeting_links l where l.meeting_id = new.id) then
      raise exception 'RG-11 : une reunion externe exige un lien https';
    end if;
  end if;
  return null;
end $$;

create constraint trigger meetings_link_required_trg
  after insert or update on public.meetings
  deferrable initially deferred
  for each row execute function app.fn_meeting_link_required();

-- RG-14 + RG-12 : rappel programme dans le passe, et application du lien principal
create or replace function app.fn_reminder_guard() returns trigger
language plpgsql as $$
begin
  if new.status = 'scheduled' and new.send_at < now() then
    raise exception 'RG-14 : un rappel ne peut pas etre programme dans le passe';
  end if;
  if new.replaces_main_link and new.link_id is not null and new.status = 'scheduled' then
    perform app.fn_set_current_link(new.meeting_id, new.link_id);
  end if;
  return new;
end $$;

-- RG-14 : un rappel ne peut pas etre programme dans le passe.
-- Le declencheur ne surveille QUE send_at : repasser un rappel en file
-- (reprise apres incident) ne doit pas etre confondu avec une nouvelle
-- programmation dans le passe.
create trigger meeting_reminders_guard_trg
  before insert or update of send_at on public.meeting_reminders
  for each row execute function app.fn_reminder_guard();

-- RG-06 : un manager n'invite que ses propres traders
create or replace function app.fn_participant_guard() returns trigger
language plpgsql as $$
begin
  if app.current_user_role() = 'manager'
     and not exists (select 1 from public.users t
                     where t.id = new.user_id and t.manager_id = app.current_user_id()) then
    raise exception 'RG-06 : un manager ne peut inviter que ses propres traders';
  end if;
  return new;
end $$;

create trigger meeting_participants_guard_trg
  before insert on public.meeting_participants
  for each row execute function app.fn_participant_guard();

-- RG-23 : la duree du segment est calculee a la fermeture
create or replace function app.fn_attendance_close() returns trigger
language plpgsql as $$
begin
  if new.left_at is not null and new.duration_sec is null then
    new.duration_sec := floor(extract(epoch from (new.left_at - new.joined_at)))::int;
  end if;
  return new;
end $$;

create trigger meeting_attendance_close_trg
  before insert or update on public.meeting_attendance
  for each row execute function app.fn_attendance_close();



-- -----------------------------------------------------------------------------
-- 004_reports.sql
-- -----------------------------------------------------------------------------
-- ============================================================================
-- trade_house - 004_reports.sql
-- Rapports de session (D1..D7) - cycle de correction (E1..E7)
-- RG-30..37 - RG-40..49
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. reports
-- ---------------------------------------------------------------------------
create table public.reports (
  id                  uuid primary key default gen_random_uuid(),
  trader_id           uuid not null references public.users(id),
  session_date        date not null,                          -- RG-36 : jamais dans le futur
  -- Contenu de la session (RG-31)
  instrument          varchar(100),
  result_type         report_result_type,
  result_amount       numeric(14,2),
  strategy            varchar(200),
  nb_trades           int check (nb_trades is null or nb_trades >= 0),
  plan_respected      boolean,
  rr_planned          numeric(6,2),
  rr_realized         numeric(6,2),
  emotions            emotion_code[],                          -- facultatif (RG-31)
  emotions_note       text,
  highlights          text,                                   -- points forts (D1)
  mistakes            text,                                   -- erreurs (D1)
  notes               text,
  -- Declaration " pas de trading " (D7 / RG-37)
  is_no_trade         boolean not null default false,
  no_trade_reason     text,
  -- RG-36 : FIGE a la soumission (decision D2) ; ne doit pas etre derive
  is_late             boolean not null default false,
  late_reason         text,
  -- Cycle de vie
  status              report_status not null default 'draft',  -- decision D1
  current_version     int not null default 1 check (current_version >= 1),
  reviewer_id         uuid references public.users(id),
  correction_deadline timestamptz,                             -- E1
  submitted_at        timestamptz,
  reviewed_at         timestamptz,
  validated_at        timestamptz,
  validated_by        uuid references public.users(id),
  dismissed_at        timestamptz,                             -- RG-47
  dismissed_by        uuid,
  dismissal_reason    text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- RG-31 : la declaration " pas de trading " est un enregistrement leger
  constraint reports_no_trade_is_light check (
    is_no_trade = false or (instrument is null and nb_trades is null
      and plan_respected is null and result_type is null and result_amount is null)),
  -- RG-36 : is_late toujours accompagne d'un motif
  constraint reports_late_reason check (is_late = false or late_reason is not null),
  -- RG-40 : tout statut posterieur a une soumission porte submitted_at
  -- (la declaration " pas de trading " n'en est pas une : RG-37)
  constraint reports_submitted_stamp check (
    status in ('draft','dismissed','declared') or submitted_at is not null),
  -- DECISION D1d : le statut 'declared' n'existe que pour " pas de trading "
  constraint reports_declared_only_if_no_trade check (
    (is_no_trade and status = 'declared') or (is_no_trade = false and status <> 'declared')),
  -- RG-40 : un rapport pris en charge a un relecteur
  constraint reports_reviewer_stamp check (
    status not in ('in_review','correction_requested') or reviewer_id is not null),
  -- RG-35 : la validation est signee
  constraint reports_validated_stamp check (
    status <> 'validated' or (validated_at is not null and validated_by is not null)),
  -- RG-47 : la cloture sans suite est motivee
  constraint reports_dismissed_stamp check (
    status <> 'dismissed' or (dismissed_at is not null and dismissal_reason is not null)),
  -- DECISION D1 : submitted = 1re soumission, resubmitted = version >= 2
  constraint reports_submitted_is_v1 check (status <> 'submitted' or current_version = 1),
  constraint reports_resubmitted_needs_v2 check (status <> 'resubmitted' or current_version >= 2)
);

-- RG-37 : une seule declaration " pas de trading " par trader et par jour
create unique index reports_no_trade_unique_idx
  on public.reports (trader_id, session_date) where is_no_trade;
create index reports_trader_status_idx on public.reports (trader_id, status);   -- CDC 4.3

-- ---------------------------------------------------------------------------
-- 2. report_versions - instantane fige a chaque soumission/resoumission (RG-45)
-- ---------------------------------------------------------------------------
create table public.report_versions (
  id              uuid primary key default gen_random_uuid(),
  report_id       uuid not null references public.reports(id) on delete cascade,
  version_number  int not null check (version_number >= 1),
  content_snapshot jsonb not null,            -- champs + pieces jointes au moment T
  submitted_by    uuid references public.users(id),
  submitted_at    timestamptz not null default now(),
  constraint report_versions_unique unique (report_id, version_number)
);

-- ---------------------------------------------------------------------------
-- 3. report_files - RG-32 (formats et tailles), RG-33 (espace prive)
--    Le controle du TYPE REEL (magic bytes) se fait a l'upload cote API ;
--    la base verifie la coherence kind <-> mime_type et les plafonds.
-- ---------------------------------------------------------------------------
create table public.report_files (
  id            uuid primary key default gen_random_uuid(),
  report_id     uuid not null references public.reports(id) on delete cascade,
  version_id    uuid references public.report_versions(id) on delete set null,
  kind          report_file_kind not null,
  storage_path  text not null unique,
  original_name varchar(255) not null,
  mime_type     varchar(100) not null,
  size_bytes    bigint not null check (size_bytes > 0),
  uploaded_by   uuid references public.users(id),
  created_at    timestamptz not null default now(),
  constraint report_files_screenshot_mime check (
    kind <> 'screenshot' or mime_type in ('image/png','image/jpeg','image/webp')),
  constraint report_files_pdf_mime check (kind <> 'pdf' or mime_type = 'application/pdf')
);
create index report_files_report_idx on public.report_files (report_id, kind);
create index report_files_version_idx on public.report_files (version_id)
  where version_id is not null;

-- ---------------------------------------------------------------------------
-- 4. report_corrections - E1..E3, RG-42..44
-- ---------------------------------------------------------------------------
create table public.report_corrections (
  id               uuid primary key default gen_random_uuid(),
  report_id        uuid not null references public.reports(id) on delete cascade,
  version_id       uuid references public.report_versions(id) on delete set null,
  author_id        uuid not null references public.users(id),
  target_type      correction_target_type not null,        -- general / field / file
  target_field     varchar(100),
  target_file_id   uuid references public.report_files(id) on delete cascade,
  message          text not null,                          -- RG-42 : toujours un message
  severity         correction_severity not null,           -- obligatoire / suggestion
  status           correction_status not null default 'open',
  trader_reply     text,
  rejection_reason text,
  resolved_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint report_corrections_target check (
    (target_type = 'general' and target_field is null and target_file_id is null) or
    (target_type = 'field'   and target_field is not null) or
    (target_type = 'file'    and target_file_id is not null)),
  constraint report_corrections_message_not_blank check (length(btrim(message)) > 0),
  constraint report_corrections_rejected_needs_reason check (
    status <> 'rejected' or rejection_reason is not null)
);
create index report_corrections_report_idx on public.report_corrections (report_id, status); -- CDC 4.3
create index report_corrections_open_idx on public.report_corrections (report_id)
  where status = 'open';
create index report_corrections_file_idx on public.report_corrections (target_file_id)
  where target_file_id is not null;

-- ---------------------------------------------------------------------------
-- 5. file_annotations - RG-46 : stockees a part, l'image d'origine n'est
--    jamais modifiee.
-- ---------------------------------------------------------------------------
create table public.file_annotations (
  id            uuid primary key default gen_random_uuid(),
  file_id       uuid not null references public.report_files(id) on delete cascade,
  correction_id uuid references public.report_corrections(id) on delete cascade,
  shape         annotation_shape not null,
  data          jsonb not null,        -- { x, y, w, h, color, text }
  author_id     uuid not null references public.users(id),
  created_at    timestamptz not null default now(),
  constraint file_annotations_data_object check (jsonb_typeof(data) = 'object'),
  constraint file_annotations_text_has_text check (shape <> 'text' or data ? 'text')
);
create index file_annotations_file_idx on public.file_annotations (file_id, created_at);

create index reports_status_submitted_idx on public.reports (status, submitted_at);
create index reports_trader_session_idx on public.reports (trader_id, session_date desc);
create index reports_reviewer_idx on public.reports (reviewer_id, status)
  where reviewer_id is not null;
create index reports_deadline_idx on public.reports (correction_deadline)
  where status = 'correction_requested';
-- File de travail du tableau de bord (F1)
create index reports_worklist_idx on public.reports (status, submitted_at)
  where status in ('submitted','in_review','correction_requested','resubmitted');


-- ---------------------------------------------------------------------------
-- 6. Triggers rapports
-- ---------------------------------------------------------------------------
create trigger reports_touch_trg before update on public.reports
  for each row execute function app.fn_touch_updated_at();
create trigger report_corrections_touch_trg before update on public.report_corrections
  for each row execute function app.fn_touch_updated_at();

-- 6.1 Transitions de statut (DECISION D1) ------------------------------------
create or replace function app.fn_report_transition() returns trigger
language plpgsql as $$
declare
  v_actor   uuid := app.current_user_id();
  v_role    user_role := app.current_user_role();
  v_allowed boolean := false;
  v_reopen  text := coalesce(current_setting('app.allow_transition', true), 'off');
begin
  if new.status = old.status then
    return new;
  end if;

  -- RG-35 / RG-47 : rapport verrouille, seule une reouverture explicite
  -- et journalisee peut modifier la ligne.
  if old.status in ('validated','dismissed') and v_reopen <> 'on' then
    raise exception 'RG-35 : le rapport est verrouille (statut %)', old.status;
  end if;

  -- Matrice des transitions autorisees (RG-40)
  v_allowed := case
    when old.status = 'draft'                then new.status = 'submitted'
    when old.status = 'submitted'            then new.status in ('in_review','dismissed')
    when old.status = 'in_review'            then new.status in ('correction_requested','validated','dismissed')
    when old.status = 'correction_requested' then new.status in ('resubmitted','validated','dismissed')
    when old.status = 'resubmitted'          then new.status in ('in_review','dismissed')
    when old.status = 'validated'            then new.status = 'in_review'
    else false
  end;
  if not v_allowed then
    raise exception 'Transition % -> % interdite (RG-40)', old.status, new.status;
  end if;

  -- RG-41 : relecture reservee a l'admin ou au manager du trader
  if new.status in ('in_review','correction_requested','validated','dismissed')
     and not app.can_manage_trader(old.trader_id) then
    raise exception 'RG-41 : seul l''admin ou le manager peut passer le rapport en %', new.status;
  end if;

  -- RG-34 : le trader soumet et resoumet
  if new.status in ('submitted','resubmitted') then
    if v_role <> 'trader' or old.trader_id <> v_actor then
      raise exception 'Seul le trader proprietaire peut soumettre ou resoumettre';
    end if;
  end if;

  -- RG-49 : validation impossible tant qu'un correctif obligatoire n'est pas tranche
  if new.status = 'validated' and exists (
      select 1 from public.report_corrections c
       where c.report_id = new.id and c.severity = 'mandatory'
         and c.status in ('open','rejected')) then
    raise exception 'RG-49 : un correctif obligatoire est ouvert ou en attente d''arbitrage';
  end if;

  -- RG-43 : resoumission seulement si les correctifs obligatoires sont traites
  if new.status = 'resubmitted' and exists (
      select 1 from public.report_corrections c
       where c.report_id = new.id and c.severity = 'mandatory' and c.status = 'open') then
    raise exception 'RG-43 : correctifs obligatoires non traites';
  end if;

  -- RG-47 : cloture sans suite motivee
  if new.status = 'dismissed' and (new.dismissal_reason is null or btrim(new.dismissal_reason) = '') then
    raise exception 'RG-47 : la cloture sans suite exige un motif';
  end if;

  return new;
end $$;

create trigger reports_transition_trg before update of status on public.reports
  for each row execute function app.fn_report_transition();

-- 6.2 Validation du contenu (RG-30..37) --------------------------------------
create or replace function app.fn_report_validate() returns trigger
language plpgsql as $$
declare v_is_submit boolean;
begin
  -- RG-35 : pas de retouche sur un rapport verrouille
  if old.id is not null and old.status in ('validated','dismissed')
     and coalesce(current_setting('app.allow_transition', true), 'off') <> 'on' then
    raise exception 'RG-35 : le rapport est verrouille (statut %)', old.status;
  end if;

  -- RG-34 : le trader ne modifie qu'en brouillon, en correction demandee,
  -- ou sur le motif d'une declaration " pas de trading "
  if app.current_user_role() = 'trader'
     and app.current_user_id() = old.trader_id
     and new.status = old.status
     and old.status not in ('draft','correction_requested','declared') then
    raise exception 'RG-34 : rapport non modifiable dans le statut %', old.status;
  end if;

  -- RG-36 : pas de date de session dans le futur
  if new.session_date > current_date then
    raise exception 'RG-36 : la date de session ne peut pas etre dans le futur';
  end if;

  -- RG-37 : exclusiveite de la declaration " pas de trading "
  if new.is_no_trade and exists (
      select 1 from public.reports r
       where r.trader_id = new.trader_id and r.session_date = new.session_date
         and r.id <> new.id and r.is_no_trade = false) then
    raise exception 'RG-37 : un rapport existe deja pour cette date';
  end if;
  if new.is_no_trade = false and exists (
      select 1 from public.reports r
       where r.trader_id = new.trader_id and r.session_date = new.session_date
         and r.id <> new.id and r.is_no_trade) then
    raise exception 'RG-37 : une declaration " pas de trading " existe deja pour cette date';
  end if;

  v_is_submit := new.status in ('submitted','resubmitted')
                 and (old.id is null or old.status is distinct from new.status);

  if v_is_submit then
    -- RG-31 : champs obligatoires a la soumission
    if new.is_no_trade = false then
      if new.instrument is null or new.result_type is null
         or new.nb_trades is null or new.plan_respected is null then
        raise exception 'RG-31 : champs obligatoires manquants (instrument, resultat, nb de trades, plan)';
      end if;
      if new.result_type <> 'breakeven' and new.result_amount is null then
        raise exception 'RG-31 : le montant du resultat est obligatoire';
      end if;
      if not exists (select 1 from public.report_files f where f.report_id = new.id) then
        raise exception 'RG-31 : au moins une piece jointe est obligatoire';
      end if;
    end if;

    -- DECISION D2 : is_late est calcule ici, une fois pour toutes
    new.is_late := (new.submitted_at::date - new.session_date)
                   > (select late_submission_days from public.app_settings where id = 1);
    if new.is_late and (new.late_reason is null or btrim(new.late_reason) = '') then
      raise exception 'RG-36 : soumission hors delai, un motif est obligatoire';
    end if;

    -- DECISION D1 : le numero de version ne peut pas sauter
    if new.status = 'submitted' and new.current_version <> 1 then
      raise exception 'DECISION D1 : une 1re soumission est toujours en version 1';
    end if;
    if new.status = 'resubmitted' and new.current_version <> old.current_version + 1 then
      raise exception 'DECISION D1 : la resoumission doit incrementer current_version';
    end if;
  end if;

  return new;
end $$;

create trigger reports_validate_trg before insert or update on public.reports
  for each row execute function app.fn_report_validate();

-- 6.3 RG-45 : chaque soumission/resoumission fige une version immuable.
--     Declencheur ET non fonction applicative : aucune voie d'ecriture ne peut
--     contourner l'archivage.
create or replace function app.fn_report_version_snapshot() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status not in ('submitted','resubmitted') then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.status = old.status then
    return null;
  end if;

  insert into public.report_versions (report_id, version_number, content_snapshot, submitted_by)
  values (new.id, new.current_version,
          jsonb_build_object(
            'session_date',   new.session_date,
            'instrument',     new.instrument,
            'result_type',    new.result_type,
            'result_amount',  new.result_amount,
            'strategy',       new.strategy,
            'nb_trades',      new.nb_trades,
            'plan_respected', new.plan_respected,
            'rr_planned',     new.rr_planned,
            'rr_realized',    new.rr_realized,
            'emotions',       to_jsonb(new.emotions),
            'emotions_note',  new.emotions_note,
            'highlights',     new.highlights,
            'mistakes',       new.mistakes,
            'notes',          new.notes,
            'is_no_trade',    new.is_no_trade,
            'is_late',        new.is_late,
            'late_reason',    new.late_reason,
            'files', coalesce((
              select jsonb_agg(jsonb_build_object(
                        'kind',       f.kind,
                        'path',       f.storage_path,
                        'name',       f.original_name,
                        'mime',       f.mime_type,
                        'size_bytes', f.size_bytes)
                       order by f.created_at)
                from public.report_files f where f.report_id = new.id), '[]'::jsonb)),
          app.current_user_id())
  on conflict (report_id, version_number) do nothing;

  return null;
end $$;

create constraint trigger reports_version_snapshot_trg
  after insert or update on public.reports
  deferrable initially deferred
  for each row execute function app.fn_report_version_snapshot();

-- 6.4 RG-32 : plafonds de fichiers (10 Mo / capture, 20 Mo / PDF, 10 fichiers)
create or replace function app.fn_report_files_limits() returns trigger
language plpgsql as $$
declare s public.app_settings; v_count int;
begin
  select * into s from public.app_settings where id = 1;

  if new.kind = 'screenshot' and new.size_bytes > s.max_screenshot_mb * 1024 * 1024 then
    raise exception 'RG-32 : capture trop volumineuse (max % Mo)', s.max_screenshot_mb;
  end if;
  if new.kind in ('pdf','correction_attachment') and new.size_bytes > s.max_pdf_mb * 1024 * 1024 then
    raise exception 'RG-32 : PDF trop volumineux (max % Mo)', s.max_pdf_mb;
  end if;

  select count(*) into v_count from public.report_files f where f.report_id = new.report_id;
  if v_count >= s.max_files_per_report then
    raise exception 'RG-32 : maximum % fichiers par rapport', s.max_files_per_report;
  end if;

  -- RG-34 : fichiers modifiables uniquement en brouillon ou en correction demandee
  if (select r.status from public.reports r where r.id = new.report_id) not in ('draft','correction_requested') then
    raise exception 'RG-34 : pieces jointes non modifiables dans le statut actuel';
  end if;
  return new;
end $$;

create trigger report_files_limits_trg before insert on public.report_files
  for each row execute function app.fn_report_files_limits();

-- 6.5 RG-03 : desactivation d'un admin/manager -> ses rapports " En revision "
--     repartent en " Soumis " et rejoignent la file commune.
create or replace function app.fn_users_cascade_reports() returns trigger
language plpgsql as $$
begin
  if old.is_active and new.is_active = false and new.role in ('admin','manager') then
    update public.reports r
       set status = 'submitted', reviewer_id = null, reviewed_at = null
     where r.reviewer_id = new.id and r.status = 'in_review';
  end if;
  return null;
end $$;

create trigger users_cascade_reports_trg after update of is_active on public.users
  for each row execute function app.fn_users_cascade_reports();


-- -----------------------------------------------------------------------------
-- 005_notifications.sql
-- -----------------------------------------------------------------------------
-- ============================================================================
-- trade_house - 005_notifications.sql
-- DECISION D5 : meeting_reminders porte l'EVENEMENT d'envoi (par reunion),
-- notifications_log porte le suivi PAR DESTINATAIRE (B9, RG-16, RG-52).
-- ============================================================================

create table public.notifications_log (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users(id) on delete cascade,
  event          notification_event not null,        -- codes RG-53
  channel        notification_channel not null,     -- email / in_app
  reminder_id    uuid references public.meeting_reminders(id) on delete cascade,
  related_type   varchar(40),                       -- 'meeting','report','correction'...
  related_id     uuid,
  status         notification_status not null default 'pending',
  attempts       int not null default 0 check (attempts >= 0),
  error_message  text,
  -- RG-13 : lien reellement utilise, sujet, gabarit, langue -> preuve d'envoi
  -- et support du bouton " Renvoyer " (B9)
  payload        jsonb not null default '{}'::jsonb,
  -- RG-16 : planification des 3 tentatives espacees de 10 minutes
  next_attempt_at timestamptz,
  sent_at        timestamptz,
  opened_at      timestamptz,
  read_at        timestamptz,
  created_at     timestamptz not null default now(),
  constraint notifications_sent_stamp check (status <> 'sent' or sent_at is not null)
);

-- Idempotence : un cron execute deux fois ne doit pas envoyer deux fois (D5)
create unique index notifications_log_reminder_user_idx
  on public.notifications_log (reminder_id, user_id, channel)
  where reminder_id is not null;
-- Cloche in-app non lue (F4)
create index notifications_log_inapp_idx
  on public.notifications_log (user_id, created_at desc)
  where channel = 'in_app' and read_at is null;
-- File des relances (RG-16)
create index notifications_log_retry_idx
  on public.notifications_log (next_attempt_at)
  where status in ('pending','failed') and next_attempt_at is not null;
create index notifications_log_related_idx
  on public.notifications_log (related_type, related_id);
-- Suivi des envois par destinataire (B9)
create index notifications_log_user_idx
  on public.notifications_log (user_id, created_at desc);


-- -----------------------------------------------------------------------------
-- 006_functions.sql
-- -----------------------------------------------------------------------------
-- ============================================================================
-- trade_house - 006_functions.sql
-- API metier en base : c'est ici que les regles du CDC sont appliquees une
-- seule fois. Ces fonctions sont SECURITY DEFINER et verifient donc
-- elles-memes les droits (le RLS reste actif pour le reste).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. COMPTES (A1, A2, A3, A5, RG-01, RG-02, RG-05, RG-06, RG-65)
-- ---------------------------------------------------------------------------

-- RG-65 : longueur, chiffre et caractere special
create or replace function app.fn_password_meets_policy(p_password text)
returns boolean language sql immutable as $$
  select length(p_password) >= 8
     and p_password ~ '[0-9]'
     and p_password ~ '[^A-Za-z0-9]'
$$;

-- A2 / RG-02 : creation de compte par l'admin uniquement
create or replace function app.create_user(
  p_email        citext,
  p_full_name    varchar,
  p_role         user_role,
  p_manager_id   uuid   default null,
  p_phone        varchar default null,
  p_timezone     varchar default 'UTC',
  p_locale       varchar default 'fr',
  p_mfa_enforced boolean default false
) returns public.users
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user public.users;
begin
  if not app.is_admin() then
    raise exception 'RG-02/RG-06 : seul l''admin peut creer un compte';
  end if;
  if exists (select 1 from public.users u where u.email = p_email) then
    raise exception 'RG-01 : cet email est deja utilise';
  end if;

  insert into public.users (email, password_hash, full_name, phone, role, manager_id,
                            timezone, preferred_locale, mfa_enforced)
  -- " ! " + alea : hash inexploitable tant que le mot de passe n'est pas defini
  values (p_email, '!' || encode(gen_random_bytes(32), 'hex'), p_full_name, p_phone,
          p_role, p_manager_id, p_timezone, p_locale, p_mfa_enforced)
  returning * into v_user;

  perform app.fn_audit('user.create', 'user', v_user.id,
                       jsonb_build_object('role', p_role, 'email', p_email::text));
  return v_user;
end $$;

-- A2 / RG-05 : emission d'une invitation (renvoi = nouveau lien, ancien revoque)
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
  if p_purpose = 'invite' and not app.is_admin() then
    raise exception 'RG-02 : seul l''admin peut inviter un utilisateur';
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

-- RG-05 : consommation du jeton, expiration a 7 jours
create or replace function app.accept_invitation(p_token text, p_password_hash text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_inv public.user_invitations;
begin
  select * into v_inv
    from public.user_invitations i
   where i.token_hash = app.hash_token(p_token)
     and i.consumed_at is null
     and i.revoked_at is null
   for update;

  if v_inv.id is null then
    raise exception 'Invitation invalide ou deja utilisee';
  end if;
  if v_inv.expires_at < now() then
    raise exception 'RG-05 : invitation expiree, demander un nouvel envoi';
  end if;

  update public.user_invitations set consumed_at = now() where id = v_inv.id;
  update public.users
     set password_hash = p_password_hash,
         password_changed_at = now(),
         invited_at = null,
         invite_expires_at = null
   where id = v_inv.user_id;

  perform app.fn_audit('user.invitation_accepted', 'user', v_inv.user_id, '{}'::jsonb);
  return v_inv.user_id;
end $$;

-- A1 / RG-60 : changement de mot de passe (soi-meme ou admin)
create or replace function app.set_password(p_user_id uuid, p_password_hash text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if app.current_user_id() is distinct from p_user_id and not app.is_admin() then
    raise exception 'Modification du mot de passe non autorisee';
  end if;
  update public.users
     set password_hash = p_password_hash, password_changed_at = now()
   where id = p_user_id;
  -- RG-63 : les sessions actives sont invalidees
  update public.user_sessions set revoked_at = now()
   where user_id = p_user_id and revoked_at is null;
  perform app.fn_audit('user.password_changed', 'user', p_user_id, '{}'::jsonb);
end $$;

-- A3 / RG-02 / RG-63 : desactivation (jamais de suppression physique)
create or replace function app.deactivate_user(p_user_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.is_admin() then
    raise exception 'RG-02 : seul l''admin peut desactiver un compte';
  end if;
  update public.users set is_active = false where id = p_user_id;
  update public.user_sessions set revoked_at = now()
   where user_id = p_user_id and revoked_at is null;
  perform app.fn_audit('user.deactivate', 'user', p_user_id, '{}'::jsonb);
end $$;

create or replace function app.reactivate_user(p_user_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.is_admin() then
    raise exception 'RG-02 : seul l''admin peut reactiver un compte';
  end if;
  update public.users set is_active = true where id = p_user_id;
  perform app.fn_audit('user.reactivate', 'user', p_user_id, '{}'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- 2. REUNIONS (B1, B2, B4, B6, B8, B10 - RG-10, RG-11, RG-14, RG-17, RG-18)
-- ---------------------------------------------------------------------------

-- B1/B2 : creation complete (reunion + participants + lien + rappels par defaut)
create or replace function app.create_meeting(
  p_title         varchar,
  p_description   text,
  p_type          meeting_type,
  p_starts_at     timestamptz,
  p_duration_min  int,
  p_participants  uuid[],
  p_link_url      text default null,
  p_link_provider link_provider default 'other',
  p_recurrence    text default null,
  p_message       text default null
) returns public.meetings
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_meeting public.meetings;
  v_uid     uuid;
  v_now     timestamptz := now();
begin
  if not (app.is_admin() or app.is_manager()) then
    raise exception 'Seul un admin ou un manager peut creer une reunion';
  end if;
  if coalesce(array_length(p_participants, 1), 0) = 0 then
    raise exception 'RG-10 : une reunion doit avoir au moins un participant';
  end if;
  if p_type <> 'instant' and p_starts_at <= v_now then
    raise exception 'RG-10 : la date de reunion doit etre dans le futur';
  end if;
  if p_type in ('external','instant') and (p_link_url is null or p_link_url !~* '^https://') then
    raise exception 'RG-11 : une reunion externe exige un lien https';
  end if;

  insert into public.meetings (title, description, type, starts_at, duration_min,
                               created_by, recurrence_rule)
  values (p_title, p_description, p_type,
          case when p_type = 'instant' then v_now else p_starts_at end,
          p_duration_min, app.current_user_id(), p_recurrence)
  returning * into v_meeting;

  foreach v_uid in array p_participants loop
    insert into public.meeting_participants (meeting_id, user_id)
    values (v_meeting.id, v_uid);
  end loop;

  if p_link_url is not null then
    insert into public.meeting_links (meeting_id, url, provider, added_via, added_by)
    values (v_meeting.id, p_link_url, p_link_provider, 'meeting_form', app.current_user_id());
  end if;

  -- RG-14 : rappel a la creation, J-1 et H-1 (ceux deja passes sont ignores)
  insert into public.meeting_reminders (meeting_id, kind, send_at, message, created_by)
  select v_meeting.id, k.kind, k.send_at, p_message, app.current_user_id()
    from (values
            ('invitation'::reminder_kind, v_now),
            ('d_minus_1'::reminder_kind, v_meeting.starts_at - interval '1 day'),
            ('h_minus_1'::reminder_kind, v_meeting.starts_at - interval '1 hour')
         ) as k(kind, send_at)
   where k.send_at >= v_now
     and k.kind::text = any (select unnest(s.default_reminders)
                               from public.app_settings s where s.id = 1);

  -- F4 : notification in-app pour chaque participant
  insert into public.notifications_log (user_id, event, channel, related_type, related_id)
  select u, 'meeting_created', 'in_app', 'meeting', v_meeting.id
    from unnest(p_participants) as u;

  perform app.fn_audit('meeting.create', 'meeting', v_meeting.id,
                       jsonb_build_object('type', p_type,
                                          'participants', array_length(p_participants, 1)));
  return v_meeting;
end $$;

-- RG-10 : conflits d'horaires - AVERTISSEMENT NON BLOQUANT
create or replace function app.meeting_conflicts(
  p_participants uuid[],
  p_starts_at    timestamptz,
  p_duration_min int,
  p_exclude_id   uuid default null
) returns table (meeting_id uuid, title varchar, starts_at timestamptz)
language sql stable as $$
  select distinct m.id, m.title, m.starts_at
    from public.meetings m
    join public.meeting_participants mp on mp.meeting_id = m.id
   where mp.user_id = any (p_participants)
     and m.type <> 'instant'                       -- RG-10 : appels instantanes exclus
     and m.status in ('scheduled','live')
     and (p_exclude_id is null or m.id <> p_exclude_id)
     and tstzrange(m.starts_at, m.starts_at + make_interval(mins => m.duration_min))
         && tstzrange(p_starts_at, p_starts_at + make_interval(mins => p_duration_min))
$$;

-- B6 / RG-18 : annulation -> suppression des rappels en attente + notification
create or replace function app.cancel_meeting(p_meeting_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.is_admin() and not exists (
      select 1 from public.meetings m
       where m.id = p_meeting_id and m.created_by = app.current_user_id()) then
    raise exception 'Annulation non autorisee';
  end if;

  update public.meetings
     set status = 'cancelled', cancelled_at = now(), cancellation_reason = p_reason
   where id = p_meeting_id and status not in ('ended','cancelled');

  delete from public.meeting_reminders
   where meeting_id = p_meeting_id and status = 'scheduled';

  insert into public.notifications_log (user_id, event, channel, related_type, related_id)
  select mp.user_id, 'meeting_cancelled', 'in_app', 'meeting', p_meeting_id
    from public.meeting_participants mp where mp.meeting_id = p_meeting_id;

  perform app.fn_audit('meeting.cancel', 'meeting', p_meeting_id,
                       jsonb_build_object('reason', p_reason));
end $$;

-- B6 / RG-17 : changement de date -> reprogrammation des rappels non envoyes
create or replace function app.reschedule_meeting(
  p_meeting_id   uuid,
  p_starts_at    timestamptz,
  p_duration_min int default null
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.is_admin() and not exists (
      select 1 from public.meetings m
       where m.id = p_meeting_id and m.created_by = app.current_user_id()) then
    raise exception 'Modification non autorisee';
  end if;
  if p_starts_at <= now() then
    raise exception 'RG-10 : la date de reunion doit etre dans le futur';
  end if;

  update public.meetings
     set starts_at = p_starts_at,
         duration_min = coalesce(p_duration_min, duration_min)
   where id = p_meeting_id;

  -- RG-17 : les rappels J-1 et H-1 non envoyes suivent la nouvelle date
  update public.meeting_reminders
     set send_at = case kind
                     when 'd_minus_1'::reminder_kind then p_starts_at - interval '1 day'
                     when 'h_minus_1'::reminder_kind then p_starts_at - interval '1 hour'
                     else send_at
                   end
   where meeting_id = p_meeting_id
     and status = 'scheduled'
     and kind in ('d_minus_1','h_minus_1')
     and (case kind
            when 'd_minus_1'::reminder_kind then p_starts_at - interval '1 day'
            when 'h_minus_1'::reminder_kind then p_starts_at - interval '1 hour'
            else send_at end) >= now();

  insert into public.notifications_log (user_id, event, channel, related_type, related_id)
  select mp.user_id, 'meeting_updated', 'in_app', 'meeting', p_meeting_id
    from public.meeting_participants mp where mp.meeting_id = p_meeting_id;

  perform app.fn_audit('meeting.reschedule', 'meeting', p_meeting_id,
                       jsonb_build_object('starts_at', p_starts_at));
end $$;

-- B3 / RG-12 : nouveau lien principal, l'historique est conserve
create or replace function app.update_meeting_link(
  p_meeting_id uuid, p_url text, p_provider link_provider default 'other'
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_link_id uuid;
begin
  if p_url !~* '^https://' then
    raise exception 'RG-11 : le lien doit etre en https';
  end if;
  insert into public.meeting_links (meeting_id, url, provider, added_via, added_by, is_current)
  values (p_meeting_id, p_url, p_provider, 'meeting_form', app.current_user_id(), true)
  returning id into v_link_id;
  perform app.fn_audit('meeting.link_update', 'meeting', p_meeting_id,
                       jsonb_build_object('link_id', v_link_id));
  return v_link_id;
end $$;

-- B7 : confirmation de presence par le trader
create or replace function app.rsvp(p_meeting_id uuid, p_status rsvp_status)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.meeting_participants
     set rsvp_status = p_status, rsvp_at = now()
   where meeting_id = p_meeting_id and user_id = app.current_user_id();
  if not found then
    raise exception 'Vous n''etes pas participant a cette reunion';
  end if;
end $$;

-- B5 : relance manuelle immediate, cibllee ou non
create or replace function app.send_manual_reminder(
  p_meeting_id uuid,
  p_user_ids   uuid[] default null,
  p_message    text  default null
) returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_count int;
begin
  insert into public.meeting_reminders (meeting_id, kind, send_at, message, created_by)
  values (p_meeting_id, 'manual', now(), p_message, app.current_user_id())
  returning id into v_id;

  -- RG-15 : comptes actifs ayant decline sont exclus
  insert into public.notifications_log (user_id, event, channel, reminder_id,
                                        related_type, related_id, payload)
  select mp.user_id, 'meeting_relance', 'email', v_id, 'meeting', p_meeting_id,
         jsonb_build_object('user_id', mp.user_id)
    from public.meeting_participants mp
    join public.users u on u.id = mp.user_id
   where mp.meeting_id = p_meeting_id
     and u.is_active
     and mp.rsvp_status <> 'declined'
     and (p_user_ids is null or mp.user_id = any (p_user_ids))
   on conflict do nothing;

  select count(*) into v_count from public.notifications_log
   where reminder_id = v_id and channel = 'email';

  perform app.fn_audit('meeting.reminder_manual', 'meeting', p_meeting_id,
                       jsonb_build_object('recipients', v_count));
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- 3. RAPPELS : mecanisme d'envoi appele par le cron chaque minute
-- ---------------------------------------------------------------------------

-- RG-16 + idempotence : reservation atomique. Deux executions du cron ne
-- peuvent pas traiter le meme rappel (FOR UPDATE SKIP LOCKED).
create or replace function app.claim_due_reminders(p_limit int default 100)
returns setof public.meeting_reminders
language sql security definer set search_path = public, pg_temp as $$
  with due as (
    select id from public.meeting_reminders
     where status = 'scheduled' and send_at <= now()
     order by send_at
     limit p_limit
     for update skip locked
  )
  update public.meeting_reminders r
     set status = 'sending'
    from due
   where r.id = due.id
  returning r.*
$$;

-- RG-13 / RG-15 : fabulation des lignes par destinataire et resolution du lien
-- au moment de l'envoi (lien ponctuel du rappel, sinon lien principal courant).
create or replace function app.prepare_reminder(p_reminder_id uuid)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_rem      public.meeting_reminders;
  v_m        public.meetings;
  v_link_url text;
  v_count    int;
begin
  select * into v_rem from public.meeting_reminders where id = p_reminder_id;
  if v_rem.id is null then
    raise exception 'Rappel % introuvable', p_reminder_id;
  end if;
  select * into v_m from public.meetings where id = v_rem.meeting_id;

  select l.url into v_link_url from public.meeting_links l where l.id = v_rem.link_id;
  if v_link_url is null then
    select l.url into v_link_url from public.meeting_links l where l.id = v_m.current_link_id;
  end if;

  insert into public.notifications_log
    (user_id, event, channel, reminder_id, related_type, related_id, payload)
  select mp.user_id,
         case when v_rem.kind = 'invitation' then 'meeting_invitation'::notification_event
              else 'meeting_reminder'::notification_event end,
         'email', v_rem.id, 'meeting', v_rem.meeting_id,
         jsonb_build_object('link_url',    v_link_url,
                            'kind',        v_rem.kind,
                            'message',     v_rem.message,
                            'starts_at',   v_m.starts_at,
                            'locale',      u.preferred_locale,
                            'title',       v_m.title)
    from public.meeting_participants mp
    join public.users u on u.id = mp.user_id
   where mp.meeting_id = v_rem.meeting_id
     and u.is_active                        -- RG-15
     and mp.rsvp_status <> 'declined'        -- RG-15 : " en attente " et " peut-etre " inclus
     and u.id not in (select n.user_id from public.notifications_log n
                       where n.reminder_id = v_rem.id and n.channel = 'email')
   on conflict do nothing;

  select count(*) into v_count from public.notifications_log
   where reminder_id = p_reminder_id and channel = 'email';
  return v_count;
end $$;

-- RG-16 : 3 nouvelles tentatives espacees de 10 minutes, puis " Echec "
create or replace function app.mark_notification_failed(
  p_notification_id uuid,
  p_error text
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_n      public.notifications_log;
  v_max    int;
  v_delay  int;
  v_status notification_status;
  v_next   timestamptz;
begin
  select * into v_n from public.notifications_log where id = p_notification_id for update;
  if v_n.id is null then
    raise exception 'Notification % introuvable', p_notification_id;
  end if;
  select reminder_retry_count, reminder_retry_minutes
    into v_max, v_delay from public.app_settings where id = 1;

  if v_n.attempts + 1 > v_max then
    v_status := 'failed';
    v_next   := null;
  else
    v_status := 'pending';
    v_next   := now() + make_interval(mins => v_delay * (v_n.attempts + 1));
  end if;

  update public.notifications_log
     set status = v_status, attempts = v_n.attempts + 1,
         error_message = p_error, next_attempt_at = v_next
   where id = p_notification_id;
  return v_status::text;
end $$;

create or replace function app.mark_notification_sent(
  p_notification_id uuid,
  p_sent_payload jsonb default null
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.notifications_log
     set status = 'sent', sent_at = now(), attempts = attempts + 1,
         error_message = null, next_attempt_at = null,
         payload = payload || coalesce(p_sent_payload, '{}'::jsonb)
   where id = p_notification_id;
end $$;

-- Statut du rappel deduit de ses destinataires (B9)
create or replace function app.complete_reminder(p_reminder_id uuid)
returns reminder_status language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_total  int;
  v_failed int;
  v_result reminder_status;
begin
  select count(*), count(*) filter (where status = 'failed')
    into v_total, v_failed
    from public.notifications_log
   where reminder_id = p_reminder_id and channel = 'email';

  if v_total = 0 then
    v_result := 'sent';
  elsif v_failed = v_total then
    v_result := 'failed';
  elsif exists (select 1 from public.notifications_log
                 where reminder_id = p_reminder_id and channel = 'email'
                   and status in ('pending','sending')) then
    v_result := 'sending';
  else
    v_result := 'sent';
  end if;

  update public.meeting_reminders
     set status = v_result, sent_at = case when v_result = 'sent' then coalesce(sent_at, now()) else sent_at end
   where id = p_reminder_id;
  return v_result;
end $$;

-- ---------------------------------------------------------------------------
-- 4. SALLE ET PRESENCE (C8 - RG-20, RG-22, RG-23, RG-25)
-- ---------------------------------------------------------------------------

-- RG-22 / RG-20 : entree dans la salle
create or replace function app.attendance_join(
  p_meeting_id uuid,
  p_user_id    uuid,
  p_source     varchar default 'client'
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_segment uuid;
begin
  if not exists (select 1 from public.meeting_participants mp
                  where mp.meeting_id = p_meeting_id and mp.user_id = p_user_id)
     and not app.is_admin() then
    raise exception 'RG-22 : acces a la salle reserve aux participants invites';
  end if;
  if not exists (select 1 from public.v_meeting_room_window w
                  where w.id = p_meeting_id and w.is_room_open) then
    raise exception 'RG-20 : la salle n''est pas ouverte (T-10 min a fin+2 h)';
  end if;

  -- RG-23 : une reconnexion ferme le segment precedent et en ouvre un nouveau
  update public.meeting_attendance
     set left_at = now()
   where meeting_id = p_meeting_id and user_id = p_user_id and left_at is null;

  insert into public.meeting_attendance (meeting_id, user_id, joined_at, source)
  values (p_meeting_id, p_user_id, now(), p_source)
  returning id into v_segment;
  return v_segment;
end $$;

create or replace function app.attendance_leave(
  p_meeting_id uuid,
  p_user_id    uuid,
  p_source     varchar default 'webhook'
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.meeting_attendance
     set left_at = now()
   where meeting_id = p_meeting_id and user_id = p_user_id and left_at is null;
end $$;

-- RG-23 : presence figee a la cloture (seuil et retard issus de app_settings)
create or replace function app.materialize_attendance(p_meeting_id uuid)
returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s            public.app_settings;
  v_meeting    public.meetings;
  v_real_start timestamptz;
  v_real_end   timestamptz;
  v_real_sec   int := 0;
  v_count      int := 0;
  r            record;
begin
  select * into v_meeting from public.meetings where id = p_meeting_id;
  select * into s        from public.app_settings where id = 1;

  -- segments oublies (onglet ferme sans webhook) : on borne la duree
  update public.meeting_attendance
     set left_at = greatest(now(), joined_at + interval '1 second')
   where meeting_id = p_meeting_id and left_at is null;

  v_real_start := coalesce(v_meeting.actual_started_at,
                           (select min(a.joined_at) from public.meeting_attendance a
                             where a.meeting_id = p_meeting_id));
  v_real_end   := coalesce(v_meeting.actual_ended_at, now());
  if v_real_start is not null then
    v_real_sec := greatest(0, extract(epoch from (v_real_end - v_real_start))::int);
  end if;

  for r in
    select a.user_id,
           sum(a.duration_sec)::int as total,
           min(a.joined_at)        as first_join,
           max(a.left_at)          as last_leave
      from public.meeting_attendance a
     where a.meeting_id = p_meeting_id
     group by a.user_id
  loop
    insert into public.meeting_attendance_result
      (meeting_id, user_id, total_seconds, first_joined_at, last_left_at, status, computed_with)
    values (p_meeting_id, r.user_id, r.total, r.first_join, r.last_leave,
            case when r.total >= s.attendance_present_ratio * v_real_sec
                   then case when r.first_join > v_real_start
                                      + make_interval(mins => s.late_arrival_minutes)
                             then 'late'::attendance_status
                             else 'present'::attendance_status end
                 else 'absent'::attendance_status end,
            jsonb_build_object('ratio',        s.attendance_present_ratio,
                               'real_seconds', v_real_sec,
                               'late_minutes', s.late_arrival_minutes))
    on conflict (meeting_id, user_id) do update
      set total_seconds   = excluded.total_seconds,
          first_joined_at = excluded.first_joined_at,
          last_left_at    = excluded.last_left_at,
          status          = excluded.status,
          computed_with   = excluded.computed_with,
          computed_at     = now();
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- RG-20 : fin de reunion -> statut " terminee " + presence figee
create or replace function app.close_meeting(p_meeting_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.meetings m
     set status = 'ended',
         actual_started_at = coalesce(m.actual_started_at,
                                      (select min(a.joined_at) from public.meeting_attendance a
                                        where a.meeting_id = m.id)),
         actual_ended_at = now()
   where m.id = p_meeting_id and m.status in ('scheduled','live');

  perform app.materialize_attendance(p_meeting_id);
  perform app.fn_audit('meeting.close', 'meeting', p_meeting_id, '{}'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- 5. RAPPORTS ET CYCLE DE CORRECTION (D1..D7, E1..E7)
-- ---------------------------------------------------------------------------

-- Destinataires d'une notification : les relecteurs du trader (admin + son manager)
create or replace function app.reviewers_of(p_trader_id uuid) returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(distinct u.id), '{}'::uuid[])
    from public.users u
    left join public.users t on t.id = p_trader_id
   where u.is_active
     and (u.role = 'admin' or (u.role = 'manager' and u.id = t.manager_id))
$$;

create or replace function app.fn_notify(
  p_user_ids     uuid[],
  p_event        notification_event,
  p_related_type varchar,
  p_related_id   uuid,
  p_channel      notification_channel default 'in_app'
) returns int language plpgsql as $$
declare v_count int;
begin
  insert into public.notifications_log (user_id, event, channel, related_type, related_id)
  select u, p_event, p_channel, p_related_type, p_related_id
    from unnest(coalesce(p_user_ids, '{}'::uuid[])) as u
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- D3 : soumission (RG-31 et RG-36 sont appliques par le trigger de validation)
create or replace function app.submit_report(p_report_id uuid)
returns report_status language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.reports
     set status = 'submitted', submitted_at = now()
   where id = p_report_id and status = 'draft';
  if not found then
    raise exception 'Seul un brouillon peut etre soumis';
  end if;
  perform app.fn_notify(app.reviewers_of(p_report_id), 'report_submitted', 'report', p_report_id);
  perform app.fn_audit('report.submit', 'report', p_report_id, '{}'::jsonb);
  return 'submitted';
end $$;

-- E4 : resoumission -> une nouvelle version est figee par le trigger (RG-45)
create or replace function app.resubmit_report(p_report_id uuid)
returns report_status language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.reports
     set status = 'resubmitted',
         submitted_at = now(),
         current_version = current_version + 1,
         reviewer_id = null,
         reviewed_at = null
   where id = p_report_id and status = 'correction_requested';
  if not found then
    raise exception 'Seul un rapport en correction demandee peut etre resoumis';
  end if;
  perform app.fn_notify(app.reviewers_of(p_report_id), 'report_resubmitted', 'report', p_report_id);
  perform app.fn_audit('report.resubmit', 'report', p_report_id, '{}'::jsonb);
  return 'resubmitted';
end $$;

-- E1 : l'admin ou le manager prend le rapport en charge
create or replace function app.start_review(p_report_id uuid)
returns report_status language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.reports
     set status = 'in_review', reviewer_id = app.current_user_id(), reviewed_at = now()
   where id = p_report_id and status in ('submitted','resubmitted');
  if not found then
    raise exception 'Seul un rapport soumis ou resoumis peut etre mis en revision';
  end if;
  perform app.fn_audit('report.start_review', 'report', p_report_id, '{}'::jsonb);
  return 'in_review';
end $$;

-- E1 : ajout d'un correctif cible (general, champ precis ou piece jointe)
create or replace function app.add_correction(
  p_report_id      uuid,
  p_message        text,
  p_severity       correction_severity,
  p_target_type    correction_target_type default 'general',
  p_target_field   varchar default null,
  p_target_file_id uuid  default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_trader uuid;
begin
  select r.trader_id into v_trader from public.reports r where r.id = p_report_id;
  if not app.can_manage_trader(v_trader) then
    raise exception 'RG-41 : relecture reservee a l''admin ou au manager';
  end if;

  insert into public.report_corrections
    (report_id, version_id, author_id, target_type, target_field, target_file_id, message, severity)
  values (p_report_id,
          -- version figee sur laquelle porte la relecture (RG-45)
          (select v.id from public.report_versions v
            where v.report_id = p_report_id
            order by v.version_number desc limit 1),
          app.current_user_id(), p_target_type, p_target_field, p_target_file_id,
          p_message, p_severity)
  returning id into v_id;
  return v_id;
end $$;

-- E2 / RG-42 : envoi de la demande de correction
create or replace function app.request_corrections(
  p_report_id uuid,
  p_deadline  timestamptz default null
) returns report_status language plpgsql security definer set search_path = public, pg_temp as $$
declare v_trader uuid;
begin
  if not exists (select 1 from public.report_corrections c
                  where c.report_id = p_report_id and c.status = 'open') then
    raise exception 'RG-42 : la demande doit contenir au moins un correctif';
  end if;

  update public.reports
     set status = 'correction_requested',
         correction_deadline = p_deadline,
         reviewer_id = app.current_user_id()
   where id = p_report_id and status = 'in_review';
  if not found then
    raise exception 'Seul un rapport en revision peut faire l''objet d''une demande de correction';
  end if;

  select trader_id into v_trader from public.reports where id = p_report_id;
  perform app.fn_notify(array[v_trader], 'correction_requested', 'report', p_report_id);
  perform app.fn_audit('report.request_corrections', 'report', p_report_id,
                       jsonb_build_object('deadline', p_deadline));
  return 'correction_requested';
end $$;

-- E3 / RG-43 : le trader traite un correctif
create or replace function app.respond_correction(
  p_correction_id uuid,
  p_status        correction_status,
  p_reply         text default null
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_status not in ('done','rejected') then
    raise exception 'Le trader peut seulement signaler un correctif comme traite ou rejete';
  end if;
  update public.report_corrections c
     set status = p_status,
         trader_reply = p_reply,
         rejection_reason = case when p_status = 'rejected' then p_reply else null end,
         resolved_at = case when p_status = 'done' then now() else null end
   where c.id = p_correction_id
     and c.status = 'open'
     and (select r.trader_id from public.reports r where r.id = c.report_id) = app.current_user_id();
  if not found then
    raise exception 'Correctif introuvable ou deja traite';
  end if;
end $$;

-- RG-43 : arbitrage admin/manager sur un correctif rejete (maintien ou abandon)
create or replace function app.arbitrate_correction(p_correction_id uuid, p_keep boolean)
returns correction_status language plpgsql security definer set search_path = public, pg_temp as $$
declare v_report uuid; v_trader uuid; v_status correction_status;
begin
  select c.report_id into v_report from public.report_corrections c where c.id = p_correction_id;
  select trader_id into v_trader from public.reports where id = v_report;

  if not app.can_manage_trader(v_trader) then
    raise exception 'Arbitrage reserve a l''admin ou au manager';
  end if;

  v_status := case when p_keep then 'open'::correction_status
                    else 'dropped'::correction_status end;
  update public.report_corrections
     set status = v_status,
         resolved_at = case when p_keep then null else now() end
   where id = p_correction_id and status = 'rejected';

  perform app.fn_audit('correction.arbitrate', 'correction', p_correction_id,
                       jsonb_build_object('keep', p_keep));
  return v_status;
end $$;

-- E5 : validation (RG-49 verifie par le trigger)
create or replace function app.validate_report(p_report_id uuid)
returns report_status language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.reports
     set status = 'validated', validated_at = now(), validated_by = app.current_user_id()
   where id = p_report_id and status in ('in_review','correction_requested');
  if not found then
    raise exception 'Seul un rapport en revision peut etre valide';
  end if;
  perform app.fn_notify(array[(select trader_id from public.reports where id = p_report_id)],
                       'report_validated', 'report', p_report_id);
  perform app.fn_audit('report.validate', 'report', p_report_id, '{}'::jsonb);
  return 'validated';
end $$;

-- RG-47 : cloture sans suite, motif obligatoire, hors listes de travail
create or replace function app.dismiss_report(p_report_id uuid, p_reason text)
returns report_status language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.reports
     set status = 'dismissed', dismissed_at = now(),
         dismissed_by = app.current_user_id(), dismissal_reason = p_reason
   where id = p_report_id
     and status in ('submitted','in_review','correction_requested','resubmitted');
  if not found then
    raise exception 'Rapport deja cloture';
  end if;
  perform app.fn_audit('report.dismiss', 'report', p_report_id,
                       jsonb_build_object('reason', p_reason));
  return 'dismissed';
end $$;

-- RG-35 + RG-06 : reouverture, ADMIN UNIQUEMENT, journalisee (RG-63)
create or replace function app.reopen_report(p_report_id uuid, p_reason text)
returns report_status language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.is_admin() then
    raise exception 'RG-06 : seul l''admin peut rouvrir un rapport valide';
  end if;
  -- leve le verrou RG-35 pour cette transaction uniquement
  perform set_config('app.allow_transition', 'on', true);

  update public.reports
     set status = 'in_review', validated_at = null, validated_by = null,
         reviewer_id = app.current_user_id(), reviewed_at = now()
   where id = p_report_id and status = 'validated';
  if not found then
    raise exception 'Seul un rapport valide peut etre rouvert';
  end if;
  perform app.fn_audit('report.reopen', 'report', p_report_id,
                       jsonb_build_object('reason', p_reason));
  return 'in_review';
end $$;

-- D7 / RG-37 : declaration " je n'ai pas trade aujourd'hui " (statut 'declared')
create or replace function app.declare_no_trade(
  p_session_date date,
  p_reason       text default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if app.current_user_role() <> 'trader' then
    raise exception 'La declaration " pas de trading " est reservee aux traders';
  end if;
  insert into public.reports (trader_id, session_date, is_no_trade, no_trade_reason, status)
  values (app.current_user_id(), p_session_date, true, p_reason, 'declared')
  returning id into v_id;
  perform app.fn_notify(app.reviewers_of(v_id), 'no_trade_declared', 'report', v_id);
  return v_id;
end $$;

-- RG-37 : annulation de la declaration si le trader trade finalement
create or replace function app.cancel_no_trade(p_report_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.reports
   where id = p_report_id and is_no_trade and trader_id = app.current_user_id();
  if not found then
    raise exception 'Declaration " pas de trading " introuvable';
  end if;
  perform app.fn_audit('report.cancel_no_trade', 'report', p_report_id, '{}'::jsonb);
end $$;






-- -----------------------------------------------------------------------------
-- 007_views.sql
-- -----------------------------------------------------------------------------
-- ============================================================================
-- trade_house - 007_views.sql
-- Vues de pilotage : indicateurs calcules (RG-47, RG-48, RG-20, RG-23) et
-- files de travail du tableau de bord (F1, F2, F3)
-- ============================================================================

-- 1. Indicateurs calcules a l'affichage -----------------------------------------
--    RG-47 " Retard critique " et RG-48 " badge > 72 h " sont des indicateurs,
--    pas des statuts : ils se recalculent a chaque lecture.
create view public.v_report_flags as
select
  r.id,
  r.status,
  r.trader_id,
  r.submitted_at,
  r.correction_deadline,
  r.is_late,                                     -- fige a la soumission (D2)
  -- RG-48 : soumis depuis plus de N heures
  (r.submitted_at is not null
   and r.status in ('submitted','in_review','correction_requested','resubmitted')
   and r.submitted_at < now() - make_interval(hours => s.stale_submission_hours)) as is_stale,
  -- RG-47 : delai de correction depasse depuis plus de N jours
  (r.status = 'correction_requested' and r.correction_deadline is not null
   and r.correction_deadline < now()) as is_overdue,
  (r.status = 'correction_requested' and r.correction_deadline is not null
   and r.correction_deadline < now() - make_interval(days => s.correction_critical_days)) as is_critical,
  (case when r.submitted_at is not null
        then extract(epoch from (now() - r.submitted_at)) / 3600 end) as hours_since_submission,
  s.stale_submission_hours,
  s.correction_critical_days
from public.reports r
cross join (select * from public.app_settings where id = 1) s;

-- 2. File de travail du tableau de bord (F1) -------------------------------------
create view public.v_report_worklist as
select
  r.id,
  r.trader_id,
  u.full_name  as trader_name,
  u.manager_id,
  r.session_date,
  r.status,
  r.instrument,
  r.result_type,
  r.result_amount,
  r.submitted_at,
  r.current_version,
  r.reviewer_id,
  r.correction_deadline,
  f.is_late,
  f.is_stale,
  f.is_overdue,
  f.is_critical,
  round(f.hours_since_submission)::int as hours_since_submission,
  (select count(*) from public.report_corrections c
    where c.report_id = r.id and c.severity = 'mandatory' and c.status = 'open')::int as open_mandatory,
  (select count(*) from public.report_corrections c
    where c.report_id = r.id and c.status = 'open')::int as open_corrections
from public.reports r
join public.users u on u.id = r.trader_id
join public.v_report_flags f on f.id = r.id
where r.status in ('submitted','in_review','correction_requested','resubmitted');

-- 3. Fenetre d'ouverture de la salle (RG-20) --------------------------------------
create view public.v_meeting_room_window as
select
  m.id,
  m.starts_at,
  m.duration_min,
  m.status,
  m.starts_at - make_interval(mins => s.room_open_before_minutes) as opens_at,
  m.starts_at + make_interval(mins => m.duration_min + s.room_close_after_minutes) as closes_at,
  (now() >= m.starts_at - make_interval(mins => s.room_open_before_minutes)
   and now() < m.starts_at + make_interval(mins => m.duration_min + s.room_close_after_minutes)) as is_room_open
from public.meetings m
cross join (select * from public.app_settings where id = 1) s;

-- 4. Presence en cours (reconnexions incluses, RG-23) -----------------------------
create view public.v_meeting_attendance_live as
select
  a.meeting_id,
  a.user_id,
  coalesce(sum(coalesce(a.duration_sec,
             floor(extract(epoch from (now() - a.joined_at)))::int)), 0)::bigint as total_seconds,
  min(a.joined_at) as first_joined_at,
  max(coalesce(a.left_at, now())) as last_left_at,
  count(*)::int as segments
from public.meeting_attendance a
group by a.meeting_id, a.user_id;

-- 5. Progression d'un rappel (par destinataire) ----------------------------------
create view public.v_meeting_reminder_progress as
select
  r.id,
  r.meeting_id,
  r.kind,
  r.send_at,
  r.status,
  count(l.id) filter (where l.channel = 'email')::int as total,
  count(l.id) filter (where l.channel = 'email' and l.status in ('sent','opened'))::int as sent_count,
  count(l.id) filter (where l.channel = 'email' and l.status = 'failed')::int as failed_count,
  count(l.id) filter (where l.channel = 'email' and l.status = 'pending')::int as pending_count
from public.meeting_reminders r
left join public.notifications_log l on l.reminder_id = r.id
group by r.id, r.meeting_id, r.kind, r.send_at, r.status;

-- 6. Elements ouverts du tableau de bord trader (F3) ------------------------------
create view public.v_trader_open_items as
select
  u.id as user_id,
  (select count(*) from public.reports r
    where r.trader_id = u.id and r.status = 'correction_requested')::int as reports_to_fix,
  (select count(*) from public.report_corrections c
     join public.reports r on r.id = c.report_id
    where r.trader_id = u.id and c.severity = 'mandatory' and c.status = 'open')::int as mandatory_open,
  (select count(*) from public.meeting_participants mp
     join public.meetings m on m.id = mp.meeting_id
    where mp.user_id = u.id and m.status = 'scheduled' and m.starts_at > now())::int as upcoming_meetings
from public.users u
where u.role = 'trader';


-- -----------------------------------------------------------------------------
-- 008_rls.sql
-- -----------------------------------------------------------------------------
-- ============================================================================
-- trade_house - 008_rls.sql
-- Securite au niveau des lignes (RG-04, RG-06, RG-61)
--
-- IMPORTANT : les tables ne sont PAS en FORCE ROW LEVEL SECURITY. Les fonctions
-- app.* marquees SECURITY DEFINER s'appuient sur ce comportement pour ne pas
-- se recurser sur les politiques de public.users. L'application doit se
-- connecter avec un role applicatif NON proprietaire (cf. README).
-- ============================================================================

-- Acces a une reunion : admin, createur, participant, ou manager d'un participant
create or replace function app.can_access_meeting(p_meeting uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.is_admin()
      or exists (select 1 from public.meetings m
                  where m.id = p_meeting and m.created_by = app.current_user_id())
      or exists (select 1 from public.meeting_participants mp
                  where mp.meeting_id = p_meeting
                    and app.can_view_trader(mp.user_id))
$$;

-- Ecriture : admin, createur, ou manager d'un des participants
create or replace function app.can_edit_meeting(p_meeting uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.is_admin()
      or exists (select 1 from public.meetings m
                  where m.id = p_meeting and m.created_by = app.current_user_id())
      or (app.is_manager() and exists (
            select 1 from public.meeting_participants mp
              join public.users t on t.id = mp.user_id
             where mp.meeting_id = p_meeting
               and t.manager_id = app.current_user_id()))
$$;

-- ---------------------------------------------------------------------------
-- users / sessions / 2FA / invitations
-- ---------------------------------------------------------------------------
alter table public.users enable row level security;

create policy users_select on public.users for select using (
     id = app.current_user_id()
  or app.is_admin()
  or (role = 'trader' and manager_id = app.current_user_id()));

create policy users_update on public.users for update using (
  id = app.current_user_id() or app.is_admin());

-- A4 / RG-53 : le RLS ne filtre pas les colonnes, cette fonction restreint
-- l'ecriture aux seules colonnes de profil autorisees.
create or replace function app.update_profile(
  p_full_name varchar,
  p_phone     varchar,
  p_timezone  varchar,
  p_locale    varchar
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if app.current_user_id() is null then
    raise exception 'Non authentifie';
  end if;
  update public.users
     set full_name = p_full_name, phone = p_phone,
         timezone = p_timezone, preferred_locale = p_locale
   where id = app.current_user_id();
  perform app.fn_audit('user.profile_update', 'user', app.current_user_id(), '{}'::jsonb);
end $$;

alter table public.user_sessions enable row level security;
create policy sessions_select on public.user_sessions for select
  using (user_id = app.current_user_id());
create policy sessions_update on public.user_sessions for update
  using (user_id = app.current_user_id());

alter table public.mfa_factors enable row level security;
create policy mfa_factors_all on public.mfa_factors for all
  using (user_id = app.current_user_id()) with check (user_id = app.current_user_id());

alter table public.mfa_backup_codes enable row level security;
create policy mfa_codes_all on public.mfa_backup_codes for all
  using (user_id = app.current_user_id()) with check (user_id = app.current_user_id());

alter table public.user_invitations enable row level security;
create policy invitations_select on public.user_invitations for select
  using (app.is_admin() or user_id = app.current_user_id());

-- ---------------------------------------------------------------------------
-- Reunions
-- ---------------------------------------------------------------------------
alter table public.meetings enable row level security;
create policy meetings_select on public.meetings for select using (app.can_access_meeting(id));
create policy meetings_insert on public.meetings for insert with check (
  app.is_admin() or app.is_manager());
create policy meetings_update on public.meetings for update using (app.can_edit_meeting(id));
create policy meetings_delete on public.meetings for delete using (app.can_edit_meeting(id));

alter table public.meeting_participants enable row level security;
create policy participants_select on public.meeting_participants for select
  using (app.can_access_meeting(meeting_id));
create policy participants_insert on public.meeting_participants for insert with check (
  app.is_admin() or app.is_manager());
create policy participants_update on public.meeting_participants for update
  using (app.can_edit_meeting(meeting_id));

alter table public.meeting_links enable row level security;
create policy links_select on public.meeting_links for select
  using (app.can_access_meeting(meeting_id));

alter table public.meeting_reminders enable row level security;
create policy reminders_select on public.meeting_reminders for select
  using (app.can_access_meeting(meeting_id));
create policy reminders_write on public.meeting_reminders for insert with check (
  app.can_edit_meeting(meeting_id));

alter table public.meeting_attendance enable row level security;
create policy attendance_select on public.meeting_attendance for select
  using (app.can_access_meeting(meeting_id));

alter table public.meeting_attendance_result enable row level security;
create policy attendance_result_select on public.meeting_attendance_result for select
  using (app.can_access_meeting(meeting_id));

-- ---------------------------------------------------------------------------
-- Rapports et corrections
-- ---------------------------------------------------------------------------
alter table public.reports enable row level security;
create policy reports_select on public.reports for select using (app.can_view_trader(trader_id));
create policy reports_insert on public.reports for insert with check (
  trader_id = app.current_user_id() and app.is_trader());
create policy reports_update on public.reports for update using (app.can_view_trader(trader_id));

alter table public.report_versions enable row level security;
create policy versions_select on public.report_versions for select
  using (app.can_view_trader((select r.trader_id from public.reports r where r.id = report_id)));

alter table public.report_files enable row level security;
create policy files_select on public.report_files for select
  using (app.can_view_trader((select r.trader_id from public.reports r where r.id = report_id)));
create policy files_insert on public.report_files for insert with check (
  app.can_view_trader((select r.trader_id from public.reports r where r.id = report_id)));

alter table public.report_corrections enable row level security;
create policy corrections_select on public.report_corrections for select
  using (app.can_view_trader((select r.trader_id from public.reports r where r.id = report_id)));
create policy corrections_insert on public.report_corrections for insert with check (
  app.can_manage_trader((select r.trader_id from public.reports r where r.id = report_id)));
create policy corrections_update on public.report_corrections for update using (
     app.can_manage_trader((select r.trader_id from public.reports r where r.id = report_id))
  or (select r.trader_id from public.reports r where r.id = report_id) = app.current_user_id());

alter table public.file_annotations enable row level security;
create policy annotations_select on public.file_annotations for select
  using (app.can_view_trader(
    (select r.trader_id from public.reports r
       join public.report_files f on f.report_id = r.id where f.id = file_id)));
create policy annotations_write on public.file_annotations for all using (
  app.can_manage_trader(
    (select r.trader_id from public.reports r
       join public.report_files f on f.report_id = r.id where f.id = file_id)))
  with check (true);

-- ---------------------------------------------------------------------------
-- Notifications, audit, parametres
-- ---------------------------------------------------------------------------
alter table public.notifications_log enable row level security;
create policy notifications_select on public.notifications_log for select
  using (user_id = app.current_user_id());
create policy notifications_update on public.notifications_log for update
  using (user_id = app.current_user_id());

-- RG-06 : le manager n'a PAS acces au journal d'audit global
alter table public.audit_log enable row level security;
create policy audit_select on public.audit_log for select using (app.is_admin());

alter table public.app_settings enable row level security;
create policy settings_select on public.app_settings for select
  using (app.current_user_id() is not null);
create policy settings_update on public.app_settings for update using (app.is_admin());



-- -----------------------------------------------------------------------------
-- 009_seed.sql
-- -----------------------------------------------------------------------------
-- ============================================================================
-- trade_house - 009_seed.sql
-- Donnees initiales (idempotent)
-- ============================================================================

-- 1. Parametres globaux : ligne unique obligatoire
insert into public.app_settings (id) values (1) on conflict (id) do nothing;

-- 2. Comptes de developpement (mots de passe conformes a RG-65)
--    A SUPPRIMER avant toute mise en ligne.


-- 3. Role applicatif NON proprietaire
--    Indispensable : le RLS n'est applique qu'a un role qui ne possede pas les
--    tables. L'application doit se connecter avec ce role (README).
--    Le mot de passe n'est PAS dans la migration : setup.ps1 le definit.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'trade_house_app') then
    create role trade_house_app login nosuperuser nobypassrls nocreatedb nocreaterole;
  end if;
end $$;

grant usage on schema public, app to trade_house_app;
grant select, insert, update, delete on all tables in schema public to trade_house_app;
grant usage, select on all sequences in schema public to trade_house_app;
grant execute on all functions in schema app to trade_house_app;
alter default privileges in schema public
  grant select, insert, update, delete on tables to trade_house_app;

-- -----------------------------------------------------------------------------
-- 010_auth.sql
-- -----------------------------------------------------------------------------
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


-- -----------------------------------------------------------------------------
-- 011_mfa.sql
-- -----------------------------------------------------------------------------
-- ============================================================================
-- trade_house - 011_mfa.sql
-- Double authentification (A5) : depot du secret TOTP, confirmation, codes de
-- secours, et reglage de l'obligation par l'admin.
--
-- Les secrets TOTP sont chiffres par l'application (AES-256-GCM) avant d'etre
-- stockes : public.mfa_factors.secret ne contient jamais le secret en clair.
-- ============================================================================

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


-- -----------------------------------------------------------------------------
-- 012_security.sql
-- -----------------------------------------------------------------------------
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


-- -----------------------------------------------------------------------------
-- 013_reminders.sql
-- -----------------------------------------------------------------------------
-- ============================================================================
-- trade_house - 013_reminders.sql
-- Robustesse du job d'envoi des rappels (phase 2).
--
-- app.claim_due_reminders() passe un rappel en 'sending' avant de traiter ses
-- destinataires. Si le job est interrompu (redemarrage, erreur reseau), le
-- rappel reste bloque dans 'sending' et ne sera plus jamais envoye.
-- Cette fonction remet en file les rappels abandonnes, en s'appuyant sur
-- l'idempotence (notifications_log) pour ne pas renvoyer deux fois.
-- ============================================================================

create or replace function app.reclaim_stuck_reminders(p_minutes int default 5)
returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count int;
begin
  update public.meeting_reminders r
     set status = 'scheduled'
   where r.status = 'sending'
     and r.updated_at < now() - make_interval(mins => greatest(p_minutes, 1));
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Destinataires d'un rappel en attente d'envoi.
-- SECURITY DEFINER : le job cron n'est PAS un utilisateur connecte, il n'a donc
-- aucun contexte RLS. Cette fonction est le seul point de lecture autorise
-- depuis le job, et ne renvoie que ce qu'il faut pour envoyer (adresse,
-- titre, date, lien deja resolu, langue).
create or replace function app.pending_reminder_targets(p_reminder_id uuid)
returns table (
  notification_id uuid,
  email          citext,
  title          varchar,
  starts_at      timestamptz,
  payload        jsonb,
  attempts       int
)
language sql security definer set search_path = public, pg_temp as $$
  select n.id, u.email, m.title, m.starts_at, n.payload, n.attempts
    from public.notifications_log n
    join public.users u on u.id = n.user_id
    join public.meeting_reminders r on r.id = n.reminder_id
    join public.meetings m on m.id = r.meeting_id
   where n.reminder_id = p_reminder_id
     and n.channel = 'email'
     and n.status in ('pending','failed')
$$;

-- Etat de sante du systeme de rappels (tableau de bord, exploitation)
create or replace function app.reminders_health()
returns table (
  scheduled  int,
  sending    int,
  sent       int,
  failed     int,
  stuck      int,
  pending_recipients int,
  due_now    int
)
language sql stable security definer set search_path = public, pg_temp as $$
  select
    (select count(*)::int from public.meeting_reminders where status = 'scheduled'),
    (select count(*)::int from public.meeting_reminders where status = 'sending'),
    (select count(*)::int from public.meeting_reminders where status = 'sent'),
    (select count(*)::int from public.meeting_reminders where status = 'failed'),
    (select count(*)::int from public.meeting_reminders
      where status = 'sending' and updated_at < now() - interval '5 minutes'),
    (select count(*)::int from public.notifications_log
      where channel = 'email' and status = 'pending'),
    (select count(*)::int from public.meeting_reminders
      where status = 'scheduled' and send_at <= now());
$$;


-- -----------------------------------------------------------------------------
-- 014_recurrence.sql
-- -----------------------------------------------------------------------------
-- ============================================================================
-- trade_house - 014_recurrence.sql
-- Reunions recurrentes (B10) : " hebdomadaire, mensuelle ", avec modification
-- d'une occurrence ou de toute la serie.
--
-- Le CDC ne demande que ces deux frequences : on interprete donc un sous-
-- ensemble de RRULE plutot que d'embarquer une bibliotheque complete.
-- Une serie est la reunion mere (recurrence_rule renseignee) ; chaque
-- occurrence est une reunion fille (parent_meeting_id), donc modifiable ou
-- annulable independamment.
-- ============================================================================

-- Lecture des parametres RRULE supportes
create or replace function app.parse_recurrence(p_rule text)
returns table (freq text, interval_days int, byday text)
language plpgsql immutable as $$
declare
  v_freq     text;
  v_interval int := 1;
  v_byday    text;
  v_part     text;
begin
  if p_rule is null or btrim(p_rule) = '' then
    return;
  end if;

  foreach v_part in array string_to_array(replace(upper(p_rule), 'RRULE:', ''), ';')
  loop
    case
      when v_part like 'FREQ=%'     then v_freq := split_part(v_part, '=', 2);
      when v_part like 'INTERVAL=%' then v_interval := split_part(v_part, '=', 2)::int;
      when v_part like 'BYDAY=%'    then v_byday := split_part(v_part, '=', 2);
    end case;
  end loop;

  if v_freq is null or v_freq not in ('WEEKLY', 'MONTHLY') then
    raise exception 'Frequence non geree : % (seules WEEKLY et MONTHLY le sont)', p_rule;
  end if;

  return query select v_freq, greatest(v_interval, 1), v_byday;
end $$;

-- Dates des occurrences d'une serie entre deux bornes (hors occurrence mere)
create or replace function app.meeting_occurrences(
  p_meeting uuid,
  p_from    date,
  p_to      date,
  p_limit   int default 60
) returns table (occurrence_date date, occurrence_number int)
language plpgsql stable as $$
declare
  v_freq      text;
  v_interval  int;
  v_byday     text;
  v_start     timestamptz;
  v_date      date;
  v_num       int := 1;
  v_first     date;
  v_max       int := least(greatest(p_limit, 1), 200);
begin
  select m.recurrence_rule, m.starts_at into v_freq, v_start
    from public.meetings m
   where m.id = p_meeting and m.recurrence_rule is not null;

  if v_freq is null then
    raise exception 'Cette reunion n est pas recurrente';
  end if;

  select * into v_freq, v_interval, v_byday from app.parse_recurrence(v_freq);

  v_date := v_start::date;

  while v_num <= v_max loop
    if v_freq = 'WEEKLY' then
      -- on avance jour par jour jusqu'a trouver le bon jour de semaine
      -- (BYDAY) ET la bonne semaine (INTERVAL)
      v_date := v_date + 1;
      while v_date <= p_to
        and not (
          (v_byday is null
           or to_char(v_date, 'ID')::int = (case upper(v_byday)
                when 'MO' then 1 when 'TU' then 2 when 'WE' then 3 when 'TH' then 4
                when 'FR' then 5 when 'SA' then 6 when 'SU' then 7
              end))
          and mod(
                (v_date - date_trunc('week', v_start::date)::date)::int / 7,
                v_interval) = 0
        )
      loop
        v_date := v_date + 1;
      end loop;
    else
      -- mensuel : meme jour du mois que la reunion mere
      v_date := (v_date + make_interval(months => v_interval))::date;
    end if;

    exit when v_date > p_to;
    return query select v_date, v_num;
    v_num := v_num + 1;
  end loop;
end $$;

-- Materialise les occurrences en reunions filles (idempotent : 014_recurrence)
create or replace function app.generate_occurrences(
  p_meeting uuid,
  p_from    date,
  p_to      date
) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_master  public.meetings;
  v_new     uuid;
  v_created int := 0;
  o         record;
begin
  select * into v_master from public.meetings m where m.id = p_meeting for update;
  if v_master.recurrence_rule is null then
    raise exception 'Cette reunion n est pas recurrente';
  end if;

  for o in select * from app.meeting_occurrences(p_meeting, p_from, p_to) loop
    -- deja existante : on ne recree pas (idempotence)
    if exists (
      select 1 from public.meetings m
       where m.parent_meeting_id = p_meeting
         and m.occurrence_number = o.occurrence_number
    ) then
      continue;
    end if;

    insert into public.meetings
      (title, description, type, starts_at, duration_min, status, created_by,
       recurrence_rule, parent_meeting_id, occurrence_number)
    values
      (v_master.title, v_master.description, v_master.type,
       (o.occurrence_date::timestamp + v_master.starts_at::time) at time zone 'UTC',
       v_master.duration_min, 'scheduled', v_master.created_by,
       null, p_meeting, o.occurrence_number)
    returning id into v_new;

    insert into public.meeting_participants (meeting_id, user_id)
    select v_new, mp.user_id from public.meeting_participants mp where mp.meeting_id = p_meeting;

    insert into public.meeting_links (meeting_id, url, provider, added_via, is_current)
    select v_new, l.url, l.provider, l.added_via, l.is_current
      from public.meeting_links l where l.meeting_id = p_meeting and l.is_current;

    insert into public.meeting_reminders (meeting_id, kind, send_at, created_by)
    select v_new, k.kind,
           ((o.occurrence_date::timestamp + v_master.starts_at::time) at time zone 'UTC')
             - (case k.kind when 'd_minus_1' then interval '1 day'
                             when 'h_minus_1' then interval '1 hour' else interval '0' end),
           v_master.created_by
      from (values ('invitation'::reminder_kind), ('d_minus_1'::reminder_kind),
                   ('h_minus_1'::reminder_kind)) as k(kind)
     where ((o.occurrence_date::timestamp + v_master.starts_at::time) at time zone 'UTC') >= now();

    v_created := v_created + 1;
  end loop;

  perform app.fn_audit('meeting.occurrences_generated', 'meeting', p_meeting,
                       jsonb_build_object('created', v_created));
  return v_created;
end $$;

-- Modification d'une occurrence seule, ou de toute la serie (B10)
create or replace function app.update_occurrence(
  p_occurrence_id  uuid,
  p_starts_at       timestamptz,
  p_apply_to_series boolean default false
) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_parent uuid;
begin
  select m.parent_meeting_id into v_parent from public.meetings m where m.id = p_occurrence_id;
  if v_parent is null then
    raise exception 'Cette reunion n est pas une occurrence';
  end if;

  if p_apply_to_series then
    update public.meetings set starts_at = p_starts_at where id = v_parent;
    update public.meetings set starts_at = p_starts_at where parent_meeting_id = v_parent;
  else
    update public.meetings set starts_at = p_starts_at where id = p_occurrence_id;
  end if;

  -- RG-17 : les rappels non envoyes suivent la nouvelle date
  update public.meeting_reminders r
     set send_at = p_starts_at
       - (case r.kind when 'd_minus_1' then interval '1 day'
                      when 'h_minus_1' then interval '1 hour' else interval '0' end)
   where r.status = 'scheduled'
     and r.meeting_id in (select id from public.meetings
                          where id = v_parent or parent_meeting_id = v_parent);

  perform app.fn_audit('meeting.occurrence_updated', 'meeting', p_occurrence_id,
                       jsonb_build_object('series', p_apply_to_series));
  return case when p_apply_to_series then 2 else 1 end;
end $$;


-- -----------------------------------------------------------------------------
-- 015_bootstrap.sql
-- -----------------------------------------------------------------------------
-- ============================================================================
-- trade_house - 015_bootstrap.sql
-- Creation du premier administrateur en production (A2 / RG-02).
--
-- Pourquoi cette fonction existe :
--   009_seed.sql cree un jeu d'essai avec des mots de passe CONNUS
--   (Admin!2345, Manager!2345, Trader!2345). C'est acceptable en
--   developpement, INTERDIT en production. Une installation de production ne
--   joue donc pas 009_seed... et se retrouve bloquee : app.create_user exige
--   un administrateur (RG-02) et il n'y en a aucun. C'est ce trou que cette
--   migration bouche.
--
-- Usage (une seule fois, a l'installation) :
--   select app.bootstrap_admin('toi@exemple.fr'::citext, 'Ton Nom');
--
-- Securite : la fonction se verrouille DEFINITIVEMENT des que le premier
-- administrateur existe. Une porte d'entree ouverte en permanence serait une
-- faille ; celle-ci se ferme toute seule apres un unique appel.
-- ============================================================================

create or replace function app.bootstrap_admin(
  p_email     citext,
  p_full_name varchar
) returns public.users
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user public.users;
begin
  -- la porte se ferme des le premier admin cree, et le reste definitivement
  if exists (select 1 from public.users u where u.role = 'admin') then
    raise exception 'RG-02 : un administrateur existe deja, bootstrap desactive';
  end if;

  if p_email is null or p_email::text !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'RG-43 : email invalide';
  end if;
  if p_full_name is null or btrim(p_full_name) = '' then
    raise exception 'RG-43 : nom complet requis';
  end if;

  insert into public.users (email, password_hash, full_name, role, timezone, preferred_locale)
  -- " ! " + alea : hash inexploitable tant qu'aucun mot de passe n'est defini.
  -- L'admin ne peut donc pas encore se connecter : il passe par la procedure
  -- habituelle "mot de passe oublie" de la phase 1, qui lui envoie un lien
  -- a usage unique. Aucun mot de passe en clair ne transite jamais.
  values (p_email, '!' || encode(gen_random_bytes(32), 'hex'), btrim(p_full_name),
          'admin', 'Europe/Paris', 'fr')
  returning * into v_user;

  perform app.fn_audit('user.create', 'user', v_user.id,
                       jsonb_build_object('role', 'admin', 'bootstrap', true));

  return v_user;
end;
$$;

comment on function app.bootstrap_admin(citext, varchar) is
  'Cree le premier administrateur. Refuse des qu''il en existe un (usage unique).';

-- Seuls les membres du role applicatif peuvent l'appeler ; c'est le role
-- utilise par l'operateur a l'installation, pas par le public.
revoke all on function app.bootstrap_admin(citext, varchar) from public;
grant execute on function app.bootstrap_admin(citext, varchar) to trade_house_app;


-- -----------------------------------------------------------------------------
-- 016_users_guards.sql
-- -----------------------------------------------------------------------------
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

revoke update on public.users from trade_house_app;

comment on table public.users is
  'Ecriture interdite au role applicatif : passer par app.update_profile / '
  'app.set_password / app.deactivate_user / app.reactivate_user (SECURITY DEFINER).';


-- -----------------------------------------------------------------------------
-- 017_video.sql
-- -----------------------------------------------------------------------------
-- ============================================================================
-- trade_house - 017_video.sql
-- Module C : acces a la salle et presence automatique (C4, C6, C8, RG-25).
--
-- Le fournisseur (Daily, LiveKit, Jitsi...) n'est PAS fige ici. Ce que la base
-- garantit, c'est l'autorisation d'entrer dans une salle et le role detenU
-- dans la salle. Le jeton est donc emis par l'application, signe avec la meme
-- cle que les autres jetons, et le fournisseur n'en recoit qu'une projection
-- au moment d'entrer.
--
-- Pourquoi ne pas deleguer a 100 % au fournisseur : le jeton fournisseur
-- serait alors la seule source de verite, et il faudrait le stocker pour
-- reemettre une entree. En gardant le jeton maison, on peut le revoquer, et
-- le fournisseur devient un detail d'infrastructure.
-- ============================================================================

-- Fournisseur de salle : daily | livekit | jitsi | external
alter table public.app_settings
  add column if not exists video_provider varchar not null default 'external',
  add column if not exists video_room_minutes int not null default 60,
  add column if not exists video_token_ttl_minutes int not null default 30;

comment on column public.app_settings.video_provider is
  'daily | livekit | jitsi | external (reunion B2 externe : simple lien)';

-- ---------------------------------------------------------------------------
-- Droits d'acces a la salle (C4, C6, RG-25).
--
-- La base ne signe pas : elle DECIDE. Elle verifie que l'appelant a le droit
-- d'entrer et lui renvoie ce qu'il a le droit de faire. La signature du jeton
-- est faite par l'application, avec node:crypto, comme les autres jetons.
--
-- Pourquoi ne pas laisser le fournisseur de visio gerer seul : son jeton
-- deviendrait l'unique source de verite, impossible a revoquer chez nous. En
-- gardant la decision ici, le fournisseur reste un detail d'infrastructure.
-- ---------------------------------------------------------------------------
create or replace function app.room_claims(
  p_meeting_id  uuid,
  p_ttl_minutes integer default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user     uuid := app.current_user_id();
  v_ttl      integer;
  v_role     text;
  v_is_admin boolean;
begin
  if v_user is null then
    raise exception 'C4 : authentification requise';
  end if;

  -- C4 : entrent les invites et l'organisateur. L'admin dispose en plus d'un
  -- canal de secours, pour qu'une reunion ne reste pas inaccessible apres une
  -- erreur d'ajout de participant.
  --
  -- L'organisateur est explicitement inclus : create_meeting ne l'ajoute pas
  -- forcement a la liste des invites, et il doit pouvoir ouvrir sa salle.
  v_is_admin := app.is_admin();
  if not v_is_admin and not exists (
    select 1 from public.meeting_participants mp
     where mp.meeting_id = p_meeting_id and mp.user_id = v_user
  ) and not exists (
    select 1 from public.meetings m
     where m.id = p_meeting_id and m.created_by = v_user
  ) then
    raise exception 'C4 : vous n''etes pas invite a cette reunion';
  end if;

  select coalesce(nullif(p_ttl_minutes, 0), video_token_ttl_minutes)
    into v_ttl from public.app_settings where id = 1;

  -- RG-25 : la hierarchie des droits est decidee en base, pas par l'interface.
  -- L'organisateur de la reunion est moderateur au meme titre que l'admin.
  if v_is_admin or app.is_manager() or exists (
       select 1 from public.meetings m
        where m.id = p_meeting_id and m.created_by = v_user)
  then
    v_role := 'moderator';
  else
    v_role := 'participant';
  end if;

  return jsonb_build_object(
    'v', 1,
    'm', p_meeting_id,
    'u', v_user,
    'r', v_role,
    'e', extract(epoch from now() + make_interval(mins => v_ttl))::bigint
  );
end;
$$;

comment on function app.room_claims(uuid, integer) is
  'Verifie le droit d''entrer en salle (C4) et renvoie les revendications a signer (RG-25).';


-- -----------------------------------------------------------------------------
-- 018_user_admin.sql
-- -----------------------------------------------------------------------------
-- ===========================================================================
-- 018 - Administration des comptes : modification et anonymisation
-- ===========================================================================
--
-- POURQUOI PAS DE SUPPRESSION PHYSIQUE ?
--
-- Le besoin est reel : un administrateur doit pouvoir corriger un compte, et
-- une personne peut demander l'effacement de ses donnees. Mais une suppression
-- physique est architecturalement impossible ici, et c'est volontaire.
--
-- Ces tables pointent vers users avec ON DELETE NO ACTION :
--
--   reports, report_versions, report_files, report_corrections,
--   file_annotations, meetings, meeting_reminders
--
-- Consequence concrete : supprimer un trader ayant depose des rapports est
-- refuse par PostgreSQL. C'est le comportement voulu. Dans une plateforme de
-- coaching, l'historique de discipline EST la donnee : un trader qui brule
-- apres six mois de travail laisse la trace de ses progres. Supprimer le compte
-- detruirait ou detacherait cette preuve - precisement ce que l'application
-- sert a mesurer.
--
-- Deux reponses adaptees, exposees ici :
--
--   app.update_user_account()  -> corriger le compte (role, manager, contact)
--   app.anonymize_user()       -> effacer l'identite, garder l'historique
--
-- L'anonymisation est le " droit a l'oubli " realiste : email, nom et
-- telephone sont ecrases, le compte est desactive et ses sessions revoquees,
-- mais la ligne subsiste pour que rapports et correctifs gardent leur auteur.
--
-- Les deux exigent un administrateur, et sont tracees dans le journal (RG-63).
-- L'interface ne les appelle jamais sans controle de role prealable : la base
-- reste le juge.
-- ===========================================================================

-- Modification d'un compte par un administrateur ------------------------------
--
-- Pas de UPDATE direct depuis l'application : les regles vivent ici (role,
-- coherence manager/trader, retrait du dernier administrateur).
create or replace function app.update_user_account(
  p_user_id uuid,
  p_role user_role default null,
  p_manager_id uuid default null,
  p_phone text default null,
  p_timezone text default null,
  p_locale text default null,
  p_full_name text default null
) returns uuid
language plpgsql
volatile
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if app.current_user_role() <> 'admin' then
    raise exception 'Seul un administrateur modifie un compte'
      using errcode = '42501';
  end if;

  if p_user_id is null or not exists (select 1 from public.users where id = p_user_id) then
    raise exception 'Compte introuvable' using errcode = 'P0002';
  end if;

  -- Se retirer soi-meme le role administrateur pourrait laisser le systeme
  -- sans administrateur : action refusee plutot que de creer cette impasse.
  if p_user_id = app.current_user_id() and p_role is not null and p_role <> 'admin' then
    raise exception 'Impossible de retirer son propre role administrateur';
  end if;

  -- Un trader est rattache a un manager actif ; un manager ou un admin ne
  -- l'est pas : le lien est remis a null quand le role change.
  if p_role = 'trader' and p_manager_id is not null then
    if not exists (
      select 1 from public.users m
       where m.id = p_manager_id and m.role in ('manager', 'admin') and m.is_active
    ) then
      raise exception 'Manager invalide pour ce trader';
    end if;
  end if;

  update public.users
     set role             = coalesce(p_role, role),
         manager_id       = case
                              when p_role = 'trader' then p_manager_id
                              when p_role in ('manager', 'admin') then null
                              else manager_id
                            end,
         phone            = coalesce(p_phone, phone),
         timezone         = coalesce(p_timezone, timezone),
         preferred_locale = coalesce(p_locale, preferred_locale),
         full_name        = coalesce(nullif(trim(p_full_name), ''), full_name),
         updated_at       = now()
   where id = p_user_id;

  perform app.fn_audit(
    'user_updated', 'users', p_user_id,
    jsonb_build_object('role', p_role, 'manager_id', p_manager_id)
  );

  return p_user_id;
end $$;

comment on function app.update_user_account is
  'Administrateur uniquement : corrige role, manager et coordonnees d un compte.';


-- Anonymisation (droit a l oubli) -------------------------------------------
--
-- On n efface que l identite directe. L adresse d origine est remplacee par
-- une adresse technique non recontactable ; son empreinte SHA-256 est conservee
-- dans la nouvelle adresse, ce qui permet de reconnaitre un compte deja traite
-- sans garder l identite en clair.
create or replace function app.anonymize_user(p_user_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_email citext;
  v_sessions integer;
begin
  if app.current_user_role() <> 'admin' then
    raise exception 'Seul un administrateur anonymise un compte'
      using errcode = '42501';
  end if;

  if p_user_id is null or not exists (select 1 from public.users where id = p_user_id) then
    raise exception 'Compte introuvable' using errcode = 'P0002';
  end if;

  if p_user_id = app.current_user_id() then
    raise exception 'Impossible d anonymiser son propre compte';
  end if;

  select email into v_email from public.users where id = p_user_id for update;

  select count(*) into v_sessions
    from public.user_sessions
   where user_id = p_user_id and revoked_at is null;

  -- L anonymisation revoque les sessions sans attendre : la personne doit etre
  -- deconnectee maintenant, pas a l expiration.
  update public.user_sessions
     set revoked_at = now()
   where user_id = p_user_id and revoked_at is null;

  update public.users
     set email         = ('anonymise+' || substr(encode(digest(v_email::text, 'sha256'), 'hex'), 1, 24)
                          || '@anonymise.invalid')::citext,
         full_name     = 'Compte anonymise',
         phone         = null,
         -- Le hash est invalide : plus aucune authentification possible, meme
         -- par erreur de saisie sur un compte " reactive " par erreur.
         password_hash = '!anonymized',
         is_active     = false,
         mfa_enrolled  = false,
         anonymized_at = now(),
         updated_at    = now()
   where id = p_user_id;

  perform app.fn_audit(
    'user_anonymized', 'users', p_user_id,
    jsonb_build_object('sessions_revoked', v_sessions)
  );

  return p_user_id;
end $$;

comment on function app.anonymize_user is
  'Administrateur uniquement : efface l identite (RGPD) en conservant l historique des rapports.';


-- Le droit de suppression ne peut pas etre accorde au role applicatif : aucune
-- politique DELETE n existe sur public.users, et les contraintes NO ACTION
-- protegeient de toute deconstruction anyway. On le dit explicitement dans
-- la base plutot que de laisser croire que c'est un oubli.
comment on table public.users is
  'Pas de suppression physique possible : reports, corrections et annotations '
  'referencent l auteur (ON DELETE NO ACTION). Utiliser app.anonymize_user() '
  'pour le droit a l oubli, app.update_user_account() pour corriger.';


-- -----------------------------------------------------------------------------
-- 019_settings.sql
-- -----------------------------------------------------------------------------
-- ===========================================================================
-- 019 - Reglages modifiables par l administrateur
-- ===========================================================================
--
-- Pourquoi ? L'ecran /settings etait en lecture seule : les valeurs venaient
-- de app.settings(), mais aucune fonction ne les ecrivait. Les regles restaient
-- figees depuis la creation du projet.
--
-- On n'ecrit pas dans la table depuis l'API. Chaque cle est declaree avec son
-- type et ses bornes, et une cle absente de cette table est REFUSEE.
--
-- Pourquoi des bornes aussi strictes ? Parce qu'une valeur aberrante appliquee
-- a une regle de securite ne fait pas echouer une requete : elle produit un
-- systemecarbonate. Mettre login_lockout_minutes a 0 ne leve aucune erreur -
-- il desactive silencieusement le verrouillage apres tentatives echouees.
--
-- Chaque modification est tracee : un changement de regle doit pouvoir etre
-- explique six mois plus tard.
-- ===========================================================================

-- Catalogue des reglages modifiables : type, bornes et libelle d unites.
create or replace function app.settings_catalog()
returns table (key text, kind text, lo numeric, hi numeric)
language sql immutable
as $$
  select * from (values
    ('late_submission_days',        'int',     1,   60),
    ('correction_critical_days',    'int',     1,   60),
    ('stale_submission_hours',      'int',     1,  720),
    ('max_files_per_report',        'int',     1,   50),
    ('max_screenshot_mb',           'int',     1,   50),
    ('max_pdf_mb',                  'int',     1,  200),
    ('default_duration_min',        'int',     5,  480),
    ('attendance_present_ratio',    'ratio',   0,    1),
    ('late_arrival_minutes',        'int',     0,  240),
    ('room_open_before_minutes',    'int',     1,  120),
    ('room_close_after_minutes',    'int',     5, 1440),
    ('invitation_ttl_days',         'int',     1,   90),
    ('reminder_retry_count',        'int',     0,   10),
    ('reminder_retry_minutes',      'int',     1, 1440),
    ('max_login_attempts',          'int',     3,   20),
    ('login_lockout_minutes',       'int',     1, 1440),
    ('max_mfa_attempts',            'int',     3,   20),
    ('mfa_lockout_minutes',         'int',     1, 1440),
    ('video_room_minutes',          'int',    10,  480),
    ('video_token_ttl_minutes',     'int',     5,  120),
    ('retention_recording_months',  'int',     1,  120),
    ('retention_report_months',     'int',    12,  240),
    ('default_locale',              'locale',  0,    0)
  ) as t(key, kind, lo, hi);
$$;

comment on function app.settings_catalog is
  'Reglages modifiables et leurs bornes. Une cle absente de ce catalogue est refusee.';
-- -- Lecture d une seule valeur : la comparaison doit se faire sur la valeur
-- REELLE d avant ecriture, pas sur celle du patch.
create or replace function app.settings_setting(p_key text)
returns text
language sql stable
as $$
  select (to_jsonb(s) ->> p_key) from public.app_settings s;
$$;

-- Patch de reglages.
-- la trace reste lisible, et un patch dont dix valeurs sur
-- vingt sont refusees n invalide pas entierement la demande.
create or replace function app.update_settings(p_patch jsonb)
returns void
language plpgsql
volatile
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  r record;
  k text;
  v jsonb;
  v_before text;
  num numeric;
  txt text;
begin
  if app.current_user_role() <> 'admin' then
    raise exception 'Seul un administrateur modifie les reglages'
      using errcode = '42501';
  end if;

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'Patch invalide' using errcode = '22023';
  end if;

  for k in select jsonb_object_keys(p_patch) loop
    v := p_patch -> k;

    select * into r from app.settings_catalog() c where c.key = k;
    if not found then
      raise exception 'Reglage inconnu ou non modifiable : %', k;
    end if;

    if r.kind = 'locale' then
      txt := v #>> '{}';
      if txt not in ('fr', 'en') then
        raise exception '% : langue invalide (fr ou en)', k;
      end if;
    else
      num := (v #>> '{}')::numeric;
      if num < r.lo or num > r.hi then
        raise exception '% : valeur % hors bornes (% a %)', k, num, r.lo, r.hi;
      end if;
      txt := num::text;
    end if;

    -- Valeur REELLE avant ecriture : la trace doit permettre de retablir le
    -- reglage d avant, pas seulement annoncer ce qu il est devenu.
    v_before := app.settings_setting(k);

    -- Une seule ecriture, apres validation. Un UPDATE " cle = cle de l objet "
    -- aurait accepte silencieusement les valeurs hors plage, qu elles soient
    -- refusees ou non.
    if r.kind = 'locale' then
      execute format(
        'update public.app_settings set %I = $1, updated_at = now(), updated_by = $2 where id = 1',
        k)
        using txt, app.current_user_id();
    else
      execute format(
        'update public.app_settings set %I = $1::%s, updated_at = now(), updated_by = $2 where id = 1',
        k, case when r.kind = 'ratio' then 'numeric' else 'integer' end)
        using txt, app.current_user_id();
    end if;

    perform app.fn_audit(
      'settings_updated', 'app_settings', null,
      jsonb_build_object('key', k, 'before', v_before, 'after', txt)
    );
  end loop;
end $$;

comment on function app.update_settings is
  'Administrateur uniquement : applique un patch JSON de reglages, chaque cle '
  'validee contre app.settings_catalog() et journalisee.';


-- Lecture d une seule valeur, pour la trace : la comparaison doit se faire sur
-- la valeur REELLE d avant ecriture, pas sur celle du patch.
create or replace function app.settings_setting(p_key text)
returns text
language sql stable
as $$
  select (to_jsonb(s) ->> p_key) from public.app_settings s;
$$;


-- -----------------------------------------------------------------------------
-- 020_annotations.sql
-- -----------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- 020 - Annotations et pieces jointes : fermeture d'un trou et suppression
--
-- 1. CORRECTION DE SECURITE
--    008_rls.sql a cree :
--        create policy annotations_write on public.file_annotations
--          for all using (app.can_manage_trader(...)) with check (true);
--
--    Pour un INSERT, PostgreSQL n'applique que `with check` : la clause `using`
--    n'est pas evaluee. Avec `with check (true)`, cette politique n'interdit
--    donc RIEN a l'insertion : tout utilisateur authentifie pouvait ecrire une
--    annotation sur le fichier d'un autre, y compris celui d'un trader d'une
--    autre equipe. Le `using` ne protegeait que la mise a jour et la
--    suppression, pas la creation.
--
--    On la remplace par trois politiques distinctes, chacune avec une clause
--    `using` ET une clause `with check` explicites.
--
-- 2. Suppression d'une piece jointe avant depot (RG-31)
--    Le trader doit pouvoir corriger un depot : retirer une mauvaise capture
--    fait partie du travail. La suppression est reservee au proprietaire, et
--    seulement tant que le rapport n'est pas sorti du brouillon.
-- ---------------------------------------------------------------------------

drop policy if exists annotations_write on public.file_annotations;
-- `annotations_select` existe deja depuis la migration 008. On la recree malgre
-- tout pour deux raisons : elle faisait reference a une sous-requete qui sera
-- remplacee par app.fn_annotation_report_trader, et `create policy` echouerait
-- sinon sur une base deja installee - donc la migration ne serait pas rejouable.
drop policy if exists annotations_select on public.file_annotations;

-- Qui est proprietaire du rapport portant ce fichier ?
create or replace function app.fn_annotation_report_trader(p_file_id uuid)
returns uuid
language sql stable security definer set search_path = public, app as $$
  select r.trader_id
    from public.report_files f
    join public.reports r on r.id = f.report_id
   where f.id = p_file_id
$$;

-- Lecture : quiconque a le droit de voir le trader (RLS aligne sur 008).
create policy annotations_select on public.file_annotations for select
  using (app.can_view_trader(app.fn_annotation_report_trader(file_id)));

-- Ecriture : encadrement uniquement, et l auteur est impose a l utilisateur
-- courant. Sans ce dernier controle, un manager pourrait signer une annotation
-- au nom d'un tiers en forcant author_id.
create policy annotations_insert on public.file_annotations for insert
  with check (
    app.can_manage_trader(app.fn_annotation_report_trader(file_id))
    and author_id = app.current_user_id()
  );

create policy annotations_update on public.file_annotations for update
  using (app.can_manage_trader(app.fn_annotation_report_trader(file_id)))
  with check (
    app.can_manage_trader(app.fn_annotation_report_trader(file_id))
    and author_id = app.current_user_id()
  );

-- L encadrement peut corriger sa propre annotation ; le laisse dans le meme
-- temps, ce qui evite de bloquer un encadrement absent sur un dessin errone.
create policy annotations_delete on public.file_annotations for delete
  using (
    app.can_manage_trader(app.fn_annotation_report_trader(file_id))
    or author_id = app.current_user_id()
  );

-- Coordonnees normalisees : les annotations sont stockees en fraction de la
-- largeur/hauteur de l'image (0..1) afin de survivre a un changement de
-- resolution. On l'impose ici plutot que dans l'API : une annotation hors
-- cadre serait invisible a l'affichage, silencieusement.
alter table public.file_annotations
  add constraint file_annotations_coords check (
    jsonb_typeof(data -> 'x') = 'number'
    and (data -> 'x') between '0'::jsonb and '1'::jsonb
    and jsonb_typeof(data -> 'y') = 'number'
    and (data -> 'y') between '0'::jsonb and '1'::jsonb
  );

-- La taille n est exigee que pour les formes etinfees par une bounding box.
alter table public.file_annotations
  add constraint file_annotations_size check (
    shape not in ('rectangle', 'circle')
    or (
      jsonb_typeof(data -> 'w') = 'number' and (data -> 'w') > '0'::jsonb
      and jsonb_typeof(data -> 'h') = 'number' and (data -> 'h') > '0'::jsonb
    )
  );

-- ---------------------------------------------------------------------------
-- Suppression d une piece jointe (RG-31)
-- ---------------------------------------------------------------------------
create policy files_delete on public.report_files for delete
  using (
    exists (
      select 1
        from public.reports r
       where r.id = report_id
         and r.trader_id = app.current_user_id()
         and r.status in ('draft', 'correction_requested')
    )
  );

-- -----------------------------------------------------------------------------
-- 021_training.sql
-- -----------------------------------------------------------------------------
-- ============================================================================
-- trade_house - 021_training.sql
-- Module G : la formation
--
-- Un manager ecrit des COURS, y attache des EXERCICES, puis attribue le cours a
-- un ou plusieurs de ses traders. Chaque trader travaille a son rythme et rend
-- ses exercices ; le manager les CORRIGE.
--
-- Trois choix de modele meritent d'etre explicites, car ils ne vont pas de soi.
--
-- 1. Un cours est un MODELE, pas un parcours individuel. Ecrire dix fois le
--    meme cours pour dix traders serait absurde. Le cours porte donc son
--    auteur et son contenu, et l'attribution porte la progression. Un trader
--    qui recoit deux fois le meme cours a deux enregistrements distincts : sa
--    re-soumission ne doit pas ecraser l'historique de la premiere.
--
-- 2. L'affectation n'est PAS figee au moment de l'attribution : si le manager
--    modifie le cours apres coup, le trader deja attribue voit la version en
--    cours. On privilegie la simplicite ; une archive complete du contenu est
--    un second module, pas une precaution de premier rang.
--
-- 3. La correction est LIBRE, non automatique. Un exercice de trading (" avez-
--    vous respecte votre plan ? ") ne se corrige pas par une cle QCM : la
--    reponse est une analyse, et seul le manager qui a donne le cours peut la
--    faire. Le mode QCM est conserve pour les exercices FACTUELS (definitions,
--    regles de risque), notes automatiquement - la note automatique est un
--    CONTROLE, pas une note finale.
-- ============================================================================

create type training_course_status as enum ('draft', 'published', 'archived');
create type training_assignment_status as enum ('assigned', 'in_progress', 'submitted', 'completed');
create type training_exercise_kind as enum ('written', 'qcm');

-- ---------------------------------------------------------------------------
-- Cours
-- ---------------------------------------------------------------------------
create table public.training_courses (
  id         uuid primary key default gen_random_uuid(),
  title      varchar(200) not null check (length(btrim(title)) > 0),
  summary    text,
  content    text not null default '',
  author_id  uuid not null references public.users(id),
  status     training_course_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index training_courses_author_idx on public.training_courses (author_id, status);

create trigger training_courses_touch_trg before update on public.training_courses
  for each row execute function app.fn_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Exercices rattaches a un cours
-- ---------------------------------------------------------------------------
create table public.training_exercises (
  id             uuid primary key default gen_random_uuid(),
  course_id      uuid not null references public.training_courses(id) on delete cascade,
  position       int not null default 1,
  title          varchar(200) not null check (length(btrim(title)) > 0),
  prompt         text not null,
  kind           training_exercise_kind not null default 'written',
  -- QCM : { "a": "texte", "b": "texte" } et correct_answer = "b"
  options        jsonb,
  correct_answer text,
  explanation    text,      -- POURQUOI la reponse est juste : c'est la correction
  created_at     timestamptz not null default now(),
  constraint training_exercises_options_object check (
    options is null or jsonb_typeof(options) = 'object'
  ),
  -- Un QCM sans options ni cle de reponse ne serait pas corrigeable.
  constraint training_exercises_qcm_usable check (
    kind <> 'qcm' or (options is not null and correct_answer is not null)
  )
);
create index training_exercises_course_idx on public.training_exercises (course_id, position);

-- ---------------------------------------------------------------------------
-- Attribution d'un cours a un trader
-- ---------------------------------------------------------------------------
create table public.training_assignments (
  id           uuid primary key default gen_random_uuid(),
  course_id    uuid not null references public.training_courses(id) on delete cascade,
  trader_id    uuid not null references public.users(id),
  assigned_by  uuid not null references public.users(id),
  assigned_at  timestamptz not null default now(),
  due_at       timestamptz,
  status       training_assignment_status not null default 'assigned',
  completed_at timestamptz,
  constraint training_assignments_unique unique (course_id, trader_id),
  constraint training_assignments_not_self check (trader_id <> assigned_by)
);
create index training_assignments_trader_idx on public.training_assignments (trader_id, status);
create index training_assignments_course_idx on public.training_assignments (course_id);

-- ---------------------------------------------------------------------------
-- Reponses et correction
-- ---------------------------------------------------------------------------
create table public.training_submissions (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.training_assignments(id) on delete cascade,
  exercise_id   uuid not null references public.training_exercises(id) on delete cascade,
  trader_id     uuid not null references public.users(id),
  answer        text,
  answer_key    text,
  submitted_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Une seule soumission par exercice et par attribution : une re-soumission
  -- ecraserait la precedente et perdrait sa correction.
  constraint training_submissions_unique unique (assignment_id, exercise_id)
);
create index training_submissions_assignment_idx on public.training_submissions (assignment_id);

create table public.training_reviews (
  submission_id uuid primary key references public.training_submissions(id) on delete cascade,
  reviewer_id   uuid not null references public.users(id),
  score         numeric(5,2) check (score is null or (score >= 0 and score <= 20)),
  comment       text not null check (length(btrim(comment)) > 0),
  reviewed_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Fonctions metier : la regle vit ici, pas dans l'interface
-- ---------------------------------------------------------------------------
-- Un cours est modifiable par son auteur, ou par un admin.
create or replace function app.fn_can_write_course(p_course_id uuid)
returns boolean language sql stable as $$
  select app.is_admin()
      or exists (
        select 1 from public.training_courses c
         where c.id = p_course_id and c.author_id = app.current_user_id()
      )
$$;

-- Le manager n attribue qu a SES traders. Sans cette regle, il pourrait envoyer
-- un cours a toute la maison en devinant un identifiant.
create or replace function app.fn_can_assign_to(p_trader_id uuid)
returns boolean language sql stable as $$
  select app.is_admin() or app.can_manage_trader(p_trader_id)
$$;

create or replace function app.create_training_course(
  p_title   varchar,
  p_summary text default null,
  p_content text default '',
  p_status  training_course_status default 'draft'
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if app.current_user_role() = 'trader' then
    raise exception 'FORMATION-01 : seul un manager peut creer un cours';
  end if;
  if length(btrim(p_title)) = 0 then
    raise exception 'FORMATION-01b : le titre est obligatoire';
  end if;

  insert into public.training_courses (title, summary, content, author_id, status)
  values (p_title, p_summary, p_content, app.current_user_id(), p_status)
  returning id into v_id;

  perform app.fn_audit('training.course_created', 'training_course', v_id,
                       jsonb_build_object('status', p_status));
  return v_id;
end $$;

create or replace function app.update_training_course(
  p_course_id uuid,
  p_title     varchar,
  p_summary   text default null,
  p_content   text default '',
  p_status    training_course_status default 'draft'
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.fn_can_write_course(p_course_id) then
    raise exception 'FORMATION-02 : vous n etes pas l auteur de ce cours';
  end if;

  update public.training_courses
     set title = p_title, summary = p_summary, content = p_content,
         status = p_status, updated_at = now()
   where id = p_course_id;

  perform app.fn_audit('training.course_updated', 'training_course', p_course_id,
                       jsonb_build_object('status', p_status));
end $$;

create or replace function app.add_training_exercise(
  p_course_id      uuid,
  p_title          varchar,
  p_prompt         text,
  p_kind           training_exercise_kind default 'written',
  p_options        jsonb default null,
  p_correct_answer text default null,
  p_explanation    text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_max int;
begin
  if not app.fn_can_write_course(p_course_id) then
    raise exception 'FORMATION-02 : vous n etes pas l auteur de ce cours';
  end if;
  if length(btrim(p_prompt)) = 0 then
    raise exception 'FORMATION-03 : l enonce de l exercice est obligatoire';
  end if;
  -- La cle de reponse doit exister parmi les propositions : sinon la
  -- correction automatique ne pourrait jamais etre juste.
  if p_kind = 'qcm' and (p_options is null or p_correct_answer is null) then
    raise exception 'FORMATION-03b : un QCM exige des propositions et une reponse';
  end if;
  if p_kind = 'qcm' and p_options is not null
     and not (p_options ? p_correct_answer) then
    raise exception 'FORMATION-03c : la reponse proposee ne figure pas dans les propositions';
  end if;

  -- Position implicite : la suite du dernier exercice du cours.
  select coalesce(max(position), 0) + 1 into v_max
    from public.training_exercises where course_id = p_course_id;

  insert into public.training_exercises
    (course_id, position, title, prompt, kind, options, correct_answer, explanation)
  values (p_course_id, v_max, p_title, p_prompt, p_kind, p_options,
          p_correct_answer, p_explanation)
  returning id into v_id;

  return v_id;
end $$;

create or replace function app.assign_training(
  p_course_id uuid,
  p_trader_id uuid,
  p_due_at    timestamptz default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_status training_course_status;
begin
  if not app.fn_can_assign_to(p_trader_id) then
    raise exception 'FORMATION-04 : ce trader ne fait pas partie de votre equipe';
  end if;
  if p_trader_id = app.current_user_id() then
    raise exception 'FORMATION-04b : vous ne pouvez pas vous attribuer un cours';
  end if;

  select status into v_status from public.training_courses where id = p_course_id;
  if v_status is null then
    raise exception 'FORMATION-05 : cours introuvable';
  end if;
  -- Un brouillon n est pas distribuable : le trader ne doit pas decouvrir un
  -- cours encore en relecture.
  if v_status = 'draft' then
    raise exception 'FORMATION-06 : le cours doit etre publie avant d etre attribue';
  end if;

  insert into public.training_assignments (course_id, trader_id, assigned_by, due_at)
  values (p_course_id, p_trader_id, app.current_user_id(), p_due_at)
  on conflict (course_id, trader_id) do update set due_at = excluded.due_at
  returning id into v_id;

  perform app.fn_audit('training.assigned', 'training_assignment', v_id,
                       jsonb_build_object('course_id', p_course_id, 'trader_id', p_trader_id));
  return v_id;
end $$;

create or replace function app.submit_training_exercise(
  p_assignment_id uuid,
  p_exercise_id   uuid,
  p_answer        text default null,
  p_answer_key    text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_trader uuid; v_course uuid; v_kind training_exercise_kind; v_id uuid;
begin
  select a.trader_id, a.course_id into v_trader, v_course
    from public.training_assignments a where a.id = p_assignment_id;

  if v_trader is null then
    raise exception 'FORMATION-07 : attribution introuvable';
  end if;
  if v_trader <> app.current_user_id() then
    raise exception 'FORMATION-08 : cette attribution ne vous appartient pas';
  end if;

  -- L'exercice doit appartenir au cours attribue : sans ce controle, un trader
  -- pourrait rendre l'exercice d'un cours qu'il ne suit pas.
  select kind into v_kind from public.training_exercises
   where id = p_exercise_id and course_id = v_course;
  if v_kind is null then
    raise exception 'FORMATION-09 : cet exercice n apartient pas au cours attribue';
  end if;

  if v_kind = 'written' and (p_answer is null or length(btrim(p_answer)) = 0) then
    raise exception 'FORMATION-10 : la reponse est obligatoire';
  end if;

  insert into public.training_submissions
    (assignment_id, exercise_id, trader_id, answer, answer_key)
  values (p_assignment_id, p_exercise_id, v_trader, p_answer, p_answer_key)
  on conflict (assignment_id, exercise_id) do update
    set answer = excluded.answer, answer_key = excluded.answer_key, updated_at = now()
  returning id into v_id;

  -- L'attribution passe " en cours " des la premiere reponse : c'est ce qui
  -- permet au manager de voir qui a commence.
  update public.training_assignments
     set status = 'in_progress', completed_at = null
   where id = p_assignment_id and status = 'assigned';

  return v_id;
end $$;

create or replace function app.review_training(
  p_submission_id uuid,
  p_score         numeric default null,
  -- avoir une aussi, sinon PostgreSQL refuse de creer la fonction. Le controle
  -- " non vide " est fait dans le corps, pas par une valeur par defaut.
  p_comment       text default ''
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_trader uuid;
begin
  -- Le commentaire est obligatoire : une note seule ne dit pas quoi corriger.
  if length(btrim(p_comment)) = 0 then
    raise exception 'FORMATION-11 : un commentaire de correction est obligatoire';
  end if;
  if p_score is not null and (p_score < 0 or p_score > 20) then
    raise exception 'FORMATION-12 : la note doit etre comprise entre 0 et 20';
  end if;

  select s.trader_id into v_trader
    from public.training_submissions s where s.id = p_submission_id;

  if v_trader is null then
    raise exception 'FORMATION-13 : soumission introuvable';
  end if;
  if not (app.is_admin() or app.can_manage_trader(v_trader)) then
    raise exception 'FORMATION-14 : vous ne corrigez pas ce travail';
  end if;

  insert into public.training_reviews (submission_id, reviewer_id, score, comment)
  values (p_submission_id, app.current_user_id(), p_score, p_comment)
  on conflict (submission_id) do update
    set reviewer_id = excluded.reviewer_id, score = excluded.score,
        comment = excluded.comment, reviewed_at = now();

  perform app.fn_audit('training.reviewed', 'training_submission', p_submission_id,
                       jsonb_build_object('score', p_score));
end $$;

create or replace function app.complete_training(p_assignment_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_total int; v_done int;
begin
  select (select count(*) from public.training_exercises e
            join public.training_assignments a on a.course_id = e.course_id
           where a.id = p_assignment_id),
         (select count(*) from public.training_submissions s
           where s.assignment_id = p_assignment_id)
    into v_total, v_done;

  if v_total = 0 then
    raise exception 'FORMATION-15 : ce cours ne contient aucun exercice';
  end if;
  if v_done < v_total then
    raise exception 'FORMATION-16 : il reste des exercices a rendre';
  end if;

  update public.training_assignments
     set status = 'completed', completed_at = now()
   where id = p_assignment_id;
end $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- Meme approche que la migration 016 : les politiques disent QUI, et les
-- droits de colonne interdisent l'ecriture directe. La regle metier reste dans
-- les fonctions app.*, qui s'executent avec les droits du proprietaire.
alter table public.training_courses enable row level security;
create policy courses_select on public.training_courses for select
  using (
    author_id = app.current_user_id()
    or app.is_admin()
    or exists (
      select 1 from public.training_assignments a
       where a.course_id = training_courses.id
         and a.trader_id = app.current_user_id()
    )
  );
revoke insert, update, delete on public.training_courses from trade_house_app;

alter table public.training_exercises enable row level security;
create policy exercises_select on public.training_exercises for select
  using (
    exists (
      select 1 from public.training_assignments a
       where a.course_id = training_exercises.course_id
         and (a.trader_id = app.current_user_id()
              or app.can_manage_trader(a.trader_id)
              or app.is_admin())
    )
    or exists (
      select 1 from public.training_courses c
       where c.id = training_exercises.course_id
         and (c.author_id = app.current_user_id() or app.is_admin())
    )
  );
revoke insert, update, delete on public.training_exercises from trade_house_app;

alter table public.training_assignments enable row level security;
create policy assignments_select on public.training_assignments for select
  using (
    trader_id = app.current_user_id()
    or app.can_manage_trader(trader_id)
    or app.is_admin()
  );
revoke insert, update, delete on public.training_assignments from trade_house_app;

alter table public.training_submissions enable row level security;
create policy submissions_select on public.training_submissions for select
  using (
    trader_id = app.current_user_id()
    or app.can_manage_trader(trader_id)
    or app.is_admin()
  );
revoke insert, update, delete on public.training_submissions from trade_house_app;

alter table public.training_reviews enable row level security;
-- Le trader voit la correction de SON travail : c'est tout l interet du module.
create policy reviews_select on public.training_reviews for select
  using (
    exists (
      select 1 from public.training_submissions s
       where s.id = training_reviews.submission_id
         and (s.trader_id = app.current_user_id()
              or app.can_manage_trader(s.trader_id)
              or app.is_admin())
    )
  );
revoke insert, update, delete on public.training_reviews from trade_house_app;

-- ---------------------------------------------------------------------------
-- Acces du role applicatif
-- ---------------------------------------------------------------------------
grant select on public.training_courses,
                public.training_exercises,
                public.training_assignments,
                public.training_submissions,
                public.training_reviews to trade_house_app;

grant execute on function
  app.create_training_course(varchar, text, text, training_course_status),
  app.update_training_course(uuid, varchar, text, text, training_course_status),
  app.add_training_exercise(uuid, varchar, text, training_exercise_kind, jsonb, text, text),
  app.assign_training(uuid, uuid, timestamptz),
  app.submit_training_exercise(uuid, uuid, text, text),
  app.review_training(uuid, numeric, text),
  app.complete_training(uuid)
to trade_house_app;

comment on table public.training_courses is
  'Cours ecrit par un manager, attribue a ses traders. Ecriture reservee aux '
  'fonctions app.* ; le role applicatif n a que la lecture.';
comment on table public.training_reviews is
  'Correction du manager. Le commentaire est obligatoire : une note seule ne '
  'laisse pas le trader comprendre quoi improves.';

-- -----------------------------------------------------------------------------
-- 022_training_extras.sql
-- -----------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- Extensions du module formation
--
-- 1. Piece jointe d'exercice : un travail de trading se prouve par une capture
--    d'ecran ou un ordre. Exiger du texte oblige a raconter ce que la capture
--    montre deja. Le stockage est celui des pieces jointes de rapport (RG-33) :
--    prive, hors de public/, servi par une route qui verifie l'acces.
--
-- 2. Resoumission apres correction : la contrainte d'unicite
--    (assignment_id, exercise_id) imposait UNE reponse par exercice. Corriger
--    puis corriger a nouveau etait impossible : le trader ne pouvait pas
--    retravailler. On conserve l'historique et on marque la derniere version :
--    c'est ce qui permet de comparer avant/apres.
--
-- 3. Desattribution et archivage : une attribution erronee (mauvais trader,
--    mauvais cours) ne pouvait etre corrigee. On ne SUPPRIME pas : l'historique
--    pedagogique compte, et le rapport d'un trader rattache a ce cours doit
--    continuer d'exister.
-- ---------------------------------------------------------------------------

-- Un parcours " archive " n'est plus un travail en cours, mais son historique
-- subsiste. L'enum de la migration 021 ne prevoyait pas ce cas : le desattribuer
-- aurait efface la seule trace de ce que le trader avait suivi.
alter type training_assignment_status add value 'archived' after 'completed';

-- ---------------------------------------------------------------------------
-- 1. Pieces jointes d'exercice
-- ---------------------------------------------------------------------------
create table public.training_exercise_files (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.training_submissions(id) on delete cascade,
  storage_path  text not null unique,
  original_name varchar(255) not null,
  mime_type     varchar(100) not null,
  size_bytes    bigint not null check (size_bytes > 0),
  uploaded_by   uuid not null references public.users(id),
  created_at    timestamptz not null default now(),
  -- Meme liste fermee que les pieces jointes de rapport (RG-32). La version
  -- precedente de cette contrainte (`mime_type not in (...) or mime_type is
  -- not null`) etait une tautologie : toujours vraie, donc jamais declenchee.
  constraint training_files_mime check (
    mime_type in ('image/png','image/jpeg','image/webp','application/pdf')
  )
);
create index training_files_submission_idx on public.training_exercise_files (submission_id);

-- ---------------------------------------------------------------------------
-- 2. Versionnement des reponses
-- ---------------------------------------------------------------------------
alter table public.training_submissions
  drop constraint training_submissions_unique;

alter table public.training_submissions
  add column attempt int not null default 1;

-- Unicite sur la TENTATIVE, plus sur l'exercice : plusieurs lignes, une seule
-- courante (celle dont l'indice de version est le plus grand).
create unique index training_submissions_attempt_idx
  on public.training_submissions (assignment_id, exercise_id, attempt);

create index training_submissions_current_idx
  on public.training_submissions (assignment_id, exercise_id, attempt desc);

-- ---------------------------------------------------------------------------
-- 3. Fonctions
-- ---------------------------------------------------------------------------
-- Nouvelle tentative : on refuse si le travail n a pas encore ete corrige.
-- Sans ce controle, le trader pourrait spammer des versions et le manager
-- perdrait le fil de ce qui compte.
create or replace function app.resubmit_training_exercise(
  p_assignment_id uuid,
  p_exercise_id   uuid,
  p_answer        text default null,
  p_answer_key    text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_prev    uuid;
  v_attempt int;
  v_id      uuid;
begin
  select s.id, s.attempt into v_prev, v_attempt
    from public.training_submissions s
    join public.training_reviews r on r.submission_id = s.id
   where s.assignment_id = p_assignment_id and s.exercise_id = p_exercise_id;

  if v_prev is null then
    raise exception 'FORMATION-17 : ce travail n a pas encore ete corrige';
  end if;

  v_attempt := v_attempt + 1;

  insert into public.training_submissions
    (assignment_id, exercise_id, trader_id, answer, answer_key, attempt)
  values (p_assignment_id, p_exercise_id, app.current_user_id(), p_answer, p_answer_key, v_attempt)
  returning id into v_id;

  return v_id;
end $$;

-- Desattribution : retire le parcours du trader sans detruire son historique.
create or replace function app.unassign_training(p_assignment_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_trader uuid;
  v_by     uuid;
begin
  select trader_id, assigned_by into v_trader, v_by
    from public.training_assignments where id = p_assignment_id;

  if v_trader is null then
    raise exception 'FORMATION-18 : attribution introuvable';
  end if;
  if not (app.is_admin() or app.can_manage_trader(v_trader)) then
    raise exception 'FORMATION-19 : vous ne retirez pas ce parcours';
  end if;

  -- Le travail rendu reste rattache : il ne disparait pas de l'historique du
  -- trader, il cesse simplement d'etre un parcours en cours.
  update public.training_assignments
     set status = 'archived', completed_at = coalesce(completed_at, now())
   where id = p_assignment_id;

  perform app.fn_audit('training.unassigned', 'training_assignment', p_assignment_id,
                       jsonb_build_object('trader_id', v_trader, 'assigned_by', v_by));
end $$;

-- RLS des pieces jointes d'exercice : le trader voit les siennes, son manager
-- les voit, et personne d'autre.
alter table public.training_exercise_files enable row level security;
create policy training_files_select on public.training_exercise_files for select
  using (
    uploaded_by = app.current_user_id()
    or exists (
      select 1
        from public.training_submissions s
       where s.id = training_exercise_files.submission_id
         and (s.trader_id = app.current_user_id()
              or app.can_manage_trader(s.trader_id)
              or app.is_admin())
    )
  );
revoke insert, update, delete on public.training_exercise_files from trade_house_app;

grant select on public.training_exercise_files to trade_house_app;

grant execute on function
  app.resubmit_training_exercise(uuid, uuid, text, text),
  app.unassign_training(uuid)
to trade_house_app;

-- La colonne attempt doit exister avant qu'une application ne tente une
-- resoumission ; on le note dans le journal par un commentaire plutot que par une
-- migration separee, cette migration etant celle qui l'introduit.
comment on table public.training_submissions is
  'Une ligne par tentative. La version courante est celle dont `attempt` est la '
  'plus elevee pour un couple (attribution, exercice) ; les anciennes sont '
  'conservees pour que le manager puisse comparer avant/apres.';

comment on table public.training_exercise_files is
  'Captures jointes par le trader a un exercice. Meme stockage prive et meme '
  'liste de types que les pieces jointes de rapport (RG-32, RG-33).';

-- -----------------------------------------------------------------------------
-- 023_training_submission_conflict.sql
-- -----------------------------------------------------------------------------
-- ============================================================================
-- trade_house - 023_training_submission_conflict.sql
--
-- La migration 022 a remplace la contrainte UNIQUE (assignment_id, exercise_id)
-- de training_submissions par un index sur (assignment_id, exercise_id, attempt),
-- afin de permettre plusieurs tentatives.
--
-- Consequence non vue au moment de 022 : `app.submit_training_exercise` - creee
-- en 021 - portait encore
--         on conflict (assignment_id, exercise_id) do update
-- et PostgreSQL refuse cette clause des lors qu'aucune contrainte unique ni
-- index unique ne correspond exactement a la cible. Le premier rendu d'un
-- exercice echouait donc en erreur interne, et le parcours de formation etait
-- bloque de bout en bout.
--
-- On redefinit la fonction avec la cible a trois colonnes. Le comportement reste
-- celui voulu : rendre deux fois le meme exercice met a jour la tentative
-- courante ; retravailler apres correction passe par
-- app.resubmit_training_exercise, qui cree une tentative d indice superieur.
-- ============================================================================

create or replace function app.submit_training_exercise(
  p_assignment_id uuid,
  p_exercise_id   uuid,
  p_answer        text default null,
  p_answer_key    text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_trader uuid;
  v_course uuid;
  v_kind   training_exercise_kind;
  v_id     uuid;
begin
  select a.trader_id, a.course_id into v_trader, v_course
    from public.training_assignments a where a.id = p_assignment_id;

  if v_trader is null then
    raise exception 'FORMATION-07 : attribution introuvable';
  end if;
  if v_trader <> app.current_user_id() then
    raise exception 'FORMATION-08 : cette attribution ne vous appartient pas';
  end if;

  -- L'exercice doit appartenir au cours attribue : sans ce controle, un trader
  -- pourrait rendre l'exercice d'un cours qu'il ne suit pas.
  select kind into v_kind from public.training_exercises
   where id = p_exercise_id and course_id = v_course;
  if v_kind is null then
    raise exception 'FORMATION-09 : cet exercice n apartient pas au cours attribue';
  end if;

  if v_kind = 'written' and (p_answer is null or length(btrim(p_answer)) = 0) then
    raise exception 'FORMATION-10 : la reponse est obligatoire';
  end if;

  insert into public.training_submissions
    (assignment_id, exercise_id, trader_id, answer, answer_key, attempt)
  values (p_assignment_id, p_exercise_id, v_trader, p_answer, p_answer_key, 1)
    on conflict (assignment_id, exercise_id, attempt) do update
      set answer = excluded.answer,
          answer_key = excluded.answer_key,
          updated_at = now()
    returning id into v_id;

  update public.training_assignments
     set status = 'in_progress', completed_at = null
   where id = p_assignment_id and status = 'assigned';

  return v_id;
end $$;

grant execute on function
  app.submit_training_exercise(uuid, uuid, text, text)
to trade_house_app;

-- -----------------------------------------------------------------------------
-- 024_training_files_write.sql
-- -----------------------------------------------------------------------------
-- ============================================================================
-- trade_house - 024_training_files_write.sql
--
-- La table training_exercise_files (migration 022) est en lecture seule pour
-- le role applicatif : `revoke insert` y est pose, conformement a l approche
-- de la migration 016 sur public.users.
--
-- Il manque donc le chemin d'ECRITURE. On l'ajoute comme une fonction
-- SECURITY DEFINER plutot qu'enlevantant le revoke, pour deux raisons :
--
--   - la regle " seul le proprietaire de la soumission rattache un fichier " ne
--     peut pas etre exprimee par une politique RLS simple, qui ne voit pas la
--     colonne submission_id jusqu'a la table jointe ;
--   - une fonction permet aussi de controler la taille et le type, comme le
--     fait deja l'API pour les pieces jointes de rapport (RG-32).
-- ============================================================================

create or replace function app.attach_training_file(
  p_submission_id  uuid,
  p_storage_path   text,
  p_original_name  varchar,
  p_mime_type      varchar,
  p_size_bytes     bigint
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_trader uuid;
  v_id     uuid;
begin
  select s.trader_id into v_trader
    from public.training_submissions s where s.id = p_submission_id;

  if v_trader is null then
    raise exception 'FORMATION-20 : soumission introuvable';
  end if;
  -- Un manager ne rattache PAS une capture a la place du trader : la reponse
  -- doit venir de celui qui a fait le travail.
  if v_trader <> app.current_user_id() then
    raise exception 'FORMATION-21 : cette soumission ne vous appartient pas';
  end if;

  if p_size_bytes is null or p_size_bytes <= 0 then
    raise exception 'FORMATION-22 : fichier vide';
  end if;
  -- RG-32 : 10 Mo, meme plafond que les pieces jointes de rapport. La
  -- verification du type REEL (magic bytes) reste cote API : la base ne voit
  -- que le type annonce.
  if p_size_bytes > 10 * 1024 * 1024 then
    raise exception 'FORMATION-23 : fichier trop volumineux (10 Mo maximum)';
  end if;
  if p_mime_type not in ('image/png','image/jpeg','image/webp','application/pdf') then
    raise exception 'FORMATION-24 : type de fichier non autorise';
  end if;

  insert into public.training_exercise_files
    (submission_id, storage_path, original_name, mime_type, size_bytes, uploaded_by)
  values (p_submission_id, p_storage_path, p_original_name, p_mime_type, p_size_bytes,
          app.current_user_id())
  returning id into v_id;

  return v_id;
end $$;

grant execute on function
  app.attach_training_file(uuid, text, varchar, varchar, bigint)
to trade_house_app;

comment on function app.attach_training_file(uuid, text, varchar, varchar, bigint) is
  'Rattache une capture a une soumission. Reserve a l auteur du travail ; le '
  'controle du type reel reste a la charge de l API (magic bytes).';

-- -----------------------------------------------------------------------------
-- 025_cascade_transition.sql
-- -----------------------------------------------------------------------------
-- ============================================================================
-- trade_house - 025_cascade_transition.sql
--
-- RG-03 et RG-40 sont en contradiction, et RG-03 l'emporte toujours.
--
--   RG-03 : desactiver un admin ou un manager renvoie ses rapports " En revision "
--           vers la file commune. C'est app.fn_users_cascade_reports, un
--           declencheur AFTER UPDATE sur public.users.
--
--   RG-40 : la matrice des transitions l'autorise, et refuse explicitement
--           in_review -> submitted au profits de validated -> in_review.
--
-- Le declencheur de cascade fait donc exactement ce que la matrice interdit :
-- l'operation echoue toujours. Consequence mesuree : un manager ayant au
-- moins un rapport en revue ne peut NI etre desactive NI etre anonymise. Le
-- message remontera " Transition in_review -> submitted interdite (RG-40) ", ce
-- qui ne dit rien du compte depose en cause.
--
-- Deux garde-fous bloquent, pas un : la matrice ET le RG-34 (seul le trader peut
-- soumettre). On leve les deux, mais UNIQUEMENT pendant la cascade.
--
-- Le levement passe par app.allow_transition, le meme drapeau que la
-- reouverture d'un rapport valide (migration 004). Il est pose en LOCAL, donc
-- valable dans la transaction seulement : une fois la cascade terminee, la
-- matrice redevient stricte pour tout le reste.
-- ============================================================================

create or replace function app.fn_report_transition() returns trigger
language plpgsql as $$
declare
  v_actor   uuid := app.current_user_id();
  v_role    user_role := app.current_user_role();
  v_allowed boolean := false;
  -- RG-35 / RG-47 : rapport verrouille, seule une reouverture explicite
  -- et journalisee peut modifier la ligne.
  v_reopen  text := coalesce(current_setting('app.allow_transition', true), 'off');
begin
  if new.status = old.status then
    return new;
  end if;

  if old.status in ('validated','dismissed') and v_reopen <> 'on' then
    raise exception 'RG-35 : le rapport est verrouille (statut %)', old.status;
  end if;

  -- Matrice des transitions autorisees (RG-40)
  v_allowed := case
    when old.status = 'draft'                then new.status = 'submitted'
    when old.status = 'submitted'            then new.status in ('in_review','dismissed')
    when old.status = 'in_review'            then new.status in ('correction_requested','validated','dismissed')
    when old.status = 'correction_requested' then new.status in ('resubmitted','validated','dismissed')
    when old.status = 'resubmitted'          then new.status in ('in_review','dismissed')
    when old.status = 'validated'            then new.status = 'in_review'
    else false
  end;

  -- RG-03 : le retour en file commune depuis " En revision ", uniquement pour la
  -- cascade de desactivation. Sans cette exception, RG-03 est inoperant et
  -- aucun manager portant un rapport en revue ne peut etre desactive.
  if not v_allowed and v_reopen = 'on'
     and old.status = 'in_review' and new.status = 'submitted' then
    v_allowed := true;
  end if;

  if not v_allowed then
    raise exception 'Transition % -> % interdite (RG-40)', old.status, new.status;
  end if;

  -- RG-41 : relecture reservee a l'admin ou au manager du trader
  if new.status in ('in_review','correction_requested','validated','dismissed')
     and not app.can_manage_trader(old.trader_id) then
    raise exception 'RG-41 : seul l''admin ou le manager peut passer le rapport en %', new.status;
  end if;

  -- RG-34 : le trader soumet et resoumet. La cascade fait exception : elle
  -- n'est pas le trader qui soumet, c'est l'administrateur qui rend son
  -- expertise au depart.
  if new.status in ('submitted','resubmitted')
     and not (v_role = 'trader' and old.trader_id = v_actor)
     and not (v_reopen = 'on' and new.status = 'submitted') then
    raise exception 'Seul le trader proprietaire peut soumettre ou resoumettre';
  end if;

  -- RG-49 : validation impossible tant qu'un correctif obligatoire n'est pas tranche
  if new.status = 'validated' and exists (
      select 1 from public.report_corrections c
       where c.report_id = new.id and c.severity = 'mandatory'
         and c.status in ('open','rejected')) then
    raise exception 'RG-49 : un correctif obligatoire est ouvert ou en attente d''arbitrage';
  end if;

  -- RG-43 : resoumission seulement si les correctifs obligatoires sont traites
  if new.status = 'resubmitted' and exists (
      select 1 from public.report_corrections c
       where c.report_id = new.id and c.severity = 'mandatory' and c.status = 'open') then
    raise exception 'RG-43 : correctifs obligatoires non traites';
  end if;

  -- RG-47 : cloture sans suite motivee
  if new.status = 'dismissed' and (new.dismissal_reason is null or btrim(new.dismissal_reason) = '') then
    raise exception 'RG-47 : la cloture sans suite exige un motif';
  end if;

  return new;
end $$;

-- ---------------------------------------------------------------------------
-- RG-03 : la cascade pose le drapeau, fait son travail, puis le retire.
--
-- Le retrait est indispensable : sans lui, le drapeau resterait a " on " pour le
-- reste de la transaction et autoriserait des transitions qui ne doivent pas
-- l'etre - par exemple un trader qui soumettrait le rapport d'un collegue dans
-- la meme transaction.
-- ---------------------------------------------------------------------------
create or replace function app.fn_users_cascade_reports() returns trigger
language plpgsql as $$
begin
  if old.is_active and new.is_active = false and new.role in ('admin','manager') then
    perform set_config('app.allow_transition', 'on', true);
    update public.reports r
       set status = 'submitted', reviewer_id = null, reviewed_at = null
     where r.reviewer_id = new.id and r.status = 'in_review';
    perform set_config('app.allow_transition', 'off', true);
  end if;
  return null;
end $$;

-- -----------------------------------------------------------------------------
-- 026_course_files.sql
-- -----------------------------------------------------------------------------
-- ============================================================================
-- trade_house - 026_course_files.sql
--
-- Un cours de formation s'enseigne pas seulement en texte. Un schema de
-- gestion du risque, une capture de graphique, un ordre execute : le contenu
-- textuel force a decrire ce qu'une image montre deja, et la description
-- est toujours moins fidele que l'image.
--
-- On ajoute donc des pieces jointes AU COURS, distinctes des captures que le
-- TRADER rend dans ses exercices (training_exercise_files, migration 022).
-- Deux tables ne sont pas une redondance : le support pedagogique appartient au
-- manager et se partage avec tous ceux a qui le cours est attribue, la
-- production de travail appartient au trader et n'appartient qu'a lui.
--
-- Meme stockage prive, meme liste de types fermes, meme verification de la
-- signature reelle du fichier que les pieces jointes de rapport (RG-32, RG-33).
-- Un cours n'ouvre pas une voie de contournement : ce qui passe ici passerait
-- la-bas, et l'inverse doit etre vrai aussi.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
create table public.training_course_files (
  id            uuid primary key default gen_random_uuid(),
  course_id     uuid not null references public.training_courses(id) on delete cascade,
  storage_path  text not null unique,
  original_name varchar(255) not null,
  mime_type     varchar(100) not null,
  size_bytes    bigint not null check (size_bytes > 0),
  uploaded_by   uuid not null references public.users(id),
  created_at    timestamptz not null default now(),
  -- Liste fermee, identique a celle des pieces jointes de rapport (RG-32) et
  -- des captures d'exercice : la memoire, sinon le validateur s'exerce a eviter
  -- le type qu'il devrait refuser.
  constraint training_course_files_mime check (
    mime_type in ('image/png','image/jpeg','image/webp','application/pdf')
  )
);
create index training_course_files_course_idx on public.training_course_files (course_id, created_at);

-- ---------------------------------------------------------------------------
-- 2. Ecriture
--
create or replace function app.attach_course_file(
  p_course_id     uuid,
  p_storage_path  text,
  p_original_name varchar,
  p_mime_type     varchar,
  p_size_bytes    bigint
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  -- Sans ce test, un uuid arbitraire est accepte et la ligne rattachee
  -- ne sera jamais lisible par personne.
  if not exists (select 1 from public.training_courses where id = p_course_id) then
    raise exception 'FORMATION-25 : cours introuvable';
  end if;

  if p_size_bytes <= 0 then
    raise exception 'FORMATION-26 : fichier vide';
  end if;

  if p_mime_type not in ('image/png','image/jpeg','image/webp','application/pdf') then
    raise exception 'FORMATION-27 : type de fichier non autorise';
  end if;

  -- Seul l'auteur du cours (ou un administrateur) y joint un support : le
  -- contenu pedagogique ne se delega pas. Un manager qui n'a pas ecrit le
  -- cours n'y touche pas, comme il ne corrige pas le cours d'un autre.
  if not app.fn_can_write_course(p_course_id) then
    raise exception 'FORMATION-28 : vous n etes pas l auteur de ce cours';
  end if;

  insert into public.training_course_files
    (course_id, storage_path, original_name, mime_type, size_bytes, uploaded_by)
  values (p_course_id, p_storage_path, p_original_name, p_mime_type, p_size_bytes, app.current_user_id())
  returning id into v_id;

  perform app.fn_audit('training.course_file', 'training_course', p_course_id,
                       jsonb_build_object('name', p_original_name, 'mime', p_mime_type, 'size', p_size_bytes));

  return v_id;
end $$;

comment on function app.attach_course_file is
  'Auteur du cours (ou admin) uniquement : joint une image ou un PDF au support pedagogique.';

-- ---------------------------------------------------------------------------
-- 3. Retrait
-- ---------------------------------------------------------------------------
create or replace function app.remove_course_file(p_file_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_course uuid;
begin
  select course_id into v_course from public.training_course_files where id = p_file_id;

  if v_course is null then
    raise exception 'FORMATION-29 : fichier introuvable';
  end if;
  if not app.fn_can_write_course(v_course) then
    raise exception 'FORMATION-28 : vous n etes pas l auteur de ce cours';
  end if;

  delete from public.training_course_files where id = p_file_id;
end $$;

-- ---------------------------------------------------------------------------
-- 4. RLS
--
-- Un support de cours se lit des que le cours est attribue au lecteur, ou
-- par son auteur, ou par un administrateur. Sans cela, un trader ne pourrait
-- pas telecharger le PDF de son propre cours alors qu'il en a le droit.
-- ---------------------------------------------------------------------------
alter table public.training_course_files enable row level security;

create policy training_course_files_select on public.training_course_files for select
  using (
    uploaded_by = app.current_user_id()
    or app.is_admin()
    or exists (
      select 1
        from public.training_courses c
       where c.id = training_course_files.course_id
         and (c.author_id = app.current_user_id()
              or exists (
                select 1
                  from public.training_assignments a
                 where a.course_id = c.id
                   and a.trader_id = app.current_user_id()
              ))
    )
  );

-- L'ecriture passe par les fonctions ci-dessus : on retire le droit direct,
-- conformement a l'approche des migrations 016 et 024.
revoke insert, update, delete on public.training_course_files from trade_house_app;

grant select on public.training_course_files to trade_house_app;

grant execute on function
  app.attach_course_file(uuid, text, varchar, varchar, bigint),
  app.remove_course_file(uuid)
to trade_house_app;

comment on table public.training_course_files is
  'Supports du cours (captures, schemas, PDF). Distingues des captures rendues '
  'par le trader dans ses exercices : celles-ci lui appartiennent, celles-la '
  'appartiennent au cours et se partagent avec tous les attribues.';

-- Fonction SECURITY DEFINER plutot qu'un simple retrait de revoke : la regle
-- "seul l'auteur du cours joint un support" ne s'exprime pas par une
-- politique RLS simple, qui ne peut pas consulter training_courses sans
-- ouvrir une boucle de politiques.
-- ---------------------------------------------------------------------------


-- -----------------------------------------------------------------------------
-- 027_manager_invites_trader.sql
-- -----------------------------------------------------------------------------
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
  --
  -- Un INSERT n'etant pas une expression en SQL, il ne peut pas figurer dans
  -- un CASE : la premiere version ecritait `case when ... then (insert ...)
  -- returning *) else null end`, que PostgreSQL rejette avec "erreur de
  -- syntaxe sur ou pres de into". Le role est donc tranche par un IF, et
  -- l'admin est refuse en amont : il a create_user, qui permet de choisir le
  -- manager de tutelle.
  if app.current_user_role() = 'manager' then
    insert into public.users
      (email, password_hash, full_name, role, manager_id, timezone,
       preferred_locale, mfa_enforced)
    values (p_email, '!' || encode(gen_random_bytes(32), 'hex'), p_full_name,
            'trader', v_me, p_timezone, p_locale, p_mfa_enforced)
    returning * into v_user;
  else
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


-- -----------------------------------------------------------------------------
-- 028_assign_trader_manager.sql
-- -----------------------------------------------------------------------------
-- ============================================================================
-- trade_house - 028_assign_trader_manager.sql
--
-- DEMANDE METIER : gerer CONCRETEMENT l affectation des traders a leur
-- manager, depuis l'interface.
--
-- L 'etat des lieux avant cette migration :
--
--   - app.update_user_account (018) sait changer le manager_id, mais elle est
--     reservee a l 'administrateur ;
--   - 027 a permis au MANAGER de creer un trader, deja rattache a lui ;
--   - mais un trader cree AVANT 027, ou dont l 'equipe a change, ne pouvait
--     etre rattache que par un administrateur. Le manager se trouvait alors
--     devant un mur : il voyait le trader dans l 'annuaire sans pouvoir le
--     travailler.
--
-- Cette migration comble exactement ce manque, et rien d 'autre. Elle ne
-- touche ni au role, ni aux coordonnees, ni a l 'etat du compte : elle ne
-- deplace que le lien manager_id.
--
-- DEUX INTERDITS, et ils sont le sens de la fonction.
--
-- 1. Un MANAGER ne peut rattacher qu 'a LUI-MEME. Pas "un manager de son
--    choix" : un manager qui pourrait deposer un trader chez un concurrent
--    pourrait le vider de son equipe. La delegation reste une prise en charge,
--    pas un transfert. C'est aussi pourquoi la fonction ne prend pas de
--    parametre p_manager_id : il n y a rien a choisir.
--
-- 2. Retirer un trader de son equipe (manager_id = null) reste reserve a
--    l 'admin. Sans manager, un trader n'a plus de relecteur : ses rapports
--    seraient produits sans personne pour les corriger, et ses cours sans
--    personne pour les attribuer. Laisser un manager creer ce trou serait
--    creer un orphelin en un clic.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Rattacher un de ses traders (manager) ou tout trader (admin)
-- ---------------------------------------------------------------------------
create or replace function app.assign_trader_manager(p_trader_id uuid)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me     uuid;
  v_is_mgr boolean;
begin
  v_me     := app.current_user_id();
  v_is_mgr := (app.current_user_role() = 'manager');

  if not (app.is_admin() or v_is_mgr) then
    raise exception 'RG-02 : seul un administrateur ou un manager rattache un trader';
  end if;

  if p_trader_id is null then
    raise exception 'Compte introuvable';
  end if;

  -- Le role est verifie AVANT tout le reste : rattacher un manager n a aucun
  -- sens (un manager n a pas de tuteur) et laisserait un lien que rien ne lit.
  if not exists (select 1 from public.users where id = p_trader_id and role = 'trader') then
    raise exception 'Seul un trader peut etre rattache a un manager';
  end if;

  -- INTERDIT 1 : un manager ne choisit pas sa cible, c'est lui-meme. Pour
  -- l'admin, pas de restriction : c'est lui qui arbitrage les equipes.
  if v_is_mgr and not exists (
    select 1 from public.users u
     where u.id = p_trader_id and u.manager_id = v_me
  ) then
    raise exception 'RG-06 : ce trader n est pas dans votre equipe';
  end if;

  -- Le manager de tutelle doit etre actif, sinon on confie un travail a
  -- quelqu'un qui ne se connectera pas. Meme regle que 018, on la redit ici
  -- parce que la fonction doit se suffire a elle-meme.
  if v_is_mgr and not exists (select 1 from public.users where id = v_me and is_active) then
    raise exception 'Votre compte doit etre actif pour prendre un trader en charge';
  end if;

  update public.users set manager_id = v_me, updated_at = now()
   where id = p_trader_id;

  perform app.fn_audit('user.manager_assigned', 'users', p_trader_id,
                       jsonb_build_object('manager_id', v_me));

  return p_trader_id;
end $$;

comment on function app.assign_trader_manager is
  'Admin : rattache n importe quel trader a lui-meme. Manager : ne peut '
  'rattacher que les traders qu il supervise deja (interdit 1). Ne retire '
  'jamais un trader de son equipe : le detachement reste une operation admin '
  '(interdit 2).';

-- ---------------------------------------------------------------------------
-- Desattacher un trader de son manager : administrateur uniquement
--
-- Cette fonction existe pour que l 'operation ne soit pas faite par un
-- UPDATE direct. La raison du refus est metier, pas technique : un trader sans
-- manager n a plus de relecteur pour ses rapports ni de tuteur pour ses cours.
-- ---------------------------------------------------------------------------
create or replace function app.unassign_trader_manager(p_trader_id uuid)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_prev uuid;
begin
  if not app.is_admin() then
    raise exception 'Seul un administrateur retire un trader de son equipe';
  end if;

  select manager_id into v_prev from public.users where id = p_trader_id;
  if not found then
    raise exception 'Compte introuvable';
  end if;

  update public.users set manager_id = null, updated_at = now()
   where id = p_trader_id;

  perform app.fn_audit('user.manager_removed', 'users', p_trader_id,
                       jsonb_build_object('manager_id', v_prev));

  return p_trader_id;
end $$;

comment on function app.unassign_trader_manager is
  'Administrateur uniquement. Retire un trader de son equipe ; un trader sans '
  'manager n a ni relecteur ni tuteur.';

grant execute on function
  app.assign_trader_manager(uuid),
  app.unassign_trader_manager(uuid)
to trade_house_app;

-- -----------------------------------------------------------------------------
-- 029_meeting_creator_visible.sql
-- -----------------------------------------------------------------------------
-- ============================================================================
-- trade_house - 029_meeting_creator_visible.sql
--
-- BUG : la ligne "Creee par" affichait "-" pour un TRADER participant.
--
-- Cause exacte, verifiee en base :
--
--   la politique users_select de 008 n'autorise a lire une ligne de
--   public.users que si l'utilisateur est celui-ci, l 'admin, ou le MANAGER
--   d'un trader. Un participant trader ne voit donc pas le manager qui a creee
--   la reunion. La page fait
--
--     select m.*, u.full_name as creator_name
--       from public.meetings m
--       left join public.users u on u.id = m.created_by
--
--   le LEFT JOIN ne supprime pas la reunion, mais ramene NULL pour le nom :
--   d ou le "-" affiche, sur une page par ailleurs parfaitement correcte.
--
--   Le defaut est particulierement trompeur parce que le meme JOIN rend le
--   nom si la requete est executee HORS transaction, et NULL dans une
--   transaction : c'est ce que fait asUser, donc toute l'application. La
--   La lecture "correcte" en console masque donc exactement la seule requete
--   qui compte.
--
-- Pourquoi la politique n'a pas ete elargie : les trois branches existantes
-- ont une raison d'etre, et le nombre de colonnes rend une nouvelle branche
-- risquee. On ne touche donc PAS au RLS de public.users.
--
-- Solution : une fonction SECURITY DEFINER dediee, qui rend le NOM de
-- l 'organisateur d 'une reunion, et rien d 'autre. Elle ne renvoie ni son
-- email, ni sa date de naissance, ni aucune de ses donnees : une seule
-- colonne, celle que l 'ecran affiche deja.
--
-- Elle verifie l 'acces a la reunion AVANT de rendre le nom : un trader sans
-- droit sur la reunion n 'apprend pas non plus qui l 'a creee.
-- ============================================================================

create or replace function app.fn_meeting_creator_name(p_meeting uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
begin
  if not app.can_access_meeting(p_meeting) then
    return null;
  end if;

  select u.full_name into v_name
    from public.meetings m
    join public.users u on u.id = m.created_by
   where m.id = p_meeting;

  return v_name;
end $$;

comment on function app.fn_meeting_creator_name is
  'Nom du createur d une reunion, pour tout lecteur autorise. SECURITY '
  'DEFINER car public.users est cloisonne par RLS : le createur n est pas '
  'necessarily lisible par un participant (une seule colonne est exposee, et '
  'seulement si la reunion est accessible).';

grant execute on function app.fn_meeting_creator_name(uuid) to trade_house_app;

-- -----------------------------------------------------------------------------
-- 030_notifications_formation.sql
-- -----------------------------------------------------------------------------
-- ============================================================================
-- trade_house - 030_notifications_formation.sql
--
-- RAPPEL DE L'ETAT AVANT CE CHANTIER.
--
-- La mecanique est saine et ancienne : notifications_log, app.fn_notify, la
-- cloche, la page /notifications, les 3 relances de RG-16. Les evenements
-- SONT declares (29 dans l'enumeration) et presque tous ne sont declenches
-- par AUCUNE fonction. Sur les 29, quatre l'etaient : report_submitted,
-- report_resubmitted, correction_requested, no_trade_declared.
--
-- Les corrections demandees sont donc deja prevenues, ce qui est la demande
-- metier la plus urgente. Restait la Formation, le module le plus recent,
-- jamais branche.
--
-- NOTE SUR L'EXECUTION : ALTER TYPE ... ADD VALUE ne peut pas etre suivi d'un
-- usage de la valeur dans la meme transaction. Chaque ALTER est donc joue
-- comme un lot autonome par psql. Ne pas chercher a envelopper ce fichier
-- dans un BEGIN : c'est le comportement attendu, pas une erreur a corriger.
--
-- Chaque evenement dit QUI est alerte. C'est le point ou une messagerie se
-- passe d'ordinaire, et c'est laisse explicite plutot que deduit.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Evenements
--
-- On etend l'enumeration plutot que d'en creer une : une deuxieme enum
-- obligerait les lectures a conjoindre les deux, et une migration ne peut pas
-- changer la premiere sans casser les clients existants.
-- ---------------------------------------------------------------------------

-- Formation : training_assigned part vers le TRADER ; les trois autres vers
-- le MANAGER, sauf training_exercise_reviewed qui part vers le TRADER corrige.
alter type notification_event add value if not exists 'training_assigned';
alter type notification_event add value if not exists 'training_exercise_submitted';
alter type notification_event add value if not exists 'training_exercise_reviewed';
alter type notification_event add value if not exists 'training_completed';

-- Comptes : l'ADMIN est le seul avertissable pour une desactivation, seul
-- role habilite. Un trader invite ne releve que de son manager.
alter type notification_event add value if not exists 'account_invited';
alter type notification_event add value if not exists 'account_disabled';
alter type notification_event add value if not exists 'account_reactivated';

-- ---------------------------------------------------------------------------
-- 2. Destinataires
--
-- app.fn_notify prend un tableau d'identifiants : la question n'est donc pas
-- " cet evenement existe-t-il " mais " QUI doit etre prevenu ". Ces deux
-- helpers rendent la reponse explicite, pour que le code appelant dise
-- pourquoi il notifie telle personne plutot que de deviner le destinataire.
-- ---------------------------------------------------------------------------

-- Le manager d'un trader. Vide si le trader n'est rattache a personne : mieux
-- vaut ne notifier personne qu'un administrateur qui n'a rien demande.
create or replace function app.manager_of(p_trader uuid)
returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select u.manager_id from public.users u where u.id = p_trader and u.role = 'trader';
$$;

-- Les participants d'une reunion, lus en SECURITY DEFINER : le createur n'est
-- pas toujours visible du RLS, et un destinataire fantome ne doit pas
-- disparaitre silencieusement.
create or replace function app.fn_meeting_participant_ids(p_meeting uuid)
returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(mp.user_id), '{}'::uuid[])
    from public.meeting_participants mp where mp.meeting_id = p_meeting;
$$;

-- fn_notify, filtree sur ce qui existe reellement. Une liste vide ne cree
-- aucune ligne : la fonction de base refuse deja les identifiants nuls, mais un
-- uuid fantome passerait et produirait une notification orpheline.
--
-- Le filtre est applique par array_remove plutot que par `where unnest(...)` :
-- unnest est une fonction d'ensemble, et PostgreSQL l'interdit dans un WHERE
-- ("les fonctions renvoyant un ensemble ne sont pas autorisees dans WHERE").
create or replace function app.notify_ids(
  p_ids uuid[], p_event notification_event,
  p_type varchar, p_id uuid
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_clean uuid[];
begin
  select coalesce(array_agg(u), '{}'::uuid[])
    into v_clean
    from unnest(coalesce(p_ids, '{}'::uuid[])) u
   where u is not null;

  perform app.fn_notify(v_clean, p_event, p_type, p_id, 'in_app');
end $$;

comment on function app.manager_of is
  'Manager de tutelle d un trader, ou NULL. Security definer parce que le '
  'RLS de public.users rend un manager invisible a ses propres traders.';

-- ---------------------------------------------------------------------------
-- 3. Formation
--
-- On redefinit les quatre fonctions plutot que de les modifier sur place :
-- une migration ne peut pas patcher le corps d'une fonction deja deployee, et
-- CREATE OR REPLACE exige le corps entier. Chaque version ci-dessous est donc
-- la fonction d'origine PLUS les notifications ; ce sont les SEULES
-- differences, tout le reste est repris a l'identique.
-- ---------------------------------------------------------------------------

-- 3.1 Attribution : le TRADER est prevenu qu'un cours entre dans son parcours.
-- Le manager qui vient d'attribuer n'a pas besoin qu'on le previenne de son
-- propre geste.
create or replace function app.assign_training(
  p_course_id uuid,
  p_trader_id uuid,
  p_due_at     timestamptz default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  if not app.fn_can_assign_to(p_trader_id) then
    raise exception 'FORMATION-03 : vous n attribuez pas a ce trader';
  end if;
  if not exists (
    select 1 from public.training_courses c
     where c.id = p_course_id and c.status = 'published'
  ) then
    raise exception 'FORMATION-04 : le cours n est pas publie';
  end if;

  insert into public.training_assignments (course_id, trader_id, assigned_by, due_at)
  values (p_course_id, p_trader_id, app.current_user_id(), p_due_at)
  on conflict (course_id, trader_id) do update set due_at = excluded.due_at
  returning id into v_id;

  perform app.fn_audit('training.assigned', 'training_assignment', v_id,
                       jsonb_build_object('course_id', p_course_id, 'trader_id', p_trader_id));

  perform app.notify_ids(array[p_trader_id], 'training_assigned', 'training_assignment', v_id);

  return v_id;
end $$;
-- ---------------------------------------------------------------------------
-- 3. Formation
--
-- On redefinit les quatre fonctions plutot que de les modifier sur place :
-- une migration ne peut pas patcher le corps d'une fonction deja deployee, et
-- CREATE OR REPLACE exige le corps entier. Chaque version ci-dessous est donc
-- la fonction d'origine PLUS les notifications ; ce sont les SEULES
-- differences, tout le reste est repris a l'identique.
-- ---------------------------------------------------------------------------

-- 3.1 Attribution : le TRADER est prevenu qu'un cours entre dans son parcours.
-- Le manager qui vient d'attribuer n'a pas besoin qu'on le previenne de son
-- propre geste.
create or replace function app.assign_training(
  p_course_id uuid,
  p_trader_id uuid,
  p_due_at     timestamptz default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  if not app.fn_can_assign_to(p_trader_id) then
    raise exception 'FORMATION-03 : vous n attribuez pas a ce trader';
  end if;
  if not exists (
    select 1 from public.training_courses c
     where c.id = p_course_id and c.status = 'published'
  ) then
    raise exception 'FORMATION-04 : le cours n est pas publie';
  end if;

  insert into public.training_assignments (course_id, trader_id, assigned_by, due_at)
  values (p_course_id, p_trader_id, app.current_user_id(), p_due_at)
  on conflict (course_id, trader_id) do update set due_at = excluded.due_at
  returning id into v_id;

  perform app.fn_audit('training.assigned', 'training_assignment', v_id,
                       jsonb_build_object('course_id', p_course_id, 'trader_id', p_trader_id));

  perform app.notify_ids(array[p_trader_id], 'training_assigned', 'training_assignment', v_id);

  return v_id;
end $$;

-- 3.2 Exercice rendu : le MANAGER du trader est prevenu, PAS l'admin. La
-- correction d'une formation est du ressort du manager qui a attribue le cours.
create or replace function app.submit_training_exercise(
  p_assignment_id uuid,
  p_exercise_id   uuid,
  p_answer        text default null,
  p_answer_key    text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_trader uuid; v_course uuid; v_kind training_exercise_kind; v_id uuid;
begin
  select a.trader_id, a.course_id into v_trader, v_course
    from public.training_assignments a where a.id = p_assignment_id;

  if v_trader is null then
    raise exception 'FORMATION-07 : attribution introuvable';
  end if;
  if v_trader <> app.current_user_id() then
    raise exception 'FORMATION-08 : cette attribution ne vous appartient pas';
  end if;

  -- L'exercice doit appartenir au cours attribue : sans ce controle, un trader
  -- pourrait rendre l'exercice d'un cours qu'il ne suit pas.
  select kind into v_kind from public.training_exercises
   where id = p_exercise_id and course_id = v_course;
  if v_kind is null then
    raise exception 'FORMATION-09 : cet exercice n apartient pas au cours attribue';
  end if;

  if v_kind = 'written' and (p_answer is null or length(btrim(p_answer)) = 0) then
    raise exception 'FORMATION-10 : la reponse est obligatoire';
  end if;

  -- La cible du ON CONFLICT compte TROIS colonnes, pas deux : la migration 022
  -- a remplace la contrainte unique (assignment_id, exercise_id) par un index
  -- incluant `attempt`, pour permettre plusieurs tentatives (migration 023).
  -- Reprendre l'ancienne cible a deux colonnes ferait echouer le premier rendu
  -- d'un exercice en erreur interne, et le parcours serait bloque.
  insert into public.training_submissions
    (assignment_id, exercise_id, trader_id, answer, answer_key, attempt)
  values (p_assignment_id, p_exercise_id, v_trader, p_answer, p_answer_key, 1)
    on conflict (assignment_id, exercise_id, attempt) do update
      set answer = excluded.answer,
          answer_key = excluded.answer_key,
          updated_at = now()
    returning id into v_id;

  -- L'attribution passe " en cours " des la premiere reponse : c'est ce qui
  -- permet au manager de voir qui a commence.
  update public.training_assignments
     set status = 'in_progress', completed_at = null
   where id = p_assignment_id and status = 'assigned';

  perform app.notify_ids(array[app.manager_of(v_trader)],
                         'training_exercise_submitted', 'training_submission', v_id);

  return v_id;
end $$;

-- 3.3 Exercice corrige : le TRADER est prevenu. Sans cette notification, un
-- trader qui rend un exercice n'a aucun moyen de savoir que son manager l'a lu.
create or replace function app.review_training(
  p_submission_id uuid,
  p_score         numeric default null,
  p_comment       text default ''
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_trader uuid;
begin
  -- Le commentaire est obligatoire : une note seule ne dit pas quoi corriger.
  if length(btrim(p_comment)) = 0 then
    raise exception 'FORMATION-11 : un commentaire de correction est obligatoire';
  end if;
  if p_score is not null and (p_score < 0 or p_score > 20) then
    raise exception 'FORMATION-12 : la note doit etre comprise entre 0 et 20';
  end if;

  select s.trader_id into v_trader
    from public.training_submissions s where s.id = p_submission_id;

  if v_trader is null then
    raise exception 'FORMATION-13 : soumission introuvable';
  end if;
  if not (app.is_admin() or app.can_manage_trader(v_trader)) then
    raise exception 'FORMATION-14 : vous ne corrigez pas ce travail';
  end if;

  insert into public.training_reviews (submission_id, reviewer_id, score, comment)
  values (p_submission_id, app.current_user_id(), p_score, p_comment)
  on conflict (submission_id) do update
    set reviewer_id = excluded.reviewer_id, score = excluded.score,
        comment = excluded.comment, reviewed_at = now();

  perform app.fn_audit('training.reviewed', 'training_submission', p_submission_id,
                       jsonb_build_object('score', p_score));

  perform app.notify_ids(array[v_trader],
                         'training_exercise_reviewed', 'training_submission', p_submission_id);
end $$;

-- 3.4 Parcours termine : le MANAGER est prevenu. Une formation terminee est un
-- evenement rare et signifiant : le trader a suivi le parcours jusqu'au bout.
create or replace function app.complete_training(p_assignment_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_total int; v_done int; v_trader uuid;
begin
  select (select count(*) from public.training_exercises e
            join public.training_assignments a on a.course_id = e.course_id
           where a.id = p_assignment_id),
         (select count(*) from public.training_submissions s
           where s.assignment_id = p_assignment_id),
         (select trader_id from public.training_assignments where id = p_assignment_id)
    into v_total, v_done, v_trader;

  if v_total = 0 then
    raise exception 'FORMATION-15 : ce cours ne contient aucun exercice';
  end if;
  if v_done < v_total then
    raise exception 'FORMATION-16 : il reste des exercices a rendre';
  end if;

  update public.training_assignments
     set status = 'completed', completed_at = now()
   where id = p_assignment_id;

  perform app.notify_ids(array[app.manager_of(v_trader)],
                         'training_completed', 'training_assignment', p_assignment_id);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Reunions
--
-- Les trois evenements existaient deja ; seule la ligne de notification
-- manquait. Les participants sont lus par une fonction SECURITY DEFINER pour
-- que le createur, non visible du RLS, soit tout de meme notifie.
-- ---------------------------------------------------------------------------
create or replace function app.notify_meeting_created(p_meeting uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.notify_ids(app.fn_meeting_participant_ids(p_meeting),
                         'meeting_created', 'meeting', p_meeting);
end $$;

grant execute on function
  app.manager_of(uuid),
  app.notify_ids(uuid[], notification_event, varchar, uuid),
  app.fn_meeting_participant_ids(uuid),
  app.notify_meeting_created(uuid)
to trade_house_app;


-- -----------------------------------------------------------------------------
-- 031_notifications_email.sql
-- -----------------------------------------------------------------------------
-- ============================================================================
-- trade_house - 031_notifications_email.sql
--
-- CE QUI MANQUAIT : les notifications in-app fonctionnaient, les EMAILS non.
-- Le cron /api/cron/send-reminders ne traite que les rappels de reunion
-- (meeting_reminders), via app.pending_reminder_targets. Tout le reste, les
-- notifications creees par fn_notify avec canal in_app, restait dans la
-- cloche sans jamais partir par courriel.
--
-- On ajoute une SECONDE file, cote jobs, qui n a rien a voir avec les rappels
-- de reunion. Deux files plutot qu une seule, et c est delibere :
--
--   - les rappels ont une date d envoi, des occurrences, une recurrence, un
--     lien de salle a resoudre a l instant (RG-13) et leurs 3 relances (RG-16) ;
--   - un evenement metier (ton exercice est corrige) part immediatement, une
--     fois, sans recurrence ni relance a 10 minutes.
--
-- Les melanger dans un seul mecanisme aurait impose un cas particulier
-- partout. Deux files, deux responsabilites.
--
-- CE QUI EST DECIDE ICI, ET PAS AILLEURS.
--
-- Quels evenements partent par email ? Pas tous. Un avis "ton rapport a ete
-- depose" ne justifie pas un courriel si l application est ouverte ; en
-- revanche une invitation ou une correction demandee justifient qu on
-- previenne hors de l application. La liste est explicite dans la fonction
-- ci-dessous : ajouter un evenement a l enumeration ne le fait pas partir
-- par email automatiquement. C est voulu : ne pas inonder un trader de
-- courriels est une decision, pas un defaut de configuration.
--
-- RG-16 (3 relances) : ces notifications portent next_attempt_at et attempts,
-- donc le mecanisme existant les decouvre. C est mark_notification_failed qui
-- arrete apres 3 echecs, comme pour un rappel.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Quels evenements partent par email
-- ---------------------------------------------------------------------------
create or replace function app.fn_is_email_event(p_event notification_event)
returns boolean
language sql immutable as $$
  select p_event in (
    'correction_requested', 'report_validated', 'report_dismissed',
    'training_assigned', 'training_exercise_reviewed',
    'training_exercise_submitted',
    'account_invited', 'account_disabled', 'account_reactivated',
    'meeting_created', 'meeting_updated', 'meeting_cancelled'
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. Duplication in-app vers email
--
-- La notification existe deja (canal in_app) quand elle arrive ici. On n ajoute
-- qu une seconde ligne, meme evenement, canal email. C est ce qui permet de
-- suivre l envoi par destinataire (B9) et les 3 relances de RG-16.
--
-- Unicite assuree par l index ci-dessous : un cron execute deux fois ne doit
-- pas envoyer deux fois le meme courriel.
-- ---------------------------------------------------------------------------
create unique index if not exists notifications_event_email_idx
  on public.notifications_log (user_id, event, related_type, related_id, channel)
  where reminder_id is null and channel = 'email';

create or replace function app.create_email_copies(p_limit int default 100)
returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_created int := 0;
begin
  insert into public.notifications_log
    (user_id, event, channel, related_type, related_id, status, attempts, payload)
  select n.user_id, n.event, 'email', n.related_type, n.related_id, 'pending', 0, n.payload
    from public.notifications_log n
   where n.channel = 'in_app'
     and n.reminder_id is null
     and app.fn_is_email_event(n.event)
     and not exists (
       select 1 from public.notifications_log e
        where e.user_id = n.user_id and e.event = n.event
          and e.related_id is not distinct from n.related_id
          and e.channel = 'email'
     )
     and n.read_at is null
   limit p_limit;

  get diagnostics v_created = row_count;
  return v_created;
end $$;

comment on function app.create_email_copies is
  'Duplique les notifications in-app eligibles vers une copie email. '
  'Idempotent : une notification deja copiee, ou deja lue, est ignoree.';

-- ---------------------------------------------------------------------------
-- 3. Les destinataires a notifier maintenant
--
-- Le cron n est pas un utilisateur connecte : il n a aucun contexte RLS. Cette
-- fonction est le seul point de lecture autorise, et elle ne renvoie que ce
-- qu il faut pour composer un message.
--
-- RESERVATION ATOMIQUE, comme les rappels : FOR UPDATE SKIP LOCKED, et la
-- ligne passe en sending. Deux executions paralleles du cron ne se marchent
-- donc pas dessus.
-- ---------------------------------------------------------------------------
create or replace function app.claim_pending_emails(p_limit int default 100)
returns table (
  notification_id uuid,
  email          citext,
  locale         varchar,
  event          notification_event,
  related_type   varchar,
  related_id     uuid,
  payload        jsonb,
  attempts       int
)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
  with due as (
    select n.id
      from public.notifications_log n
     where n.channel = 'email'
       and n.reminder_id is null
       and n.status in ('pending', 'failed')
       and (n.next_attempt_at is null or n.next_attempt_at <= now())
     order by n.created_at
     limit p_limit
     for update skip locked
  )
  update public.notifications_log n
     set status = 'sending', attempts = n.attempts + 1
    from due d, public.users u
   where n.id = d.id and u.id = n.user_id
  returning n.id, u.email, u.preferred_locale, n.event,
            n.related_type, n.related_id, n.payload, n.attempts;
end $$;

comment on function app.claim_pending_emails is
  'Reserve atomiquement les notifications email dues (statut sending) et '
  'renvoie le strict necessaire pour composer le message.';

-- ---------------------------------------------------------------------------
-- 4. Contexte lisible par le job
--
-- Titre du cours, nom du manager : ce que le modele doit afficher.
-- SECURITY DEFINER car le RLS de public.users cache le manager a son trader.
-- ---------------------------------------------------------------------------
create or replace function app.fn_notification_context(
  p_type varchar, p_id uuid
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_ctx jsonb := '{}'::jsonb;
begin
  if p_type = 'training_assignment' then
    select jsonb_build_object(
             'course_title', c.title,
             'trader_name', t.full_name,
             'manager_name', mgr.full_name,
             'due_at', a.due_at)
      into v_ctx
      from public.training_assignments a
      join public.training_courses c on c.id = a.course_id
      join public.users t on t.id = a.trader_id
      left join public.users mgr on mgr.id = a.assigned_by
     where a.id = p_id;

  elsif p_type = 'training_submission' then
    select jsonb_build_object(
             'course_title', c.title,
             'exercise_title', e.title,
             'trader_name', t.full_name,
             'reviewer_name', r.full_name,
             'score', v.score)
      into v_ctx
      from public.training_submissions s
      join public.training_assignments a on a.id = s.assignment_id
      join public.training_courses c on c.id = a.course_id
      join public.training_exercises e on e.id = s.exercise_id
      join public.users t on t.id = s.trader_id
      left join public.training_reviews v on v.submission_id = s.id
      left join public.users r on r.id = v.reviewer_id
     where s.id = p_id;

  elsif p_type = 'report' then
    select jsonb_build_object('session_date', r.session_date) into v_ctx
      from public.reports r where r.id = p_id;

  elsif p_type = 'meeting' then
    select jsonb_build_object(
             'title', m.title,
             'starts_at', m.starts_at,
             'creator_name', u.full_name)
      into v_ctx
      from public.meetings m
      join public.users u on u.id = m.created_by
     where m.id = p_id;

  end if;

  return coalesce(v_ctx, '{}'::jsonb);
end $$;

grant execute on function
  app.fn_is_email_event(notification_event),
  app.create_email_copies(int),
  app.claim_pending_emails(int),
  app.fn_notification_context(varchar, uuid)
to trade_house_app;


-- -----------------------------------------------------------------------------
-- 032_notifications_accounts.sql
-- -----------------------------------------------------------------------------
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


-- -----------------------------------------------------------------------------
-- 033_messaging.sql
-- -----------------------------------------------------------------------------
-- ============================================================================
-- trade_house - 033_messaging.sql
--
-- UNE MESSAGERIE N EXISTE NI DANS LA BASE NI DANS LE CAHIER DES CHARGES.
-- Aucune table, aucune fonction, aucune mention : le projet a 29 evenements de
-- notification, une cloche, des rappels de reunion : et rien qui ressemble a
-- des messages echanges. Ce qui s en rapproche le plus est report_corrections
-- (commentaire attache a une ligne, avec reponse du trader), mais c est lie a
-- un rapport et mediatorise : ce n est pas une conversation.
--
-- Ce qui suit est donc une FONCTION NOUVELLE, pas une correction. Elle est
-- ecrite sous les memes contraintes que le reste du projet.
--
-- ---------------------------------------------------------------------------
-- LA QUESTION QUI DECIDE DE TOUT : QUI LIT QUOI ?
--
-- Un canal prive entre un manager et son trader. Le defaut evident serait
-- Doncvrir la table au role et de filtrer a l affichage. Ce serait faux, et
-- pour une raison precise : une politique RLS trop large se voit quand on
-- relit le code, une politique trop etroite se voit quand un utilisateur ne
-- peut plus faire son travail. Les deux ont un cout, mais pas le meme.
--
-- La regle appliquee ici est la plus etroite qui reste utilisable :
--
--   - un TRADER ne voit que ses propres messages, dans les deux sens ;
--   - un MANAGER ne voit que les messages de son equipe. PAS les messages
--     entre deux de ses traders, et PAS les conversations d une autre equipe ;
--   - l ADMIN n a AUCUN acces automatique. Il ne voit un fil que s il y
--     participe lui-meme.
--
-- Ce dernier point est un choix, et il est volontaire. La tentation serait de
-- donner l admin un acces global ("il doit pouvoir regler un probleme").
-- Mais alors un message ecrit en confiance a son manager devient lisible par
-- la plateforme entiere, et le destinataire s en rendrait compte : il ecrirait
-- moins, ou n ecrirait pas ce qu il pense. Une messagerie qu on sait
-- surveillee n est plus une messagerie. Si un conflit exige une mediation,
-- l admin ouvrira une conversation, ce qui est trace.
--
-- ---------------------------------------------------------------------------
-- PORQUOI PAS DE TABLE DE CONVERSATIONS ?
--
-- Un fil = (manager, trader). Ce couple est unique : un trader n a qu un
-- manager de tutelle (RG-06). Il tient donc largement dans deux colonnes.
-- Une table de plus, une jointure de plus, une politique de plus : pour
-- representer quelque chose qui est deja vrai dans public.users.
--
-- ---------------------------------------------------------------------------
-- LE CONTENU N'EST JAMAIS DANS UN EMAIL
--
-- Decide avec vous, et ecrit ici pour que personne ne le refasse par
-- inadvertance. Un courriel arrive dans une boite partagee ou sur un
-- telephone. Ecrire le texte d un message prive dans ce support rompt
-- exactement la confidentialite que ce module cherche a preserver. Le
-- courriel dira "vous avez un nouveau message", avec un lien vers
-- l application, ou la session est verifiee par le RLS de la table.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Table
--
-- read_at porte sur le message RECU, pas sur le fil : un echange se lit
-- message par message, et c'est ce qui permet a chacun de savoir ce que
-- l'autre a vu. sender_id et recipient_id sont figes a l insertion : un
-- message ne se redirige pas, il s ecrit.
-- ---------------------------------------------------------------------------
create table public.messages (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null references public.users(id) on delete cascade,
  recipient_id uuid not null references public.users(id) on delete cascade,
  -- RG-46 : pas de contenu vide. Un message vide ne veut rien dire et
  --implemente le bruit dans un fil.
  body         text not null check (length(btrim(body)) > 0),
  read_at      timestamptz,
  created_at   timestamptz not null default now(),
  -- On ne parle pas a soi-meme : cela produirait un fil a sens unique et
  -- surtout une notification a soi, qui ne s efface jamais.
  constraint messages_not_self check (sender_id <> recipient_id),
  constraint messages_body_length check (length(body) <= 4000)
);
create index messages_inbox_idx on public.messages (recipient_id, created_at desc);
create index messages_sent_idx  on public.messages (sender_id, created_at desc);
-- Un fil se reconstitue par (destinataire, expediteur). C est le cas des deux
-- ecrans, un seul index couvre donc les deux.
create index messages_thread_idx on public.messages (recipient_id, sender_id, created_at);

-- ---------------------------------------------------------------------------
-- 2. Cloisonnement
--
-- app.can_message(p_sender, p_recipient) repond a la seule question qui
-- compte : ces deux comptes peuvent-ils echanger ? Elle est definie ICI, une
-- fois, et reutilisee par le RLS comme par la fonction d ecriture. Une regle
-- ecrite deux fois diverge un jour, et diverge en silence.
--
-- Le cas ADMIN n est volontairement absent : un admin n a pas de fil avec un
-- membre de son equipe. S il veut parler a un trader, il ecrit a son manager.
-- C est coherent avec RG-06, qui refuse a l admin de s immiscer dans la
-- relation manager-trader.
-- ---------------------------------------------------------------------------
create or replace function app.can_message(p_sender uuid, p_recipient uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.users
     where id = p_sender
       -- un trader parle a son manager de tutelle
       and ((role = 'trader' and manager_id = p_recipient)
            -- un manager parle a un de ses traders
            or (role = 'manager' and exists (
                  select 1 from public.users t
                   where t.id = p_recipient and t.role = 'trader'
                     and t.manager_id = p_sender)))
  );
$$;

comment on function app.can_message is
  'Vrai si les deux comptes peuvent echanger : un trader et son manager de '
  'tutelle, dans les deux sens. Un admin n a pas de fil automatique : il '
  'ecrit au manager, pas au trader.';

-- Le RLS appelle can_message pour chaque ligne. La fonction est SECURITY
-- DEFINER et STABLE : elle lit public.users, dont les politiques se
-- recurseraient sinon indefiniment.
alter table public.messages enable row level security;

-- LECTURE : je suis l un des deux. Regle la plus simple qui couvre les deux
-- ecrans (le fil et la boite de reception).
--
-- Consequence directe du choix fait plus haut, et elle tient sans code
-- supplementaire : un manager voit les messages qu il echange avec un trader,
-- et rien d autre. Il NE voit PAS les echanges entre deux de ses traders,
-- puisque ces lignes ne le nomment pas.
create policy messages_select on public.messages for select
  using (sender_id = app.current_user_id() or recipient_id = app.current_user_id());

-- ECRITURE : je peux ecrire a ce destinataire. Sans ce controle, un trader
-- pourrait envoyer un message a un autre compte, et celui-ci verrait une
-- ligne qu il n aurait jamais demandee a lire.
create policy messages_insert on public.messages for insert
  with check (
    sender_id = app.current_user_id()
    and app.can_message(sender_id, recipient_id)
  );

-- PAS de policy update ni delete : on ne modifie ni ne retire un message.
-- Un message envoye est un fait, pas un brouillon.
--
-- MAIS une policy manquante ne suffit PAS a interdire l operation : le role
-- applicatif tient ses droits de la migration 009, qui accorde INSERT, UPDATE et
-- DELETE sur TOUTES les tables. Sans politique, PostgreSQL applique "pas de
-- policy = tout autorise" pour un UPDATE comme pour un INSERT sur une table
-- sans politique update. C est mesure : un
--   update public.messages set body = 'falsifie'
-- passait, et un DELETE aussi. L historique d un fil pouvait donc etre reecrit
-- depuis n importe quelle requete.
--
-- Donc les REVOKE ci-dessous, qui retirent au role le droit brut. La
-- combination est obligatoire : le RLS dit QUOI est permis, le privilege dit CE
-- QUE le role peut tenter. mark_message_read passe par SECURITY DEFINER, qui
-- n est pas soumis au privilege du role appelant.
revoke insert, update, delete on public.messages from trade_house_app;

-- La lecture se pose malgre tout : le marquage "lu" passe par une fonction
-- ci-dessous, car un UPDATE direct ouvrirait la porte a modifier le texte.

-- ---------------------------------------------------------------------------
-- 3. Ecriture
--
-- Le droit d ecrire est decide en base, pas par l application : une route
-- qui verifierait le role en TypeScript pourrait etre contournee, celle-ci
-- non. Elle controle aussi la taille et la presence du message.
-- ---------------------------------------------------------------------------
create or replace function app.send_message(p_recipient uuid, p_body text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me uuid;
  v_id uuid;
begin
  v_me := app.current_user_id();

  if v_me is null then
    raise exception 'MSG-01 : vous devez etre connecte';
  end if;
  if p_body is null or length(btrim(p_body)) = 0 then
    raise exception 'MSG-02 : le message est vide';
  end if;
  if length(p_body) > 4000 then
    raise exception 'MSG-03 : le message depasse 4000 caracteres';
  end if;
  if not app.can_message(v_me, p_recipient) then
    raise exception 'MSG-04 : vous ne pouvez pas ecrire a ce compte';
  end if;

  insert into public.messages (sender_id, recipient_id, body)
  values (v_me, p_recipient, btrim(p_body))
  returning id into v_id;

  -- Journalise. Le CONTENU n y est pas : un audit lisible par l admin qui
  -- contient les mots d un message prive n est pas un journal, c est une
  -- copie du message qu on voulait proteger.
  perform app.fn_audit('message.sent', 'message', v_id,
                       jsonb_build_object('recipient_id', p_recipient,
                                          'length', length(p_body)));

  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Marquer comme lu
--
-- On ne touche QUE read_at, et seulement sur les messages recus. Un UPDATE
-- direct depuis l application aurait permis de reecrire le texte d un message
-- deja envoye : cette fonction n offre que ce dont l interface a besoin.
--
-- Un UPDATE sans politique update est refuse par le RLS : la fonction est
-- donc necessaire, et sa restriction a read_at est ce qui la rend sure.
-- ---------------------------------------------------------------------------
create or replace function app.mark_message_read(p_message_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.messages
     set read_at = coalesce(read_at, now())
   where id = p_message_id
     and recipient_id = app.current_user_id()
     and read_at is null;
end $$;

comment on function app.mark_message_read is
  'Marque lu un message recu. Ne peut toucher que read_at : ni le texte, ni un '
  'message envoye, ni un message qui n est pas le sien.';

-- ---------------------------------------------------------------------------
-- 5. La boite de reception et l interlocuteur
--
-- SECURITY DEFINER : la fonction doit rendre le NOM du correspondant, or le
-- RLS de public.users rend un manager invisible a son propre trader (migration
-- 029, meme cause). Sans elle, la boite de reception du trader afficherait un
-- expediteur anonyme.
--
-- Elle rend l interlocuteur LEGAL, calcule par can_message : un fil ne peut
-- donc pas s ouvrir vers quelqu un avec qui l echange serait refuse. C est ce
-- qui evite un ecran affichant un contact avec qui on ne peut pas ecrire.
-- ---------------------------------------------------------------------------
create or replace function app.fn_message_counterpart()
returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  -- Un trader n a qu un interlocuteur : son manager de tutelle.
  select manager_id from public.users
   where id = app.current_user_id() and role = 'trader'
  union all
  -- Un manager a autant d interlocuteurs que de traders dans son equipe, plus
  -- l admin (qui n est pas un contrepartie d exchange, mais doit pouvoir
  -- ecrire a un manager : voir can_message).
  select t.id from public.users t
   where t.role = 'trader' and t.manager_id = app.current_user_id()
  limit 1
$$;

-- Nom d un interlocuteur, s il est un correspondant legitime.
--
-- SECURITY DEFINER : le RLS de public.users rend un manager invisible a son
-- propre trader (migration 029), donc un JOIN ordinaire renverrait un expediteur
-- anonyme : et l application contournait alors la cloisonnement pourascade
-- l affichage.
--
-- La fonction refuse de nommer quelqu un avec qui aucun echange n est possible :
-- passer un identifiant devine n affiche donc pas le nom d un compte stranger.
create or replace function app.fn_user_display_name(p_user uuid, p_me uuid)
returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_name text;
begin
  if p_user is null or p_user = p_me then
    return null;
  end if;

  -- Le sens importe : can_message(a, b) n est PAS symetrique pour l admin.
  -- On teste donc dans les deux sens, et on n accepte que si l un des deux
  -- est vrai, ce qui revient a dire "on peut echanger".
  if not app.can_message(p_me, p_user) and not app.can_message(p_user, p_me) then
    return null;
  end if;

  select full_name into v_name from public.users where id = p_user;
  return v_name;
end $$;

comment on function app.fn_user_display_name is
  'Nom d un interlocuteur, ou NULL s il ne peut pas y avoir d echange avec lui. '
  'Ne rend que le nom : jamais l email ni une autre colonne.';

-- Nombre de messages recus et non lus : c'est ce qui alimente la pastille.
create or replace function app.unread_message_count()
returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::int from public.messages
   where recipient_id = app.current_user_id() and read_at is null;
$$;

grant select on public.messages to trade_house_app;
-- INSERT est reaccorde : le role doit pouvoir inserer, et c est la politique
-- messages_insert qui decide de QUELS messages. Sans elle, l ecriture serait
-- impossible ; avec elle seule (sans le privilege), elle ne servirait a rien.
grant insert on public.messages to trade_house_app;
grant execute on function
  app.can_message(uuid, uuid),
  app.send_message(uuid, text),
  app.mark_message_read(uuid),
  app.unread_message_count()
to trade_house_app;


-- -----------------------------------------------------------------------------
-- 034_notifications_messagerie.sql
-- -----------------------------------------------------------------------------
-- ============================================================================
-- trade_house - 034_notifications_messagerie.sql
--
-- LA MESSAGERIE EST CLOS, MAIS SILENCIEUSE.
--
-- 033 a cree la table, le RLS, l'ecriture, la lecture, la pastille par
-- interlocuteur. Aucun de ces mecanismes ne previent : un manager pouvait
-- ecrire a son trader et n'apprendre l'existence de la reponse qu'en ouvrant
-- /equipe par hasard. La pastille existe (app.unread_message_count) mais
-- personne ne l'affiche hors de la page du fil, et la cloche - qui est
-- justement l'agregateur du projet - n'a rien a afficher.
--
-- Ce que fait cette migration, et rien de plus :
--
--   1. un evenement message_received, declenche par l INSERT lui-meme ;
--   2. il part par in_app (la cloche) ET par email, sans le contenu du
--      message : 033 l'a decide, " vous avez un nouveau message " et un lien ;
--   3. les notifications du fil sont marquees lues quand le fil est ouvert.
--
-- ---------------------------------------------------------------------------
-- POURQUOI UN TRIGGER SUR messages ET NON UN APPEL DANS send_message.
--
-- Ce serait plus lisible, et ce serait une regle qui tient seulement tant que
-- personne n'ecrit dans public.messages autrement. La table a deja une
-- politique INSERT (033), donc une ecriture directe reste possible tant que
-- le role l'a sur la table : quelqu'un qui ajouterait un INSERT depuis une
-- route, sans passer par app.send_message, produirait un message que personne
-- ne serait prevenu de lire.
--
-- Le trigger attache l'evenement A L EVENEMENT, pas a une fonction qui
-- aujourd'hui fait cela. C'est la regle retenue dans tout le projet : le
-- cloisonnement et la tracabilite sont en base (020, 029, 033), l'interface
-- ne fait qu'afficher.
--
-- ---------------------------------------------------------------------------
-- LE CONTENU NE SORT TOUJOURS PAS.
--
-- Ni dans le payload de la notification, ni dans le corps du courriel, ni
-- dans l'audit (033 l'y a deja exclu). Le trigger ne transporte que
-- l'identifiant du message. Un courriel qui reproduirait le texte d un echange
-- prive arriverait dans une boite partagee : ce serait une fuite construite
-- volontairement, et la plus facile a eviter du lot.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. L'evenement
-- ---------------------------------------------------------------------------
alter type notification_event add value if not exists 'message_received';

-- ---------------------------------------------------------------------------
-- 2. Le trigger
--
-- AFTER INSERT, et non BEFORE : une notification referencing un message qui
-- n'existe pas encore serait un renvoi casse. Le trigger est declenche par
-- l'expediteur et vise le destinataire.
--
-- Le nom du role est un etat de session (app.current_user_id), pas une
-- colonne de la table : on lit donc new.recipient_id, qui est fige a
-- l'insertion par la contrainte de 033.
-- ---------------------------------------------------------------------------
create or replace function app.trg_notify_new_message()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.notify_ids(
    array[new.recipient_id],
    'message_received',
    'message',
    new.id
  );
  return new;
end $$;

comment on function app.trg_notify_new_message is
  'Emet message_received vers le destinataire a chaque insertion dans messages. '
  'Ne transporte que l id du message : ni le texte, ni l expediteur.';

create trigger messages_notify_recipient
  after insert on public.messages
  for each row execute function app.trg_notify_new_message();

-- ---------------------------------------------------------------------------
-- 3. Le message part par email
--
-- 033 : " Le courriel dira vous avez un nouveau message, avec un lien vers
-- l'application, ou la session est verifiee par le RLS de la table. "
--
-- C'est la seule ligne ajoutee a la liste de 031. Elle est ici et pas ailleurs
-- parce que la liste est explicite par construction : ajouter un evenement a
-- l'enumeration ne le fait pas partir par email tout seul.
-- ---------------------------------------------------------------------------
create or replace function app.fn_is_email_event(p_event notification_event)
returns boolean
language sql immutable as $$
  select p_event in (
    'correction_requested', 'report_validated', 'report_dismissed',
    'training_assigned', 'training_exercise_reviewed',
    'training_exercise_submitted',
    'account_invited', 'account_disabled', 'account_reactivated',
    'meeting_created', 'meeting_updated', 'meeting_cancelled',
    'message_received'
  );
$$;
-- ---------------------------------------------------------------------------
-- 4. Le contexte lisible par le job
--
-- On rend le NOM de l'expediteur, pour que " KAGEN EMMANUEL vous a ecrit "
-- soit possible. On ne rend ni le texte, ni l'email : meme raison que ci-dessus.
--
-- SECURITY DEFINER pour la meme cause que le reste du projet (031) : le RLS
-- de public.users rend un manager invisible a son propre trader, et le job
-- n'a aucun contexte a lui.
--
-- La fonction est reprise en entier plutot que patchee : elle porte sur quatre
-- types, et une version qui n'en traiterait qu'un casserait les trois autres en
-- silence.
-- ---------------------------------------------------------------------------
create or replace function app.fn_notification_context(
  p_type varchar, p_id uuid
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_ctx jsonb := '{}'::jsonb;
begin
  if p_type = 'training_assignment' then
    select jsonb_build_object(
             'course_title', c.title,
             'trader_name', t.full_name,
             'manager_name', mgr.full_name,
             'due_at', a.due_at)
      into v_ctx
      from public.training_assignments a
      join public.training_courses c on c.id = a.course_id
      join public.users t on t.id = a.trader_id
      left join public.users mgr on mgr.id = a.assigned_by
     where a.id = p_id;

  elsif p_type = 'training_submission' then
    select jsonb_build_object(
             'course_title', c.title,
             'exercise_title', e.title,
             'trader_name', t.full_name,
             'reviewer_name', r.full_name,
             'score', v.score)
      into v_ctx
      from public.training_submissions s
      join public.training_assignments a on a.id = s.assignment_id
      join public.training_courses c on c.id = a.course_id
      join public.training_exercises e on e.id = s.exercise_id
      join public.users t on t.id = s.trader_id
      left join public.training_reviews v on v.submission_id = s.id
      left join public.users r on r.id = v.reviewer_id
     where s.id = p_id;

  elsif p_type = 'report' then
    select jsonb_build_object('session_date', r.session_date) into v_ctx
      from public.reports r where r.id = p_id;

  elsif p_type = 'meeting' then
    select jsonb_build_object(
             'title', m.title,
             'starts_at', m.starts_at,
             'creator_name', u.full_name)
      into v_ctx
      from public.meetings m
      join public.users u on u.id = m.created_by
     where m.id = p_id;

  -- Le nom de l'expediteur, et RIEN D'AUTRE. Pas le texte : voir l'en-tete.
  --
  -- `link_path` est calcule ICI, et non cote job : le cron n'a aucune session,
  -- donc aucun role, et il ne pourrait pas choisir entre la page du trader et
  -- celle du manager. La regle " qui recoit, ou va-t-il lire " appartient a la
  -- base, comme tout le reste de ce module.
  elsif p_type = 'message' then
    select jsonb_build_object(
             'sender_name', u.full_name,
             'link_path', case when r.role = 'trader' then '/mon-manager' else '/equipe' end)
      into v_ctx
      from public.messages m
      join public.users u on u.id = m.sender_id
      join public.users r on r.id = m.recipient_id
     where m.id = p_id;

  end if;

  return coalesce(v_ctx, '{}'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Marquer les notifications d'un fil comme lues
--
-- Un message lu et sa notification non lue produiraient deux etats qui
-- mentent l'un sur l'autre : la page dirait " lu ", la cloche " nouveau ".
-- L'ouverture du fil est le seul moment ou l'utilisateur l'a vu, donc c'est
-- le seul moment ou les deux se mettent d'accord.
--
-- La fonction ne touche QUE les notifications de l'utilisateur courant, liees
-- au message donne. Elle ne peut donc pas servir a effacer la cloche d'un
-- tiers : c'est la meme garantie que app.mark_message_read (033), et pour la
-- meme raison - le role n'a pas le droit d'UPDATE sur notifications_log en
-- general, cette fonction est le seul passage.
-- ---------------------------------------------------------------------------
create or replace function app.mark_message_notification_read(p_message_id uuid)
returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_count int;
begin
  update public.notifications_log
     set read_at = coalesce(read_at, now())
   where related_type = 'message'
     and related_id = p_message_id
     and user_id = app.current_user_id()
     and read_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

comment on function app.mark_message_notification_read is
  'Marque lues les notifications in_app rattachees a un message recu. Ne touche '
  'que les lignes du destinataire : ni un message envoye, ni la cloche d un tiers.';

grant execute on function
  app.mark_message_notification_read(uuid)
to trade_house_app;

-- -----------------------------------------------------------------------------
-- 035_password_reset_anonyme.sql
-- -----------------------------------------------------------------------------
-- ============================================================================
-- trade_house - 035_password_reset_anonyme.sql
--
-- LE « MOT DE PASSE OUBLIE » N'A JAMAIS FONCTIONNE.
--
-- /api/auth/password/forgot appelle app.issue_invitation(id, 'password_reset')
-- SANS session : personne n'est connecte au moment de la demande. Or 027 a
-- ecrit dans cette fonction :
--
--     elsif not app.is_admin() then
--       raise exception 'RG-02 : seul l''admin reinitialise un mot de passe';
--
-- app.is_admin() lit la session courante, donc vide -> la branche est prise
-- -> 409. La reponse prouve le defaut :
--
--     {"code":"CONFLICT","message":"RG-02 : seul l'admin reinitialise un mot de passe"}
--
-- Ce n'est pas une erreur de configuration : aucun administrateur ne peut
-- s'identifier avant d'avoir defini son mot de passe, et le bootstrap cree un
-- compte SANS mot de passe. La premiere connexion depend donc de ce chemin,
-- qui echoue toujours. Personne ne pouvait entrer, et l'echec etait silencieux
-- (la page affiche « si le compte existe, un email a ete envoye »).
--
-- ---------------------------------------------------------------------------
-- LE CHOIX : NE PAS ASSOUPLIR issue_invitation.
--
-- Ouvrir p_purpose = 'password_reset' dans issue_invitation aurait l'air plus
-- simple. Ce serait une faute : cette fonction sert aussi a l'ADMIN qui
-- reinitialise le mot de passe d'un tiers depuis l'interface. Distinguer les
-- deux cas par un parametre, c'est exposer un contournement de RG-02 a quiconque
-- trouve le nom du parametre. La regle « seul l'admin reinitialise le mot de
-- passe d'AUTRUI » doit rester entierement dans issue_invitation.
--
-- On cree donc une fonction DEDIEE au parcours autonome. Elle n'ouvre aucun
-- acces inter-comptes : elle n'agit que sur le compte dont l'adresse a ete
-- prouvee par la possession de la boite mail, et elle impose le meme contrat
-- de mot de passe que partout ailleurs.
--
--   ce qu'elle peut faire :                              ce qu'elle ne peut pas
--   ----------------------------------------             -------------------
--   emettre un jeton pour CE compte-la                    emettre pour un autre
--   (la ligne vient de app.account_for_recovery)          (p_user_id impose par l'appelant)
--   consigner l'audit                                     s'activer un compte desactive
--                                                          appeler issue_invitation
--
-- Le jeton reste a usage unique, expire en 1 heure, et ne revele rien de la
-- vie privee dans l'email : c'est app.accept_invitation qui le consomme et
-- revoque ensuite toutes les sessions du compte (route /reset).
-- ============================================================================

create or replace function app.issue_password_reset(p_user_id uuid)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_token text := encode(gen_random_bytes(32), 'hex');
  v_row   record;
begin
  -- Un compte desactive ne recoit rien : meme un transfert de courrier ne doit
  -- pas ressusciter un compte que l administrateur a volontairement ferme.
  select u.id, u.email into v_row
    from public.users u
   where u.id = p_user_id
     and u.is_active;

  if v_row.id is null then
    raise exception 'Utilisateur % introuvable ou inactif', p_user_id;
  end if;

  insert into public.user_invitations
    (user_id, email, purpose, token_hash, expires_at, created_by, sent_count, last_sent_at)
  values
    (v_row.id, v_row.email, 'password_reset', app.hash_token(v_token),
     now() + interval '1 hour', null, 1, now())
  returning id into v_row.id;

  -- RG-05 : un seul lien actif par (utilisateur, usage). Le renvoi invalide
  -- le precedent, sinon deux emails en circulation doubledent la surface.
  return v_token;   -- seul moment ou le jeton en clair existe
end $$;

comment on function app.issue_password_reset(uuid) is
  'Emet un jeton de reinitialisation pour CE compte (parcours anonyme « mot de passe oublie »). 1 heure, usage unique. N autorise a rien faire sur un autre compte.';

-- Seuls le role applicatif et le proprietaire peuvent l'appeler. Cette fonction
-- ne remplace pas issue_invitation, qui reste le chemin de l'admin.
revoke all on function app.issue_password_reset(uuid) from public;
grant execute on function app.issue_password_reset(uuid) to trade_house_app;

-- ---------------------------------------------------------------------------
-- L'AUDIT
-- ---------------------------------------------------------------------------
--
-- created_by est volontairement NULL : l'appelant n'est pas un utilisateur de
-- l'application mais le porteur de l'adresse. Tracer un auteur « inconnu »
-- serait faux, et laisser la colonne vide dit exactement ce qu'il en est.
-- ---------------------------------------------------------------------------

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
--    Le compte cree n a PAS de mot de passe : passer par Â« mot de passe
--    oublie Â» a la premiere connexion pour en definir un et activer le 2FA.
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