-- ============================================================================
-- trade_house - 023_training_submission_conflict.sql
--
-- La migration 022 a remplace la contrainte UNIQUE (assignment_id, exercise_id)
-- de training_submissions par un index sur (assignment_id, exercise_id, attempt),
-- afin de permettre plusieurs tentatives.
--
-- Consequence non vue au moment de 022 : `app.submit_training_exercise` - creee
-- en 021 - portait encore
--         on conflict (assignment_id, exercise_id) do update
-- et PostgreSQL refuse cette clause des lors qu'aucune contrainte unique ni
-- index unique ne correspond exactement a la cible. Le premier rendu d'un
-- exercice echouait donc en erreur interne, et le parcours de formation etait
-- bloque de bout en bout.
--
-- On redefinit la fonction avec la cible a trois colonnes. Le comportement reste
-- celui voulu : rendre deux fois le meme exercice met a jour la tentative
-- courante ; retravailler apres correction passe par
-- app.resubmit_training_exercise, qui cree une tentative d indice superieur.
-- ============================================================================
\set ON_ERROR_STOP on

create or replace function app.submit_training_exercise(
  p_assignment_id uuid,
  p_exercise_id   uuid,
  p_answer        text default null,
  p_answer_key    text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_trader uuid;
  v_course uuid;
  v_kind   training_exercise_kind;
  v_id     uuid;
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
    (assignment_id, exercise_id, trader_id, answer, answer_key, attempt)
  values (p_assignment_id, p_exercise_id, v_trader, p_answer, p_answer_key, 1)
    on conflict (assignment_id, exercise_id, attempt) do update
      set answer = excluded.answer,
          answer_key = excluded.answer_key,
          updated_at = now()
    returning id into v_id;

  update public.training_assignments
     set status = 'in_progress', completed_at = null
   where id = p_assignment_id and status = 'assigned';

  return v_id;
end $$;

grant execute on function
  app.submit_training_exercise(uuid, uuid, text, text)
to trade_house_app;