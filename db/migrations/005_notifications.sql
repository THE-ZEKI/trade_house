-- ============================================================================
-- trade_house - 005_notifications.sql
-- DECISION D5 : meeting_reminders porte l'EVENEMENT d'envoi (par reunion),
-- notifications_log porte le suivi PAR DESTINATAIRE (B9, RG-16, RG-52).
-- ============================================================================
\set ON_ERROR_STOP on

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
