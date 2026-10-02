-- ============================================================================
-- trade_house - 021_training.sql
-- Module G : la formation
--
-- Un manager ecrit des COURS, y attache des EXERCICES, puis attribue le cours a
-- un ou plusieurs de ses traders. Chaque trader travaille a son rythme et rend
-- ses exercices ; le manager les CORRIGE.
--
-- Trois choix de modele meritent d'etre explicites, car ils ne vont pas de soi.
--
-- 1. Un cours est un MODELE, pas un parcours individuel. Ecrire dix fois le
--    meme cours pour dix traders serait absurde. Le cours porte donc son
--    auteur et son contenu, et l'attribution porte la progression. Un trader
--    qui recoit deux fois le meme cours a deux enregistrements distincts : sa
--    re-soumission ne doit pas ecraser l'historique de la premiere.
--
-- 2. L'affectation n'est PAS figee au moment de l'attribution : si le manager
--    modifie le cours apres coup, le trader deja attribue voit la version en
--    cours. On privilegie la simplicite ; une archive complete du contenu est
--    un second module, pas une precaution de premier rang.
--
-- 3. La correction est LIBRE, non automatique. Un exercice de trading (" avez-
--    vous respecte votre plan ? ") ne se corrige pas par une cle QCM : la
--    reponse est une analyse, et seul le manager qui a donne le cours peut la
--    faire. Le mode QCM est conserve pour les exercices FACTUELS (definitions,
--    regles de risque), notes automatiquement - la note automatique est un
--    CONTROLE, pas une note finale.
-- ============================================================================
\set ON_ERROR_STOP on

create type training_course_status as enum ('draft', 'published', 'archived');
create type training_assignment_status as enum ('assigned', 'in_progress', 'submitted', 'completed');
create type training_exercise_kind as enum ('written', 'qcm');

-- ---------------------------------------------------------------------------
-- Cours
-- ---------------------------------------------------------------------------
create table public.training_courses (
  id         uuid primary key default gen_random_uuid(),
  title      varchar(200) not null check (length(btrim(title)) > 0),
  summary    text,
  content    text not null default '',
  author_id  uuid not null references public.users(id),
  status     training_course_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index training_courses_author_idx on public.training_courses (author_id, status);

create trigger training_courses_touch_trg before update on public.training_courses
  for each row execute function app.fn_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Exercices rattaches a un cours
-- ---------------------------------------------------------------------------
create table public.training_exercises (
  id             uuid primary key default gen_random_uuid(),
  course_id      uuid not null references public.training_courses(id) on delete cascade,
  position       int not null default 1,
  title          varchar(200) not null check (length(btrim(title)) > 0),
  prompt         text not null,
  kind           training_exercise_kind not null default 'written',
  -- QCM : { "a": "texte", "b": "texte" } et correct_answer = "b"
  options        jsonb,
  correct_answer text,
  explanation    text,      -- POURQUOI la reponse est juste : c'est la correction
  created_at     timestamptz not null default now(),
  constraint training_exercises_options_object check (
    options is null or jsonb_typeof(options) = 'object'
  ),
  -- Un QCM sans options ni cle de reponse ne serait pas corrigeable.
  constraint training_exercises_qcm_usable check (
    kind <> 'qcm' or (options is not null and correct_answer is not null)
  )
);
create index training_exercises_course_idx on public.training_exercises (course_id, position);

-- ---------------------------------------------------------------------------
-- Attribution d'un cours a un trader
-- ---------------------------------------------------------------------------
create table public.training_assignments (
  id           uuid primary key default gen_random_uuid(),
  course_id    uuid not null references public.training_courses(id) on delete cascade,
  trader_id    uuid not null references public.users(id),
  assigned_by  uuid not null references public.users(id),
  assigned_at  timestamptz not null default now(),
  due_at       timestamptz,
  status       training_assignment_status not null default 'assigned',
  completed_at timestamptz,
  constraint training_assignments_unique unique (course_id, trader_id),
  constraint training_assignments_not_self check (trader_id <> assigned_by)
);
create index training_assignments_trader_idx on public.training_assignments (trader_id, status);
create index training_assignments_course_idx on public.training_assignments (course_id);

-- ---------------------------------------------------------------------------
-- Reponses et correction
-- ---------------------------------------------------------------------------
create table public.training_submissions (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.training_assignments(id) on delete cascade,
  exercise_id   uuid not null references public.training_exercises(id) on delete cascade,
  trader_id     uuid not null references public.users(id),
  answer        text,
  answer_key    text,
  submitted_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Une seule soumission par exercice et par attribution : une re-soumission
  -- ecraserait la precedente et perdrait sa correction.
  constraint training_submissions_unique unique (assignment_id, exercise_id)
);
create index training_submissions_assignment_idx on public.training_submissions (assignment_id);

create table public.training_reviews (
  submission_id uuid primary key references public.training_submissions(id) on delete cascade,
  reviewer_id   uuid not null references public.users(id),
  score         numeric(5,2) check (score is null or (score >= 0 and score <= 20)),
  comment       text not null check (length(btrim(comment)) > 0),
  reviewed_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Fonctions metier : la regle vit ici, pas dans l'interface
-- ---------------------------------------------------------------------------
-- Un cours est modifiable par son auteur, ou par un admin.
create or replace function app.fn_can_write_course(p_course_id uuid)
returns boolean language sql stable as $$
  select app.is_admin()
      or exists (
        select 1 from public.training_courses c
         where c.id = p_course_id and c.author_id = app.current_user_id()
      )
$$;

-- Le manager n attribue qu a SES traders. Sans cette regle, il pourrait envoyer
-- un cours a toute la maison en devinant un identifiant.
create or replace function app.fn_can_assign_to(p_trader_id uuid)
returns boolean language sql stable as $$
  select app.is_admin() or app.can_manage_trader(p_trader_id)
$$;

create or replace function app.create_training_course(
  p_title   varchar,
  p_summary text default null,
  p_content text default '',
  p_status  training_course_status default 'draft'
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if app.current_user_role() = 'trader' then
    raise exception 'FORMATION-01 : seul un manager peut creer un cours';
  end if;
  if length(btrim(p_title)) = 0 then
    raise exception 'FORMATION-01b : le titre est obligatoire';
  end if;

  insert into public.training_courses (title, summary, content, author_id, status)
  values (p_title, p_summary, p_content, app.current_user_id(), p_status)
  returning id into v_id;

  perform app.fn_audit('training.course_created', 'training_course', v_id,
                       jsonb_build_object('status', p_status));
  return v_id;
end $$;

create or replace function app.update_training_course(
  p_course_id uuid,
  p_title     varchar,
  p_summary   text default null,
  p_content   text default '',
  p_status    training_course_status default 'draft'
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.fn_can_write_course(p_course_id) then
    raise exception 'FORMATION-02 : vous n etes pas l auteur de ce cours';
  end if;

  update public.training_courses
     set title = p_title, summary = p_summary, content = p_content,
         status = p_status, updated_at = now()
   where id = p_course_id;

  perform app.fn_audit('training.course_updated', 'training_course', p_course_id,
                       jsonb_build_object('status', p_status));
end $$;

create or replace function app.add_training_exercise(
  p_course_id      uuid,
  p_title          varchar,
  p_prompt         text,
  p_kind           training_exercise_kind default 'written',
  p_options        jsonb default null,
  p_correct_answer text default null,
  p_explanation    text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_max int;
begin
  if not app.fn_can_write_course(p_course_id) then
    raise exception 'FORMATION-02 : vous n etes pas l auteur de ce cours';
  end if;
  if length(btrim(p_prompt)) = 0 then
    raise exception 'FORMATION-03 : l enonce de l exercice est obligatoire';
  end if;
  -- La cle de reponse doit exister parmi les propositions : sinon la
  -- correction automatique ne pourrait jamais etre juste.
  if p_kind = 'qcm' and (p_options is null or p_correct_answer is null) then
    raise exception 'FORMATION-03b : un QCM exige des propositions et une reponse';
  end if;
  if p_kind = 'qcm' and p_options is not null
     and not (p_options ? p_correct_answer) then
    raise exception 'FORMATION-03c : la reponse proposee ne figure pas dans les propositions';
  end if;

  -- Position implicite : la suite du dernier exercice du cours.
  select coalesce(max(position), 0) + 1 into v_max
    from public.training_exercises where course_id = p_course_id;

  insert into public.training_exercises
    (course_id, position, title, prompt, kind, options, correct_answer, explanation)
  values (p_course_id, v_max, p_title, p_prompt, p_kind, p_options,
          p_correct_answer, p_explanation)
  returning id into v_id;

  return v_id;
end $$;

create or replace function app.assign_training(
  p_course_id uuid,
  p_trader_id uuid,
  p_due_at    timestamptz default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_status training_course_status;
begin
  if not app.fn_can_assign_to(p_trader_id) then
    raise exception 'FORMATION-04 : ce trader ne fait pas partie de votre equipe';
  end if;
  if p_trader_id = app.current_user_id() then
    raise exception 'FORMATION-04b : vous ne pouvez pas vous attribuer un cours';
  end if;

  select status into v_status from public.training_courses where id = p_course_id;
  if v_status is null then
    raise exception 'FORMATION-05 : cours introuvable';
  end if;
  -- Un brouillon n est pas distribuable : le trader ne doit pas decouvrir un
  -- cours encore en relecture.
  if v_status = 'draft' then
    raise exception 'FORMATION-06 : le cours doit etre publie avant d etre attribue';
  end if;

  insert into public.training_assignments (course_id, trader_id, assigned_by, due_at)
  values (p_course_id, p_trader_id, app.current_user_id(), p_due_at)
  on conflict (course_id, trader_id) do update set due_at = excluded.due_at
  returning id into v_id;

  perform app.fn_audit('training.assigned', 'training_assignment', v_id,
                       jsonb_build_object('course_id', p_course_id, 'trader_id', p_trader_id));
  return v_id;
end $$;

create or replace function app.submit_training_exercise(
  p_assignment_id uuid,
  p_exercise_id   uuid,
  p_answer        text default null,
  p_answer_key    text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_trader uuid; v_course uuid; v_kind training_exercise_kind; v_id uuid;
begin
  select a.trader_id, a.course_id into v_trader, v_course
    from public.training_assignments a where a.id = p_assignment_id;

  if v_trader is null then
    raise exception 'FORMATION-07 : attribution introuvable';
  end if;
  if v_trader <> app.current_user_id() then
    raise exception 'FORMATION-08 : cette attribution ne vous appartient pas';
  end if;

  -- L'exercice doit appartenir au cours attribue : sans ce controle, un trader
  -- pourrait rendre l'exercice d'un cours qu'il ne suit pas.
  select kind into v_kind from public.training_exercises
   where id = p_exercise_id and course_id = v_course;
  if v_kind is null then
    raise exception 'FORMATION-09 : cet exercice n apartient pas au cours attribue';
  end if;

  if v_kind = 'written' and (p_answer is null or length(btrim(p_answer)) = 0) then
    raise exception 'FORMATION-10 : la reponse est obligatoire';
  end if;

  insert into public.training_submissions
    (assignment_id, exercise_id, trader_id, answer, answer_key)
  values (p_assignment_id, p_exercise_id, v_trader, p_answer, p_answer_key)
  on conflict (assignment_id, exercise_id) do update
    set answer = excluded.answer, answer_key = excluded.answer_key, updated_at = now()
  returning id into v_id;

  -- L'attribution passe " en cours " des la premiere reponse : c'est ce qui
  -- permet au manager de voir qui a commence.
  update public.training_assignments
     set status = 'in_progress', completed_at = null
   where id = p_assignment_id and status = 'assigned';

  return v_id;
end $$;

create or replace function app.review_training(
  p_submission_id uuid,
  p_score         numeric default null,
  -- avoir une aussi, sinon PostgreSQL refuse de creer la fonction. Le controle
  -- " non vide " est fait dans le corps, pas par une valeur par defaut.
  p_comment       text default ''
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_trader uuid;
begin
  -- Le commentaire est obligatoire : une note seule ne dit pas quoi corriger.
  if length(btrim(p_comment)) = 0 then
    raise exception 'FORMATION-11 : un commentaire de correction est obligatoire';
  end if;
  if p_score is not null and (p_score < 0 or p_score > 20) then
    raise exception 'FORMATION-12 : la note doit etre comprise entre 0 et 20';
  end if;

  select s.trader_id into v_trader
    from public.training_submissions s where s.id = p_submission_id;

  if v_trader is null then
    raise exception 'FORMATION-13 : soumission introuvable';
  end if;
  if not (app.is_admin() or app.can_manage_trader(v_trader)) then
    raise exception 'FORMATION-14 : vous ne corrigez pas ce travail';
  end if;

  insert into public.training_reviews (submission_id, reviewer_id, score, comment)
  values (p_submission_id, app.current_user_id(), p_score, p_comment)
  on conflict (submission_id) do update
    set reviewer_id = excluded.reviewer_id, score = excluded.score,
        comment = excluded.comment, reviewed_at = now();

  perform app.fn_audit('training.reviewed', 'training_submission', p_submission_id,
                       jsonb_build_object('score', p_score));
end $$;

create or replace function app.complete_training(p_assignment_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_total int; v_done int;
begin
  select (select count(*) from public.training_exercises e
            join public.training_assignments a on a.course_id = e.course_id
           where a.id = p_assignment_id),
         (select count(*) from public.training_submissions s
           where s.assignment_id = p_assignment_id)
    into v_total, v_done;

  if v_total = 0 then
    raise exception 'FORMATION-15 : ce cours ne contient aucun exercice';
  end if;
  if v_done < v_total then
    raise exception 'FORMATION-16 : il reste des exercices a rendre';
  end if;

  update public.training_assignments
     set status = 'completed', completed_at = now()
   where id = p_assignment_id;
end $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- Meme approche que la migration 016 : les politiques disent QUI, et les
-- droits de colonne interdisent l'ecriture directe. La regle metier reste dans
-- les fonctions app.*, qui s'executent avec les droits du proprietaire.
alter table public.training_courses enable row level security;
create policy courses_select on public.training_courses for select
  using (
    author_id = app.current_user_id()
    or app.is_admin()
    or exists (
      select 1 from public.training_assignments a
       where a.course_id = training_courses.id
         and a.trader_id = app.current_user_id()
    )
  );
revoke insert, update, delete on public.training_courses from trade_house_app;

alter table public.training_exercises enable row level security;
create policy exercises_select on public.training_exercises for select
  using (
    exists (
      select 1 from public.training_assignments a
       where a.course_id = training_exercises.course_id
         and (a.trader_id = app.current_user_id()
              or app.can_manage_trader(a.trader_id)
              or app.is_admin())
    )
    or exists (
      select 1 from public.training_courses c
       where c.id = training_exercises.course_id
         and (c.author_id = app.current_user_id() or app.is_admin())
    )
  );
revoke insert, update, delete on public.training_exercises from trade_house_app;

alter table public.training_assignments enable row level security;
create policy assignments_select on public.training_assignments for select
  using (
    trader_id = app.current_user_id()
    or app.can_manage_trader(trader_id)
    or app.is_admin()
  );
revoke insert, update, delete on public.training_assignments from trade_house_app;

alter table public.training_submissions enable row level security;
create policy submissions_select on public.training_submissions for select
  using (
    trader_id = app.current_user_id()
    or app.can_manage_trader(trader_id)
    or app.is_admin()
  );
revoke insert, update, delete on public.training_submissions from trade_house_app;

alter table public.training_reviews enable row level security;
-- Le trader voit la correction de SON travail : c'est tout l interet du module.
create policy reviews_select on public.training_reviews for select
  using (
    exists (
      select 1 from public.training_submissions s
       where s.id = training_reviews.submission_id
         and (s.trader_id = app.current_user_id()
              or app.can_manage_trader(s.trader_id)
              or app.is_admin())
    )
  );
revoke insert, update, delete on public.training_reviews from trade_house_app;

-- ---------------------------------------------------------------------------
-- Acces du role applicatif
-- ---------------------------------------------------------------------------
grant select on public.training_courses,
                public.training_exercises,
                public.training_assignments,
                public.training_submissions,
                public.training_reviews to trade_house_app;

grant execute on function
  app.create_training_course(varchar, text, text, training_course_status),
  app.update_training_course(uuid, varchar, text, text, training_course_status),
  app.add_training_exercise(uuid, varchar, text, training_exercise_kind, jsonb, text, text),
  app.assign_training(uuid, uuid, timestamptz),
  app.submit_training_exercise(uuid, uuid, text, text),
  app.review_training(uuid, numeric, text),
  app.complete_training(uuid)
to trade_house_app;

comment on table public.training_courses is
  'Cours ecrit par un manager, attribue a ses traders. Ecriture reservee aux '
  'fonctions app.* ; le role applicatif n a que la lecture.';
comment on table public.training_reviews is
  'Correction du manager. Le commentaire est obligatoire : une note seule ne '
  'laisse pas le trader comprendre quoi improves.';