-- ============================================================================
-- trade_house - 025_cascade_transition.sql
--
-- RG-03 et RG-40 sont en contradiction, et RG-03 l'emporte toujours.
--
--   RG-03 : desactiver un admin ou un manager renvoie ses rapports " En revision "
--           vers la file commune. C'est app.fn_users_cascade_reports, un
--           declencheur AFTER UPDATE sur public.users.
--
--   RG-40 : la matrice des transitions l'autorise, et refuse explicitement
--           in_review -> submitted au profits de validated -> in_review.
--
-- Le declencheur de cascade fait donc exactement ce que la matrice interdit :
-- l'operation echoue toujours. Consequence mesuree : un manager ayant au
-- moins un rapport en revue ne peut NI etre desactive NI etre anonymise. Le
-- message remontera " Transition in_review -> submitted interdite (RG-40) ", ce
-- qui ne dit rien du compte depose en cause.
--
-- Deux garde-fous bloquent, pas un : la matrice ET le RG-34 (seul le trader peut
-- soumettre). On leve les deux, mais UNIQUEMENT pendant la cascade.
--
-- Le levement passe par app.allow_transition, le meme drapeau que la
-- reouverture d'un rapport valide (migration 004). Il est pose en LOCAL, donc
-- valable dans la transaction seulement : une fois la cascade terminee, la
-- matrice redevient stricte pour tout le reste.
-- ============================================================================
\set ON_ERROR_STOP on

create or replace function app.fn_report_transition() returns trigger
language plpgsql as $$
declare
  v_actor   uuid := app.current_user_id();
  v_role    user_role := app.current_user_role();
  v_allowed boolean := false;
  -- RG-35 / RG-47 : rapport verrouille, seule une reouverture explicite
  -- et journalisee peut modifier la ligne.
  v_reopen  text := coalesce(current_setting('app.allow_transition', true), 'off');
begin
  if new.status = old.status then
    return new;
  end if;

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

  -- RG-03 : le retour en file commune depuis " En revision ", uniquement pour la
  -- cascade de desactivation. Sans cette exception, RG-03 est inoperant et
  -- aucun manager portant un rapport en revue ne peut etre desactive.
  if not v_allowed and v_reopen = 'on'
     and old.status = 'in_review' and new.status = 'submitted' then
    v_allowed := true;
  end if;

  if not v_allowed then
    raise exception 'Transition % -> % interdite (RG-40)', old.status, new.status;
  end if;

  -- RG-41 : relecture reservee a l'admin ou au manager du trader
  if new.status in ('in_review','correction_requested','validated','dismissed')
     and not app.can_manage_trader(old.trader_id) then
    raise exception 'RG-41 : seul l''admin ou le manager peut passer le rapport en %', new.status;
  end if;

  -- RG-34 : le trader soumet et resoumet. La cascade fait exception : elle
  -- n'est pas le trader qui soumet, c'est l'administrateur qui rend son
  -- expertise au depart.
  if new.status in ('submitted','resubmitted')
     and not (v_role = 'trader' and old.trader_id = v_actor)
     and not (v_reopen = 'on' and new.status = 'submitted') then
    raise exception 'Seul le trader proprietaire peut soumettre ou resoumettre';
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

-- ---------------------------------------------------------------------------
-- RG-03 : la cascade pose le drapeau, fait son travail, puis le retire.
--
-- Le retrait est indispensable : sans lui, le drapeau resterait a " on " pour le
-- reste de la transaction et autoriserait des transitions qui ne doivent pas
-- l'etre - par exemple un trader qui soumettrait le rapport d'un collegue dans
-- la meme transaction.
-- ---------------------------------------------------------------------------
create or replace function app.fn_users_cascade_reports() returns trigger
language plpgsql as $$
begin
  if old.is_active and new.is_active = false and new.role in ('admin','manager') then
    perform set_config('app.allow_transition', 'on', true);
    update public.reports r
       set status = 'submitted', reviewer_id = null, reviewed_at = null
     where r.reviewer_id = new.id and r.status = 'in_review';
    perform set_config('app.allow_transition', 'off', true);
  end if;
  return null;
end $$;