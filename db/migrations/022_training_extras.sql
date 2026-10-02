-- ---------------------------------------------------------------------------
-- Extensions du module formation
--
-- 1. Piece jointe d'exercice : un travail de trading se prouve par une capture
--    d'ecran ou un ordre. Exiger du texte oblige a raconter ce que la capture
--    montre deja. Le stockage est celui des pieces jointes de rapport (RG-33) :
--    prive, hors de public/, servi par une route qui verifie l'acces.
--
-- 2. Resoumission apres correction : la contrainte d'unicite
--    (assignment_id, exercise_id) imposait UNE reponse par exercice. Corriger
--    puis corriger a nouveau etait impossible : le trader ne pouvait pas
--    retravailler. On conserve l'historique et on marque la derniere version :
--    c'est ce qui permet de comparer avant/apres.
--
-- 3. Desattribution et archivage : une attribution erronee (mauvais trader,
--    mauvais cours) ne pouvait etre corrigee. On ne SUPPRIME pas : l'historique
--    pedagogique compte, et le rapport d'un trader rattache a ce cours doit
--    continuer d'exister.
-- ---------------------------------------------------------------------------

-- Un parcours " archive " n'est plus un travail en cours, mais son historique
-- subsiste. L'enum de la migration 021 ne prevoyait pas ce cas : le desattribuer
-- aurait efface la seule trace de ce que le trader avait suivi.
alter type training_assignment_status add value 'archived' after 'completed';

-- ---------------------------------------------------------------------------
-- 1. Pieces jointes d'exercice
-- ---------------------------------------------------------------------------
create table public.training_exercise_files (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.training_submissions(id) on delete cascade,
  storage_path  text not null unique,
  original_name varchar(255) not null,
  mime_type     varchar(100) not null,
  size_bytes    bigint not null check (size_bytes > 0),
  uploaded_by   uuid not null references public.users(id),
  created_at    timestamptz not null default now(),
  -- Meme liste fermee que les pieces jointes de rapport (RG-32). La version
  -- precedente de cette contrainte (`mime_type not in (...) or mime_type is
  -- not null`) etait une tautologie : toujours vraie, donc jamais declenchee.
  constraint training_files_mime check (
    mime_type in ('image/png','image/jpeg','image/webp','application/pdf')
  )
);
create index training_files_submission_idx on public.training_exercise_files (submission_id);

-- ---------------------------------------------------------------------------
-- 2. Versionnement des reponses
-- ---------------------------------------------------------------------------
alter table public.training_submissions
  drop constraint training_submissions_unique;

alter table public.training_submissions
  add column attempt int not null default 1;

-- Unicite sur la TENTATIVE, plus sur l'exercice : plusieurs lignes, une seule
-- courante (celle dont l'indice de version est le plus grand).
create unique index training_submissions_attempt_idx
  on public.training_submissions (assignment_id, exercise_id, attempt);

create index training_submissions_current_idx
  on public.training_submissions (assignment_id, exercise_id, attempt desc);

-- ---------------------------------------------------------------------------
-- 3. Fonctions
-- ---------------------------------------------------------------------------
-- Nouvelle tentative : on refuse si le travail n a pas encore ete corrige.
-- Sans ce controle, le trader pourrait spammer des versions et le manager
-- perdrait le fil de ce qui compte.
create or replace function app.resubmit_training_exercise(
  p_assignment_id uuid,
  p_exercise_id   uuid,
  p_answer        text default null,
  p_answer_key    text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_prev    uuid;
  v_attempt int;
  v_id      uuid;
begin
  select s.id, s.attempt into v_prev, v_attempt
    from public.training_submissions s
    join public.training_reviews r on r.submission_id = s.id
   where s.assignment_id = p_assignment_id and s.exercise_id = p_exercise_id;

  if v_prev is null then
    raise exception 'FORMATION-17 : ce travail n a pas encore ete corrige';
  end if;

  v_attempt := v_attempt + 1;

  insert into public.training_submissions
    (assignment_id, exercise_id, trader_id, answer, answer_key, attempt)
  values (p_assignment_id, p_exercise_id, app.current_user_id(), p_answer, p_answer_key, v_attempt)
  returning id into v_id;

  return v_id;
end $$;

-- Desattribution : retire le parcours du trader sans detruire son historique.
create or replace function app.unassign_training(p_assignment_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_trader uuid;
  v_by     uuid;
begin
  select trader_id, assigned_by into v_trader, v_by
    from public.training_assignments where id = p_assignment_id;

  if v_trader is null then
    raise exception 'FORMATION-18 : attribution introuvable';
  end if;
  if not (app.is_admin() or app.can_manage_trader(v_trader)) then
    raise exception 'FORMATION-19 : vous ne retirez pas ce parcours';
  end if;

  -- Le travail rendu reste rattache : il ne disparait pas de l'historique du
  -- trader, il cesse simplement d'etre un parcours en cours.
  update public.training_assignments
     set status = 'archived', completed_at = coalesce(completed_at, now())
   where id = p_assignment_id;

  perform app.fn_audit('training.unassigned', 'training_assignment', p_assignment_id,
                       jsonb_build_object('trader_id', v_trader, 'assigned_by', v_by));
end $$;

-- RLS des pieces jointes d'exercice : le trader voit les siennes, son manager
-- les voit, et personne d'autre.
alter table public.training_exercise_files enable row level security;
create policy training_files_select on public.training_exercise_files for select
  using (
    uploaded_by = app.current_user_id()
    or exists (
      select 1
        from public.training_submissions s
       where s.id = training_exercise_files.submission_id
         and (s.trader_id = app.current_user_id()
              or app.can_manage_trader(s.trader_id)
              or app.is_admin())
    )
  );
revoke insert, update, delete on public.training_exercise_files from trade_house_app;

grant select on public.training_exercise_files to trade_house_app;

grant execute on function
  app.resubmit_training_exercise(uuid, uuid, text, text),
  app.unassign_training(uuid)
to trade_house_app;

-- La colonne attempt doit exister avant qu'une application ne tente une
-- resoumission ; on le note dans le journal par un commentaire plutot que par une
-- migration separee, cette migration etant celle qui l'introduit.
comment on table public.training_submissions is
  'Une ligne par tentative. La version courante est celle dont `attempt` est la '
  'plus elevee pour un couple (attribution, exercice) ; les anciennes sont '
  'conservees pour que le manager puisse comparer avant/apres.';

comment on table public.training_exercise_files is
  'Captures jointes par le trader a un exercice. Meme stockage prive et meme '
  'liste de types que les pieces jointes de rapport (RG-32, RG-33).';