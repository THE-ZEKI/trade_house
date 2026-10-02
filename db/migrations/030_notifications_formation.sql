-- ============================================================================
-- trade_house - 030_notifications_formation.sql
--
-- RAPPEL DE L'ETAT AVANT CE CHANTIER.
--
-- La mecanique est saine et ancienne : notifications_log, app.fn_notify, la
-- cloche, la page /notifications, les 3 relances de RG-16. Les evenements
-- SONT declares (29 dans l'enumeration) et presque tous ne sont declenches
-- par AUCUNE fonction. Sur les 29, quatre l'etaient : report_submitted,
-- report_resubmitted, correction_requested, no_trade_declared.
--
-- Les corrections demandees sont donc deja prevenues, ce qui est la demande
-- metier la plus urgente. Restait la Formation, le module le plus recent,
-- jamais branche.
--
-- NOTE SUR L'EXECUTION : ALTER TYPE ... ADD VALUE ne peut pas etre suivi d'un
-- usage de la valeur dans la meme transaction. Chaque ALTER est donc joue
-- comme un lot autonome par psql. Ne pas chercher a envelopper ce fichier
-- dans un BEGIN : c'est le comportement attendu, pas une erreur a corriger.
--
-- Chaque evenement dit QUI est alerte. C'est le point ou une messagerie se
-- passe d'ordinaire, et c'est laisse explicite plutot que deduit.
-- ============================================================================
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 1. Evenements
--
-- On etend l'enumeration plutot que d'en creer une : une deuxieme enum
-- obligerait les lectures a conjoindre les deux, et une migration ne peut pas
-- changer la premiere sans casser les clients existants.
-- ---------------------------------------------------------------------------

-- Formation : training_assigned part vers le TRADER ; les trois autres vers
-- le MANAGER, sauf training_exercise_reviewed qui part vers le TRADER corrige.
alter type notification_event add value if not exists 'training_assigned';
alter type notification_event add value if not exists 'training_exercise_submitted';
alter type notification_event add value if not exists 'training_exercise_reviewed';
alter type notification_event add value if not exists 'training_completed';

-- Comptes : l'ADMIN est le seul avertissable pour une desactivation, seul
-- role habilite. Un trader invite ne releve que de son manager.
alter type notification_event add value if not exists 'account_invited';
alter type notification_event add value if not exists 'account_disabled';
alter type notification_event add value if not exists 'account_reactivated';

-- ---------------------------------------------------------------------------
-- 2. Destinataires
--
-- app.fn_notify prend un tableau d'identifiants : la question n'est donc pas
-- " cet evenement existe-t-il " mais " QUI doit etre prevenu ". Ces deux
-- helpers rendent la reponse explicite, pour que le code appelant dise
-- pourquoi il notifie telle personne plutot que de deviner le destinataire.
-- ---------------------------------------------------------------------------

-- Le manager d'un trader. Vide si le trader n'est rattache a personne : mieux
-- vaut ne notifier personne qu'un administrateur qui n'a rien demande.
create or replace function app.manager_of(p_trader uuid)
returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select u.manager_id from public.users u where u.id = p_trader and u.role = 'trader';
$$;

-- Les participants d'une reunion, lus en SECURITY DEFINER : le createur n'est
-- pas toujours visible du RLS, et un destinataire fantome ne doit pas
-- disparaitre silencieusement.
create or replace function app.fn_meeting_participant_ids(p_meeting uuid)
returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(mp.user_id), '{}'::uuid[])
    from public.meeting_participants mp where mp.meeting_id = p_meeting;
$$;

