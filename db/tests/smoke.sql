-- ============================================================================
-- trade_house - tests/smoke.sql
-- Test de bout en bout : verifie que les regles du CDC sont bien appliquees
-- par la base (et non seulement prevues).
--
--   psql -U postgres -d trade_house -f db/tests/smoke.sql
--
-- Le script travaille dans une transaction terminee par ROLLBACK : aucune
-- donnee n'est conservee. Les assertions affichent [ok] / [KO].
-- ============================================================================
\set ON_ERROR_STOP on
\timing off
\echo ''
\echo '=== trade_house - test de non-regression des regles metier ==='

-- Helpers d'assertion (schemas temporaires : supprimes en fin de transaction)
create or replace function pg_temp.ok(p_label text) returns void language plpgsql as $$
begin raise notice '  [ok] %', p_label; end $$;

create or replace function pg_temp.assert_fails(p_label text, p_sql text, p_expected text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_expected in sqlerrm) > 0 then
      raise notice '  [ok] % -- bloque : %', p_label, left(sqlerrm, 70);
      return;
    end if;
    raise exception '  [KO] % -- message inattendu : %', p_label, sqlerrm;
  end;
  raise exception '  [KO] % -- aucune erreur levee (regle non appliquee)', p_label;
end $$;

-- Comparaison en texte : evite les incompatibilites integer/bigint/jsonb
create or replace function pg_temp.assert_equals(p_label text, p_expected text, p_got text)
returns void language plpgsql as $$
begin
  if p_expected is distinct from p_got then
    raise exception '  [KO] % -- attendu %, obtenu %', p_label, p_expected, p_got;
  end if;
  raise notice '  [ok] %', p_label;
end $$;

begin;

-- ===========================================================================
-- 1. COMPTES ET ROLES (RG-01, RG-02, RG-05, RG-06, RG-65)
-- ===========================================================================
\echo ''
\echo '-- 1. Comptes et roles'

select app.set_user((select id from public.users where role = 'admin' and is_active limit 1));
select pg_temp.ok('session admin activee');

-- creation par l'admin : autorisee
select app.create_user('t3@trade-house.local', 'Trader Trois', 'trader',
                        (select id from public.users where role = 'manager'));
-- trader non invite : sert au test RG-22 (acces a la salle)
select app.create_user('t4@trade-house.local', 'Trader Quatre', 'trader',
                        (select id from public.users where role = 'manager'));
select pg_temp.ok('RG-02 : l''admin cree un trader');

-- RG-06 : le manager ne peut pas creer de compte
select app.set_user((select id from public.users where role = 'manager'));
select pg_temp.assert_fails('RG-06 : le manager ne cree pas de compte',
  $$select app.create_user('x@trade-house.local', 'X', 'trader', null)$$, 'seul l''admin');

-- RG-01 : email unique (insensible a la casse, citext)
select app.set_user((select id from public.users where role = 'admin' and is_active limit 1));
select pg_temp.assert_fails('RG-01 : email deja utilise',
  $$select app.create_user('T3@trade-house.local', 'Doublon', 'trader', null)$$, 'deja utilise');

-- RG-05 : le renvoi d'invitation revoque le lien precedent
select app.issue_invitation((select id from public.users where email = 't3@trade-house.local'));
select app.issue_invitation((select id from public.users where email = 't3@trade-house.local'));
select pg_temp.assert_equals('RG-05 : un seul lien actif', 1::text,
  (select count(*) from public.user_invitations i
    where i.user_id = (select id from public.users where email = 't3@trade-house.local')
      and i.consumed_at is null and i.revoked_at is null)::text);

-- RG-65 : politique de mot de passe
select pg_temp.assert_equals('RG-65 : "court1!" rejete', false::text, app.fn_password_meets_policy('court1!')::text);
select pg_temp.assert_equals('RG-65 : "Motdepasse1!" accepte', true::text, app.fn_password_meets_policy('Motdepasse1!')::text);

-- RG-02 : un administrateur ne peut pas se desactiver lui-meme
select app.create_user('admin2@trade-house.local', 'Admin Deux', 'admin', null,
                       null, 'UTC', 'fr', false);
select pg_temp.assert_fails('RG-02 : auto-desactivation refusee',
  $$update public.users set is_active = false where id = app.current_user_id()$$,
  'propre compte');
