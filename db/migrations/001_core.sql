-- ============================================================================
-- trade_house - 001_core.sql
-- Extensions - schema applicatif - enumerations - helpers
-- PostgreSQL 14+ (developpe et valide sur PostgreSQL 18)
-- ============================================================================
\set ON_ERROR_STOP on

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

