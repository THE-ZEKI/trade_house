-- ============================================================================
-- trade_house - 008_rls.sql
-- Securite au niveau des lignes (RG-04, RG-06, RG-61)
--
-- IMPORTANT : les tables ne sont PAS en FORCE ROW LEVEL SECURITY. Les fonctions
-- app.* marquees SECURITY DEFINER s'appuient sur ce comportement pour ne pas
-- se recurser sur les politiques de public.users. L'application doit se
-- connecter avec un role applicatif NON proprietaire (cf. README).
-- ============================================================================
\set ON_ERROR_STOP on

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

