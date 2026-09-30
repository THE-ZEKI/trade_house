-- ============================================================================
-- trade_house - 007_views.sql
-- Vues de pilotage : indicateurs calcules (RG-47, RG-48, RG-20, RG-23) et
-- files de travail du tableau de bord (F1, F2, F3)
-- ============================================================================
\set ON_ERROR_STOP on

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
