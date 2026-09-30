-- ============================================================================
-- trade_house - 003_meetings.sql
-- Reunions (B1, B2, B6, B8, B10) - liens (B3, RG-11..13) - participants (RG-10, 15)
-- rappels (B4, B5, RG-14..18) - salle et presence (C, RG-20..25)
-- ============================================================================
\set ON_ERROR_STOP on

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

create trigger meeting_reminders_guard_trg
  before insert or update on public.meeting_reminders
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