-- fn_notify, filtree sur ce qui existe reellement. Une liste vide ne cree
-- aucune ligne : la fonction de base refuse deja les identifiants nuls, mais un
-- uuid fantome passerait et produirait une notification orpheline.
--
-- Le filtre est applique par array_remove plutot que par `where unnest(...)` :
-- unnest est une fonction d'ensemble, et PostgreSQL l'interdit dans un WHERE
-- ("les fonctions renvoyant un ensemble ne sont pas autorisees dans WHERE").
create or replace function app.notify_ids(
  p_ids uuid[], p_event notification_event,
  p_type varchar, p_id uuid
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_clean uuid[];
begin
  select coalesce(array_agg(u), '{}'::uuid[])
    into v_clean
    from unnest(coalesce(p_ids, '{}'::uuid[])) u
   where u is not null;

  perform app.fn_notify(v_clean, p_event, p_type, p_id, 'in_app');
end $$;

comment on function app.manager_of is
  'Manager de tutelle d un trader, ou NULL. Security definer parce que le '
  'RLS de public.users rend un manager invisible a ses propres traders.';

-- ---------------------------------------------------------------------------
-- 3. Formation
--
-- On redefinit les quatre fonctions plutot que de les modifier sur place :
-- une migration ne peut pas patcher le corps d'une fonction deja deployee, et
-- CREATE OR REPLACE exige le corps entier. Chaque version ci-dessous est donc
-- la fonction d'origine PLUS les notifications ; ce sont les SEULES
-- differences, tout le reste est repris a l'identique.
-- ---------------------------------------------------------------------------

-- 3.1 Attribution : le TRADER est prevenu qu'un cours entre dans son parcours.
-- Le manager qui vient d'attribuer n'a pas besoin qu'on le previenne de son
-- propre geste.
create or replace function app.assign_training(
  p_course_id uuid,
  p_trader_id uuid,
  p_due_at     timestamptz default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  if not app.fn_can_assign_to(p_trader_id) then
    raise exception 'FORMATION-03 : vous n attribuez pas a ce trader';
  end if;
  if not exists (
    select 1 from public.training_courses c
     where c.id = p_course_id and c.status = 'published'
  ) then
    raise exception 'FORMATION-04 : le cours n est pas publie';
  end if;

  insert into public.training_assignments (course_id, trader_id, assigned_by, due_at)
  values (p_course_id, p_trader_id, app.current_user_id(), p_due_at)
  on conflict (course_id, trader_id) do update set due_at = excluded.due_at
  returning id into v_id;

  perform app.fn_audit('training.assigned', 'training_assignment', v_id,
                       jsonb_build_object('course_id', p_course_id, 'trader_id', p_trader_id));

  perform app.notify_ids(array[p_trader_id], 'training_assigned', 'training_assignment', v_id);

  return v_id;
end $$;
-- ---------------------------------------------------------------------------
-- 3. Formation
--
-- On redefinit les quatre fonctions plutot que de les modifier sur place :
-- une migration ne peut pas patcher le corps d'une fonction deja deployee, et
-- CREATE OR REPLACE exige le corps entier. Chaque version ci-dessous est donc
-- la fonction d'origine PLUS les notifications ; ce sont les SEULES
-- differences, tout le reste est repris a l'identique.
-- ---------------------------------------------------------------------------

-- 3.1 Attribution : le TRADER est prevenu qu'un cours entre dans son parcours.
-- Le manager qui vient d'attribuer n'a pas besoin qu'on le previenne de son
-- propre geste.
create or replace function app.assign_training(
  p_course_id uuid,
  p_trader_id uuid,
  p_due_at     timestamptz default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  if not app.fn_can_assign_to(p_trader_id) then
    raise exception 'FORMATION-03 : vous n attribuez pas a ce trader';
  end if;
  if not exists (
    select 1 from public.training_courses c
     where c.id = p_course_id and c.status = 'published'
  ) then
    raise exception 'FORMATION-04 : le cours n est pas publie';
  end if;

  insert into public.training_assignments (course_id, trader_id, assigned_by, due_at)
  values (p_course_id, p_trader_id, app.current_user_id(), p_due_at)
  on conflict (course_id, trader_id) do update set due_at = excluded.due_at
  returning id into v_id;

  perform app.fn_audit('training.assigned', 'training_assignment', v_id,
                       jsonb_build_object('course_id', p_course_id, 'trader_id', p_trader_id));

  perform app.notify_ids(array[p_trader_id], 'training_assigned', 'training_assignment', v_id);

  return v_id;
end $$;

-- 3.2 Exercice rendu : le MANAGER du trader est prevenu, PAS l'admin. La
-- correction d'une formation est du ressort du manager qui a attribue le cours.
create or replace function app.submit_training_exercise(
  p_assignment_id uuid,
  p_exercise_id   uuid,
  p_answer        text default null,
  p_answer_key    text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_trader uuid; v_course uuid; v_kind training_exercise_kind; v_id uuid;
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

  -- La cible du ON CONFLICT compte TROIS colonnes, pas deux : la migration 022
  -- a remplace la contrainte unique (assignment_id, exercise_id) par un index
  -- incluant `attempt`, pour permettre plusieurs tentatives (migration 023).
  -- Reprendre l'ancienne cible a deux colonnes ferait echouer le premier rendu
  -- d'un exercice en erreur interne, et le parcours serait bloque.
  insert into public.training_submissions
    (assignment_id, exercise_id, trader_id, answer, answer_key, attempt)
  values (p_assignment_id, p_exercise_id, v_trader, p_answer, p_answer_key, 1)
    on conflict (assignment_id, exercise_id, attempt) do update
      set answer = excluded.answer,
          answer_key = excluded.answer_key,
          updated_at = now()
    returning id into v_id;

  -- L'attribution passe " en cours " des la premiere reponse : c'est ce qui
  -- permet au manager de voir qui a commence.
  update public.training_assignments
     set status = 'in_progress', completed_at = null
   where id = p_assignment_id and status = 'assigned';

  perform app.notify_ids(array[app.manager_of(v_trader)],
                         'training_exercise_submitted', 'training_submission', v_id);

  return v_id;
end $$;

-- 3.3 Exercice corrige : le TRADER est prevenu. Sans cette notification, un
-- trader qui rend un exercice n'a aucun moyen de savoir que son manager l'a lu.
create or replace function app.review_training(
  p_submission_id uuid,
  p_score         numeric default null,
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

  perform app.notify_ids(array[v_trader],
                         'training_exercise_reviewed', 'training_submission', p_submission_id);
end $$;

-- 3.4 Parcours termine : le MANAGER est prevenu. Une formation terminee est un
-- evenement rare et signifiant : le trader a suivi le parcours jusqu'au bout.
create or replace function app.complete_training(p_assignment_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_total int; v_done int; v_trader uuid;
begin
  select (select count(*) from public.training_exercises e
            join public.training_assignments a on a.course_id = e.course_id
           where a.id = p_assignment_id),
         (select count(*) from public.training_submissions s
           where s.assignment_id = p_assignment_id),
         (select trader_id from public.training_assignments where id = p_assignment_id)
    into v_total, v_done, v_trader;

  if v_total = 0 then
    raise exception 'FORMATION-15 : ce cours ne contient aucun exercice';
  end if;
  if v_done < v_total then
    raise exception 'FORMATION-16 : il reste des exercices a rendre';
  end if;

  update public.training_assignments
     set status = 'completed', completed_at = now()
   where id = p_assignment_id;

  perform app.notify_ids(array[app.manager_of(v_trader)],
                         'training_completed', 'training_assignment', p_assignment_id);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Reunions
--
-- Les trois evenements existaient deja ; seule la ligne de notification
-- manquait. Les participants sont lus par une fonction SECURITY DEFINER pour
-- que le createur, non visible du RLS, soit tout de meme notifie.
-- ---------------------------------------------------------------------------
create or replace function app.notify_meeting_created(p_meeting uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.notify_ids(app.fn_meeting_participant_ids(p_meeting),
                         'meeting_created', 'meeting', p_meeting);
end $$;

grant execute on function
  app.manager_of(uuid),
  app.notify_ids(uuid[], notification_event, varchar, uuid),
  app.fn_meeting_participant_ids(uuid),
  app.notify_meeting_created(uuid)
to trade_house_app;
