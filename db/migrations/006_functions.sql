-- ============================================================================
-- trade_house - 006_functions.sql
-- API metier en base : c'est ici que les regles du CDC sont appliquees une
-- seule fois. Ces fonctions sont SECURITY DEFINER et verifient donc
-- elles-memes les droits (le RLS reste actif pour le reste).
-- ============================================================================
\set ON_ERROR_STOP on

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




