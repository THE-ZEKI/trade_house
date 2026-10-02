-- ---------------------------------------------------------------------------
-- 020 - Annotations et pieces jointes : fermeture d'un trou et suppression
--
-- 1. CORRECTION DE SECURITE
--    008_rls.sql a cree :
--        create policy annotations_write on public.file_annotations
--          for all using (app.can_manage_trader(...)) with check (true);
--
--    Pour un INSERT, PostgreSQL n'applique que `with check` : la clause `using`
--    n'est pas evaluee. Avec `with check (true)`, cette politique n'interdit
--    donc RIEN a l'insertion : tout utilisateur authentifie pouvait ecrire une
--    annotation sur le fichier d'un autre, y compris celui d'un trader d'une
--    autre equipe. Le `using` ne protegeait que la mise a jour et la
--    suppression, pas la creation.
--
--    On la remplace par trois politiques distinctes, chacune avec une clause
--    `using` ET une clause `with check` explicites.
--
-- 2. Suppression d'une piece jointe avant depot (RG-31)
--    Le trader doit pouvoir corriger un depot : retirer une mauvaise capture
--    fait partie du travail. La suppression est reservee au proprietaire, et
--    seulement tant que le rapport n'est pas sorti du brouillon.
-- ---------------------------------------------------------------------------

drop policy if exists annotations_write on public.file_annotations;
-- `annotations_select` existe deja depuis la migration 008. On la recree malgre
-- tout pour deux raisons : elle faisait reference a une sous-requete qui sera
-- remplacee par app.fn_annotation_report_trader, et `create policy` echouerait
-- sinon sur une base deja installee - donc la migration ne serait pas rejouable.
drop policy if exists annotations_select on public.file_annotations;

-- Qui est proprietaire du rapport portant ce fichier ?
create or replace function app.fn_annotation_report_trader(p_file_id uuid)
returns uuid
language sql stable security definer set search_path = public, app as $$
  select r.trader_id
    from public.report_files f
    join public.reports r on r.id = f.report_id
   where f.id = p_file_id
$$;

-- Lecture : quiconque a le droit de voir le trader (RLS aligne sur 008).
create policy annotations_select on public.file_annotations for select
  using (app.can_view_trader(app.fn_annotation_report_trader(file_id)));

-- Ecriture : encadrement uniquement, et l auteur est impose a l utilisateur
-- courant. Sans ce dernier controle, un manager pourrait signer une annotation
-- au nom d'un tiers en forcant author_id.
create policy annotations_insert on public.file_annotations for insert
  with check (
    app.can_manage_trader(app.fn_annotation_report_trader(file_id))
    and author_id = app.current_user_id()
  );

create policy annotations_update on public.file_annotations for update
  using (app.can_manage_trader(app.fn_annotation_report_trader(file_id)))
  with check (
    app.can_manage_trader(app.fn_annotation_report_trader(file_id))
    and author_id = app.current_user_id()
  );

-- L encadrement peut corriger sa propre annotation ; le laisse dans le meme
-- temps, ce qui evite de bloquer un encadrement absent sur un dessin errone.
create policy annotations_delete on public.file_annotations for delete
  using (
    app.can_manage_trader(app.fn_annotation_report_trader(file_id))
    or author_id = app.current_user_id()
  );

-- Coordonnees normalisees : les annotations sont stockees en fraction de la
-- largeur/hauteur de l'image (0..1) afin de survivre a un changement de
-- resolution. On l'impose ici plutot que dans l'API : une annotation hors
-- cadre serait invisible a l'affichage, silencieusement.
alter table public.file_annotations
  add constraint file_annotations_coords check (
    jsonb_typeof(data -> 'x') = 'number'
    and (data -> 'x') between '0'::jsonb and '1'::jsonb
    and jsonb_typeof(data -> 'y') = 'number'
    and (data -> 'y') between '0'::jsonb and '1'::jsonb
  );

-- La taille n est exigee que pour les formes etinfees par une bounding box.
alter table public.file_annotations
  add constraint file_annotations_size check (
    shape not in ('rectangle', 'circle')
    or (
      jsonb_typeof(data -> 'w') = 'number' and (data -> 'w') > '0'::jsonb
      and jsonb_typeof(data -> 'h') = 'number' and (data -> 'h') > '0'::jsonb
    )
  );

-- ---------------------------------------------------------------------------
-- Suppression d une piece jointe (RG-31)
-- ---------------------------------------------------------------------------
create policy files_delete on public.report_files for delete
  using (
    exists (
      select 1
        from public.reports r
       where r.id = report_id
         and r.trader_id = app.current_user_id()
         and r.status in ('draft', 'correction_requested')
    )
  );