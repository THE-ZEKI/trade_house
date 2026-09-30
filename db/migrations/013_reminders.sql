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
\set ON_ERROR_STOP on

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