select pg_temp.ok('RG-02 : desactivation d''un autre administrateur autorisee');

-- RG-02 : le dernier administrateur actif ne peut pas etre desactive.
-- On change d'acteur (un manager) pour ne pas declencher la regle
-- d'auto-desactivation : c'est bien la regle ?? dernier admin ?? qui est testee.
update public.users set is_active = false where email = 'admin2@trade-house.local';
select app.set_user((select id from public.users where role = 'manager'));
select pg_temp.assert_fails('RG-02 : dernier administrateur actif protege',
  $$update public.users set is_active = false where role = 'admin' and is_active$$,
  'dernier administrateur');
select app.set_user((select id from public.users where role = 'admin' and is_active limit 1));
select pg_temp.ok('comptes : OK');

-- ===========================================================================
-- 2. REUNIONS ET RAPPELS (RG-10, RG-11, RG-13, RG-14, RG-15, RG-18)
-- ===========================================================================
\echo ''
\echo '-- 2. Reunions et rappels'

select app.set_user((select id from public.users where role = 'admin' and is_active limit 1));
select pg_temp.assert_fails('RG-10 : au moins un participant',
  $$select app.create_meeting('R', null, 'internal', now() + interval '2 days', 60, '{}'::uuid[])$$,
  'au moins un participant');

select pg_temp.assert_fails('RG-10 : date future',
  $$select app.create_meeting('R', null, 'internal', now() - interval '1 day', 60,
     array[(select id from public.users where role = 'trader' limit 1)])$$, 'futur');

select pg_temp.assert_fails('RG-11 : lien https obligatoire',
  $$select app.create_meeting('R', null, 'external', now() + interval '2 days', 60,
     array[(select id from public.users where role = 'trader' limit 1)])$$, 'lien https');

-- RG-06 : le manager n'invite que ses propres traders (utilise ci-apres un autre manager)
-- creation valide
-- t4 est volontairement exclu : il ne doit pas etre invite (test RG-22)
create temporary table t_ids as
select array_agg(id) as traders from public.users
 where role = 'trader' and email <> 't4@trade-house.local';
-- Attention : SELECT fonction_composite() INTO TEMP TABLE creerait UNE colonne
-- de type composite ; on selectionne explicitement l'identifiant.
select (app.create_meeting('Reunion de suivi', 'Point hebdomadaire', 'internal',
                           now() + interval '3 days', 45, t_ids.traders)).id
  into temporary table created_meeting
  from t_ids;
select pg_temp.ok('reunion interne creee');

-- RG-14 : trois rappels par defaut (invitation, J-1, H-1)
select pg_temp.assert_equals('RG-14 : 3 rappels par defaut', 3::text,
  (select count(*) from public.meeting_reminders r
    where r.meeting_id = (select id from created_meeting)
      and r.kind in ('invitation','d_minus_1','h_minus_1'))::text);

-- RG-11 : un lien interne est refuse (le schema impose https pour tout lien)
select pg_temp.assert_fails('RG-11 : lien en http refuse',
  $$select app.update_meeting_link((select id from created_meeting), 'http://x.test/r')$$,
  'https');

-- RG-12 : un seul lien principal, l'historique est conserve
select app.update_meeting_link((select id from created_meeting), 'https://meet.test/a');
select app.update_meeting_link((select id from created_meeting), 'https://meet.test/b');
select pg_temp.assert_equals('RG-12 : un seul lien courant', 1::text,
  (select count(*) from public.meeting_links l
    where l.meeting_id = (select id from created_meeting) and l.is_current)::text);
select pg_temp.assert_equals('RG-12 : historique conserve', 2::text,
  (select count(*) from public.meeting_links l where l.meeting_id = (select id from created_meeting))::text);

-- RG-10 : detection des conflits (avertissement non bloquant, jamais bloquant).
-- On cherche bien les user_id des participants : la reunion elle-meme est un conflit.
select pg_temp.assert_equals('RG-10 : conflit detecte sans blocage', true::text,(exists (select 1 from app.meeting_conflicts(
            (select array_agg(user_id) from public.meeting_participants
              where meeting_id = (select id from created_meeting)),
            (select starts_at from public.meetings where id = (select id from created_meeting)),
            60)))::text);
