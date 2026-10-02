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
\set ON_ERROR_STOP on

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
