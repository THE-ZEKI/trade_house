-- ============================================================================
-- trade_house - 034_notifications_messagerie.sql
--
-- LA MESSAGERIE EST CLOS, MAIS SILENCIEUSE.
--
-- 033 a cree la table, le RLS, l'ecriture, la lecture, la pastille par
-- interlocuteur. Aucun de ces mecanismes ne previent : un manager pouvait
-- ecrire a son trader et n'apprendre l'existence de la reponse qu'en ouvrant
-- /equipe par hasard. La pastille existe (app.unread_message_count) mais
-- personne ne l'affiche hors de la page du fil, et la cloche - qui est
-- justement l'agregateur du projet - n'a rien a afficher.
--
-- Ce que fait cette migration, et rien de plus :
--
--   1. un evenement message_received, declenche par l INSERT lui-meme ;
--   2. il part par in_app (la cloche) ET par email, sans le contenu du
--      message : 033 l'a decide, " vous avez un nouveau message " et un lien ;
--   3. les notifications du fil sont marquees lues quand le fil est ouvert.
--
-- ---------------------------------------------------------------------------
-- POURQUOI UN TRIGGER SUR messages ET NON UN APPEL DANS send_message.
--
-- Ce serait plus lisible, et ce serait une regle qui tient seulement tant que
-- personne n'ecrit dans public.messages autrement. La table a deja une
-- politique INSERT (033), donc une ecriture directe reste possible tant que
-- le role l'a sur la table : quelqu'un qui ajouterait un INSERT depuis une
-- route, sans passer par app.send_message, produirait un message que personne
-- ne serait prevenu de lire.
--
-- Le trigger attache l'evenement A L EVENEMENT, pas a une fonction qui
-- aujourd'hui fait cela. C'est la regle retenue dans tout le projet : le
-- cloisonnement et la tracabilite sont en base (020, 029, 033), l'interface
-- ne fait qu'afficher.
--
-- ---------------------------------------------------------------------------
-- LE CONTENU NE SORT TOUJOURS PAS.
--
-- Ni dans le payload de la notification, ni dans le corps du courriel, ni
-- dans l'audit (033 l'y a deja exclu). Le trigger ne transporte que
-- l'identifiant du message. Un courriel qui reproduirait le texte d un echange
-- prive arriverait dans une boite partagee : ce serait une fuite construite
-- volontairement, et la plus facile a eviter du lot.
-- ============================================================================
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 1. L'evenement
-- ---------------------------------------------------------------------------
alter type notification_event add value if not exists 'message_received';

-- ---------------------------------------------------------------------------
-- 2. Le trigger
--
-- AFTER INSERT, et non BEFORE : une notification referencing un message qui
-- n'existe pas encore serait un renvoi casse. Le trigger est declenche par
-- l'expediteur et vise le destinataire.
--
-- Le nom du role est un etat de session (app.current_user_id), pas une
-- colonne de la table : on lit donc new.recipient_id, qui est fige a
-- l'insertion par la contrainte de 033.
-- ---------------------------------------------------------------------------
create or replace function app.trg_notify_new_message()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.notify_ids(
    array[new.recipient_id],
    'message_received',
    'message',
    new.id
  );
  return new;
end $$;

comment on function app.trg_notify_new_message is
  'Emet message_received vers le destinataire a chaque insertion dans messages. '
  'Ne transporte que l id du message : ni le texte, ni l expediteur.';

create trigger messages_notify_recipient
  after insert on public.messages
  for each row execute function app.trg_notify_new_message();

-- ---------------------------------------------------------------------------
-- 3. Le message part par email
--
-- 033 : " Le courriel dira vous avez un nouveau message, avec un lien vers
-- l'application, ou la session est verifiee par le RLS de la table. "
--
-- C'est la seule ligne ajoutee a la liste de 031. Elle est ici et pas ailleurs
-- parce que la liste est explicite par construction : ajouter un evenement a
-- l'enumeration ne le fait pas partir par email tout seul.
-- ---------------------------------------------------------------------------
create or replace function app.fn_is_email_event(p_event notification_event)
returns boolean
language sql immutable as $$
  select p_event in (
    'correction_requested', 'report_validated', 'report_dismissed',
    'training_assigned', 'training_exercise_reviewed',
    'training_exercise_submitted',
    'account_invited', 'account_disabled', 'account_reactivated',
    'meeting_created', 'meeting_updated', 'meeting_cancelled',
    'message_received'
  );