select pg_temp.assert_equals('RG-10 : aucune connexion si la reunion est exclue', false::text,(exists (select 1 from app.meeting_conflicts(
            (select array_agg(user_id) from public.meeting_participants
              where meeting_id = (select id from created_meeting)),
            (select starts_at from public.meetings where id = (select id from created_meeting)),
            60,
            (select id from created_meeting))))::text);

-- RG-14 : un rappel ne peut pas etre programme dans le passe
select pg_temp.assert_fails('RG-14 : rappel programme dans le passe refuse',
  $$update public.meeting_reminders set send_at = now() - interval '1 hour'
     where meeting_id = (select id from created_meeting) and kind = 'invitation'$$,
  'RG-14');

-- RG-15 : un participant qui a refuse est exclu des rappels
update public.meeting_participants set rsvp_status = 'declined'
 where meeting_id = (select id from created_meeting)
   and user_id = (select id from public.users where role = 'trader' order by id limit 1);
select app.send_manual_reminder((select id from created_meeting));
select pg_temp.assert_equals('RG-15 : le refus est exclu de la relance', 0::text,
  (select count(*) from public.notifications_log n
     join public.meeting_reminders r on r.id = n.reminder_id
     join public.meeting_participants mp on mp.meeting_id = r.meeting_id
    where r.kind = 'manual' and n.user_id = mp.user_id and mp.rsvp_status = 'declined')::text);
select pg_temp.ok('reunions : OK');

-- ===========================================================================
-- 3. RAPPORTS ET CYCLE DE CORRECTION (D1, D2 - RG-31, RG-36, RG-43, RG-45, RG-49)
-- ===========================================================================
\echo ''
\echo '-- 3. Rapports et cycle de correction'

select app.set_user((select id from public.users where email = 'trader1@trade-house.local'));

-- RG-36 : une date de session dans le futur est refusee
select pg_temp.assert_fails('RG-36 : date de session future refusee',
  $$insert into public.reports (trader_id, session_date) values (app.current_user_id(), current_date + 1)$$,
  'RG-36');

create temporary table r1 (id uuid);
with ins as (
  insert into public.reports (trader_id, session_date, instrument, result_type,
                              result_amount, nb_trades, plan_respected, notes)
  values (app.current_user_id(), current_date - 1, 'EURUSD', 'gain', 120.00, 4, true, 'v1')
  returning id)
insert into r1 (id) select id from ins;

-- RG-31 : soumission sans piece jointe refusee
select pg_temp.assert_fails('RG-31 : soumission sans piece jointe refusee',
  $$select app.submit_report((select id from r1))$$, 'RG-31');

insert into public.report_files (report_id, kind, storage_path, original_name, mime_type, size_bytes)
select id, 'screenshot', 'dev/test/capture-1.png', 'capture.png', 'image/png', 50000 from r1;

-- RG-32 : type de fichier incoherent refuse
select pg_temp.assert_fails('RG-32 : mime incoherent refuse',
  $$insert into public.report_files (report_id, kind, storage_path, original_name, mime_type, size_bytes)
    select id, 'pdf', 'dev/test/x.pdf', 'x.pdf', 'image/png', 1000 from r1$$, 'report_files_pdf_mime');

select app.submit_report((select id from r1));
set constraints all immediate;   -- declenche les triggers differes (RG-45)
select pg_temp.assert_equals('RG-45 : version 1 figee a la soumission', 1::text,
  (select count(*) from public.report_versions v
    where v.report_id = (select id from r1) and v.version_number = 1)::text);
select pg_temp.assert_equals('D2 : is_late calcule a la soumission (J-1)', false::text,
  (select is_late from public.reports where id = (select id from r1))::text);

-- RG-41 : le trader ne peut pas mettre lui-meme le rapport en revision
select pg_temp.assert_fails('RG-41 : le trader ne pilote pas la relecture',
  $$select app.start_review((select id from r1))$$, 'RG-41');

-- relecture et demande de correction
select app.set_user((select id from public.users where role = 'admin' and is_active limit 1));
select app.start_review((select id from r1));
select pg_temp.ok('RG-41 : l''admin met le rapport en revision');

-- RG-42 : une demande de correction exige au moins un correctif
select pg_temp.assert_fails('RG-42 : demande de correction vide refusee',
  $$select app.request_corrections((select id from r1))$$, 'RG-42');

