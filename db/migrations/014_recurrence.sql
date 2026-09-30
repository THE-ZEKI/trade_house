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
\set ON_ERROR_STOP on

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
