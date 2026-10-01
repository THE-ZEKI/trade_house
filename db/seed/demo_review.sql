-- Rapport en revue, pour la verification des permissions de l'interface.
--
-- Pourquoi : « demander des correctifs », « valider » et « ajouter un correctif »
-- ne sont proposes qu'a partir d'un certain statut. Sans ce jeu de donnees, le
-- test des droits ne controlerait que des boutons absents pour de mauvaises
-- raisons.
--
-- On traverse le VRAI parcours : brouillon -> piece jointe -> depot -> revue.
-- Aucune etape n'est forcee. Les regles de la base sont la reference :
--   - RG-31  un depot exige au moins une piece jointe
--   - reports_reviewer_stamp  une revue exige un relecteur identifie
-- Un jeu de donnees qui contournerait ces regles testerait des etats que
-- l'application ne peut jamais produire.
--
-- Idempotent : ne cree rien si un rapport attend deja une revue.
begin;

-- 0. le trader est rattache a son manager -------------------------------------
-- Indispensable : app.can_manage_trader() exige ce lien pour autoriser une
-- revue. Sans lui, RG-41 refuse le passage en in_review — ce qui est correct :
-- un manager ne peut pas relire un trader qui n'est pas dans son equipe.
update public.users t
   set manager_id = m.id
  from public.users m
 where t.email = 'trader1@trade-house.local'
   and m.email = 'manager@trade-house.local'
   and t.manager_id is distinct from m.id;

-- 1. le trader redige un brouillon ------------------------------------------
select set_config('app.user_id', u.id::text, true)
  from public.users u where u.email = 'trader1@trade-house.local';

insert into public.reports (trader_id, session_date, instrument, result_type, result_amount,
                             strategy, nb_trades, plan_respected, rr_planned, rr_realized,
                             emotions, highlights, mistakes, notes)
select u.id, current_date - 2, 'GBPUSD', 'loss', -180, 'Range', 4, false, 2.0, 0.8,
       ARRAY['fomo']::emotion_code[], 'Entree correcte, sortie trop tot.',
       'A modifie apres deux pertes.',
       'Donnee de verification : rapport place en revue pour tester les actions.'
  from public.users u
 where u.email = 'trader1@trade-house.local'
   and not exists (
     select 1 from public.reports r
      where r.trader_id = u.id and r.status in ('draft', 'submitted', 'in_review')
   );

-- 2. il joint une capture (RG-31) ------------------------------------------
-- version_id reste NULL ici : la version est figee au moment du depot par le
-- trigger report_version_snapshot. La piece appartient au rapport, la version
-- sera renseignee apres coup. C'est le ordre reel du parcours.
insert into public.report_files (report_id, version_id, kind, storage_path,
                                  original_name, mime_type, size_bytes, uploaded_by)
select r.id, null, 'screenshot',
       'demo/verification-report.png', 'verification.png', 'image/png', 1024, u.id
  from public.reports r
  join public.users u on u.id = r.trader_id
 where u.email = 'trader1@trade-house.local' and r.status = 'draft'
   and not exists (select 1 from public.report_files f where f.report_id = r.id)
 order by r.created_at desc limit 1;

-- 3. il depose ----------------------------------------------------------------
select app.submit_report(r.id)
  from public.reports r
  join public.users u on u.id = r.trader_id
 where u.email = 'trader1@trade-house.local' and r.status = 'draft'
 order by r.created_at desc limit 1;

-- 4. le manager prend en revue ------------------------------------------------
-- C'est le MANAGER, pas un administrateur de passage : c'est a lui que les
-- boutons de revue doivent apparaitre.
select set_config('app.user_id', m.id::text, true)
  from public.users m where m.email = 'manager@trade-house.local';

select app.start_review(r.id)
  from public.reports r
  join public.users u on u.id = r.trader_id
 where u.email = 'trader1@trade-house.local' and r.status = 'submitted'
 order by r.submitted_at desc limit 1;

commit;