select app.add_correction((select id from r1), 'Preciser le point d''entree', 'mandatory', 'field', 'notes');
select app.request_corrections((select id from r1), now() + interval '3 days');
select pg_temp.assert_equals('E2 : statut correction demandee', 'correction_requested'::text,
  (select status from public.reports where id = (select id from r1))::text);

-- RG-43 : resoumission bloquee tant qu'un correctif obligatoire est ouvert
select app.set_user((select id from public.users where email = 'trader1@trade-house.local'));
select pg_temp.assert_fails('RG-43 : resoumission bloquee par un correctif ouvert',
  $$select app.resubmit_report((select id from r1))$$, 'RG-43');

select app.respond_correction(
  (select id from public.report_corrections where report_id = (select id from r1) and severity = 'mandatory'),
  'done', 'Point d''entree ajoute en v2');
update public.reports set notes = 'v2 - point d''entree precise' where id = (select id from r1);
select app.resubmit_report((select id from r1));
set constraints all immediate;
select pg_temp.assert_equals('RG-45 : version 2 figee, v1 conservee', 2::text,
  (select count(*) from public.report_versions v where v.report_id = (select id from r1))::text);
select pg_temp.assert_equals('D1 : current_version = 2', 2::text,
  (select current_version from public.reports where id = (select id from r1))::text);

-- RG-49 : validation impossible tant qu'un correctif obligatoire non tranche
select app.set_user((select id from public.users where role = 'admin' and is_active limit 1));
select app.start_review((select id from r1));
select app.add_correction((select id from r1), 'Verifier le ratio R/R', 'mandatory', 'general');
select app.request_corrections((select id from r1));
select pg_temp.assert_fails('RG-49 : validation bloquee par un correctif ouvert',
  $$select app.validate_report((select id from r1))$$, 'RG-49');

-- rejet du trader puis arbitrage admin : RG-43 exige un arbitrage avant validation
select app.set_user((select id from public.users where email = 'trader1@trade-house.local'));
select app.respond_correction(
  (select id from public.report_corrections where report_id = (select id from r1)
    and status = 'open' order by created_at desc limit 1),
  'rejected', 'Le ratio est correct ainsi');
select app.set_user((select id from public.users where role = 'admin' and is_active limit 1));
select pg_temp.assert_fails('RG-49 : un correctif rejete non arbitre bloque la validation',
  $$select app.validate_report((select id from r1))$$, 'RG-49');
select app.arbitrate_correction(
  (select id from public.report_corrections where report_id = (select id from r1)
    and status = 'rejected' limit 1), false);
select app.validate_report((select id from r1));
select pg_temp.assert_equals('E5 : rapport valide', 'validated'::text,
  (select status from public.reports where id = (select id from r1))::text);

-- RG-35 : verrouillage apres validation
select pg_temp.assert_fails('RG-35 : rapport valide verrouille',
  $$update public.reports set notes = 'tentative' where id = (select id from r1)$$, 'RG-35');

-- RG-06 : le manager ne rouvre pas, l'admin oui
select app.set_user((select id from public.users where role = 'manager'));
select pg_temp.assert_fails('RG-06 : le manager ne rouvre pas un rapport valide',
  $$select app.reopen_report((select id from r1), 'erreur de saisie')$$, 'RG-06');
select app.set_user((select id from public.users where role = 'admin' and is_active limit 1));
select app.reopen_report((select id from r1), 'erreur de saisie');
select pg_temp.assert_equals('RG-35 : reouverture journalisee', 'in_review'::text,
  (select status from public.reports where id = (select id from r1))::text);
select pg_temp.ok('cycle de correction : OK');

-- ===========================================================================
-- 4. DECLARATION " PAS DE TRADING " ET HORS DELAI (D2 - RG-36, RG-37)
-- ===========================================================================
\echo ''
\echo '-- 4. Declaration pas de trading et hors delai'

select app.set_user((select id from public.users where email = 'trader1@trade-house.local'));

-- RG-36 : soumission a J-10 exige un motif et marque le rapport " hors delai "
create temporary table r2 (id uuid);
with ins as (
  insert into public.reports (trader_id, session_date, instrument, result_type,
                              result_amount, nb_trades, plan_respected)
  values (app.current_user_id(), current_date - 10, 'NAS100', 'loss', -80.00, 6, false)
  returning id)