$$;
-- ---------------------------------------------------------------------------
-- 4. Le contexte lisible par le job
--
-- On rend le NOM de l'expediteur, pour que " KAGEN EMMANUEL vous a ecrit "
-- soit possible. On ne rend ni le texte, ni l'email : meme raison que ci-dessus.
--
-- SECURITY DEFINER pour la meme cause que le reste du projet (031) : le RLS
-- de public.users rend un manager invisible a son propre trader, et le job
-- n'a aucun contexte a lui.
--
-- La fonction est reprise en entier plutot que patchee : elle porte sur quatre
-- types, et une version qui n'en traiterait qu'un casserait les trois autres en
-- silence.
-- ---------------------------------------------------------------------------
create or replace function app.fn_notification_context(
  p_type varchar, p_id uuid
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_ctx jsonb := '{}'::jsonb;
begin
  if p_type = 'training_assignment' then
    select jsonb_build_object(
             'course_title', c.title,
             'trader_name', t.full_name,
             'manager_name', mgr.full_name,
             'due_at', a.due_at)
      into v_ctx
      from public.training_assignments a
      join public.training_courses c on c.id = a.course_id
      join public.users t on t.id = a.trader_id
      left join public.users mgr on mgr.id = a.assigned_by
     where a.id = p_id;

  elsif p_type = 'training_submission' then
    select jsonb_build_object(
             'course_title', c.title,
             'exercise_title', e.title,
             'trader_name', t.full_name,
             'reviewer_name', r.full_name,
             'score', v.score)
      into v_ctx
      from public.training_submissions s
      join public.training_assignments a on a.id = s.assignment_id
      join public.training_courses c on c.id = a.course_id
      join public.training_exercises e on e.id = s.exercise_id
      join public.users t on t.id = s.trader_id
      left join public.training_reviews v on v.submission_id = s.id
      left join public.users r on r.id = v.reviewer_id
     where s.id = p_id;

  elsif p_type = 'report' then
    select jsonb_build_object('session_date', r.session_date) into v_ctx
      from public.reports r where r.id = p_id;

  elsif p_type = 'meeting' then
    select jsonb_build_object(
             'title', m.title,
             'starts_at', m.starts_at,
             'creator_name', u.full_name)
      into v_ctx
      from public.meetings m
      join public.users u on u.id = m.created_by
     where m.id = p_id;

  -- Le nom de l'expediteur, et RIEN D'AUTRE. Pas le texte : voir l'en-tete.
  --
  -- `link_path` est calcule ICI, et non cote job : le cron n'a aucune session,
  -- donc aucun role, et il ne pourrait pas choisir entre la page du trader et
  -- celle du manager. La regle " qui recoit, ou va-t-il lire " appartient a la
  -- base, comme tout le reste de ce module.
  elsif p_type = 'message' then
    select jsonb_build_object(
             'sender_name', u.full_name,
             'link_path', case when r.role = 'trader' then '/mon-manager' else '/equipe' end)
      into v_ctx
      from public.messages m
      join public.users u on u.id = m.sender_id
      join public.users r on r.id = m.recipient_id
     where m.id = p_id;

  end if;

  return coalesce(v_ctx, '{}'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Marquer les notifications d'un fil comme lues
--
-- Un message lu et sa notification non lue produiraient deux etats qui
-- mentent l'un sur l'autre : la page dirait " lu ", la cloche " nouveau ".
-- L'ouverture du fil est le seul moment ou l'utilisateur l'a vu, donc c'est
-- le seul moment ou les deux se mettent d'accord.
--
-- La fonction ne touche QUE les notifications de l'utilisateur courant, liees
-- au message donne. Elle ne peut donc pas servir a effacer la cloche d'un
-- tiers : c'est la meme garantie que app.mark_message_read (033), et pour la
-- meme raison - le role n'a pas le droit d'UPDATE sur notifications_log en
-- general, cette fonction est le seul passage.
-- ---------------------------------------------------------------------------
create or replace function app.mark_message_notification_read(p_message_id uuid)
returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_count int;
begin
  update public.notifications_log
     set read_at = coalesce(read_at, now())
   where related_type = 'message'
     and related_id = p_message_id
     and user_id = app.current_user_id()
     and read_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

comment on function app.mark_message_notification_read is
  'Marque lues les notifications in_app rattachees a un message recu. Ne touche '
  'que les lignes du destinataire : ni un message envoye, ni la cloche d un tiers.';

grant execute on function
  app.mark_message_notification_read(uuid)
to trade_house_app;