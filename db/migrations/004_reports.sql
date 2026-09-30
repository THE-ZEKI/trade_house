-- ============================================================================
-- trade_house - 004_reports.sql
-- Rapports de session (D1..D7) - cycle de correction (E1..E7)
-- RG-30..37 - RG-40..49
-- ============================================================================
\set ON_ERROR_STOP on

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