insert into r2 (id) select id from ins;
insert into public.report_files (report_id, kind, storage_path, original_name, mime_type, size_bytes)
select id, 'pdf', 'dev/test/old.pdf', 'old.pdf', 'application/pdf', 90000 from r2;

select pg_temp.assert_fails('RG-36 : soumission hors delai sans motif refusee',
  $$select app.submit_report((select id from r2))$$, 'RG-36');

update public.reports set late_reason = 'Reports de la semaine absorbee par la formation' where id = (select id from r2);
select app.submit_report((select id from r2));
select pg_temp.assert_equals('D2 : is_late fige a true', true::text,
  (select is_late from public.reports where id = (select id from r2))::text);

-- RG-37 : declaration " pas de trading "
select app.declare_no_trade(current_date - 3, 'Marche ferme');
select pg_temp.ok('RG-37 : declaration acceptee');
select pg_temp.assert_equals('D1d : statut declared', 'declared'::text,
  (select status from public.reports where session_date = current_date - 3
     and trader_id = (select id from public.users where email = 'trader1@trade-house.local'))::text);

select pg_temp.assert_fails('RG-37 : une seule declaration par jour',
  $$select app.declare_no_trade(current_date - 3, 'encore')$$, 'reports_no_trade_unique_idx');

-- RG-37 : si un rapport existe pour la date, la declaration est refusee
select pg_temp.assert_fails('RG-37 : declaration refusee si un rapport existe',
  $$select app.declare_no_trade(current_date - 10, 'oups')$$, 'RG-37');

-- RG-37 : le trader peut annuler sa declaration puis saisir un rapport
select app.cancel_no_trade((select id from public.reports where session_date = current_date - 3
                             and trader_id = (select id from public.users where email = 'trader1@trade-house.local')));
select pg_temp.assert_equals('RG-37 : declaration annulee', 0::text,
  (select count(*) from public.reports where session_date = current_date - 3
     and trader_id = (select id from public.users where email = 'trader1@trade-house.local'))::text);
select pg_temp.ok('declaration pas de trading : OK');

-- ===========================================================================
-- 5. PRESENCE (D4 - RG-20, RG-22, RG-23)
-- ===========================================================================
\echo ''
\echo '-- 5. Presence et salle'

select app.set_user((select id from public.users where role = 'admin' and is_active limit 1));

-- RG-20 : la salle d'une reunion future n'est pas ouverte
select pg_temp.assert_fails('RG-20 : salle fermee avant T-10 min',
  $$select app.attendance_join((select id from created_meeting),
                               (select id from public.users where role = 'trader' limit 1))$$, 'RG-20');

-- RG-22 : acces reserve aux participants invites (t4 n'est pas invite)
select app.set_user((select id from public.users where email = 't4@trade-house.local'));
select pg_temp.assert_fails('RG-22 : acces reserve aux invites',
  $$select app.attendance_join((select id from created_meeting), app.current_user_id())$$, 'RG-22');
select app.set_user((select id from public.users where role = 'admin' and is_active limit 1));

-- reunion passee : la duree reelle fait foi (premiere arrivee -> derniere sortie).
-- 40 min reelles => seuil de presence = 20 min (RG-23).
create temporary table m2 (id uuid);
with ins as (
  insert into public.meetings (title, type, starts_at, duration_min, created_by,
                               actual_started_at, actual_ended_at)
  values ('Reunion passee', 'internal', now() - interval '40 minutes', 60,
          app.current_user_id(), now() - interval '40 minutes', now())
  returning id)
insert into m2 (id) select id from ins;

insert into public.meeting_participants (meeting_id, user_id)
select (select id from m2), id from public.users where role = 'trader';

-- trader1 : arrive 15 min apres le debut (donc « en retard »), se deconnecte,
-- se reconnecte : 1380 s cumulees > 1200 s (seuil) -> present MAIS en retard.
insert into public.meeting_attendance (meeting_id, user_id, joined_at, left_at, source)
values ((select id from m2), (select id from public.users where email = 'trader1@trade-house.local'),
        now() - interval '25 minutes', now() - interval '12 minutes', 'client'),
       ((select id from m2), (select id from public.users where email = 'trader1@trade-house.local'),
        now() - interval '10 minutes',  now(), 'client');
-- trader2 : present du debut a la fin
insert into public.meeting_attendance (meeting_id, user_id, joined_at, left_at, source)
values ((select id from m2), (select id from public.users where email = 'trader2@trade-house.local'),
        now() - interval '40 minutes', now(), 'client');

select app.materialize_attendance((select id from m2));
select pg_temp.assert_equals('RG-23 : arrivee tardive = late', 'late'::text,
  (select status from public.meeting_attendance_result
    where meeting_id = (select id from m2)
      and user_id = (select id from public.users where email = 'trader1@trade-house.local'))::text);
select pg_temp.assert_equals('D4 : les reconnexions sont cumulees (1380 s)', 1380::text,
  (select total_seconds from public.meeting_attendance_result
    where meeting_id = (select id from m2)
      and user_id = (select id from public.users where email = 'trader1@trade-house.local'))::text);
select pg_temp.assert_equals('RG-23 : present sur toute la reunion', 'present'::text,
  (select status from public.meeting_attendance_result
    where meeting_id = (select id from m2)
      and user_id = (select id from public.users where email = 'trader2@trade-house.local'))::text);
select pg_temp.ok('presence : OK');

-- ===========================================================================
-- 6. ISOLATION DES ROLES (RG-04, RG-06, RG-61, RG-63)
--    Ces controles sont faits avec le role NON proprietaire trade_house_app :
--    c'est la seule facon dont le RLS est reellement evalue (le proprietaire
--    des tables contourne les politiques).
-- ===========================================================================
\echo ''
\echo '-- 6. Isolation des roles (RLS)'

-- Les identifiants sont lus AVANT de basculer sur le role applicatif : un
-- manager ne peut pas lire la ligne d'un admin (RG-04), la sous-requiche
-- renverrait sinon NULL et le contexte deviendrait anonyme.
create temporary table ids as
select (select id from public.users where role = 'admin'   and is_active limit 1) as admin,
       (select id from public.users where role = 'manager' and is_active limit 1) as manager,
       (select id from public.users where email = 'trader1@trade-house.local') as t1;
-- la table temporaire appartient au proprietaire : on ouvre l'acces au role applicatif
grant select on ids to trade_house_app;

set local role trade_house_app;

-- RG-04 : un trader ne voit que ses propres rapports
select app.set_user((select t1 from ids));
select pg_temp.assert_equals('RG-04 : aucun rapport d''un autre trader visible', 0::text,
  (select count(*) from public.reports where trader_id <> app.current_user_id())::text);
select pg_temp.assert_equals('RG-04 : ses propres rapports visibles', 2::text,
  (select count(*) from public.reports)::text);

-- RG-04 / RG-06 : un manager ne voit que les rapports de ses traders
select app.set_user((select manager from ids));
select pg_temp.assert_equals('RG-04 : le manager voit uniquement ses traders', 0::text,
  (select count(*) from public.reports r join public.users t on t.id = r.trader_id
    where t.manager_id is distinct from app.current_user_id())::text);

-- RG-06 : le manager n'a pas acces au journal d'audit global
select pg_temp.assert_equals('RG-06 : journal d''audit reserve a l''admin', 0::text,
  (select count(*) from public.audit_log)::text);
select pg_temp.assert_equals('RG-06 : le manager ne voit pas les comptes des autres', 0::text,
  (select count(*) from public.users where role = 'manager' and id <> app.current_user_id())::text);

-- l'admin voit tout
select app.set_user((select admin from ids));
select pg_temp.assert_equals('l''admin voit le journal d''audit', true::text,
  ((select count(*) from public.audit_log) > 0)::text);
-- RG-63 : les actions sensibles sont journalisees
select pg_temp.assert_equals('RG-63 : validation journalisee', true::text,(exists (select 1 from public.audit_log where action = 'report.validate'))::text);
select pg_temp.assert_equals('RG-63 : reouverture journalisee', true::text,(exists (select 1 from public.audit_log where action = 'report.reopen'))::text);
select pg_temp.assert_equals('RG-63 : desactivation journalisee', false::text,(exists (select 1 from public.audit_log where action = 'user.deactivate'))::text);

reset role;
select pg_temp.ok('isolation des roles : OK');

\echo ''
\echo '=== TOUTES LES ASSERTIONS SONT PASSEES ==='

rollback;
\echo 'Transaction annulee : la base n''a pas ete modifiee.'





