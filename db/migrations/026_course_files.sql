-- ============================================================================
-- trade_house - 026_course_files.sql
--
-- Un cours de formation s'enseigne pas seulement en texte. Un schema de
-- gestion du risque, une capture de graphique, un ordre execute : le contenu
-- textuel force a decrire ce qu'une image montre deja, et la description
-- est toujours moins fidele que l'image.
--
-- On ajoute donc des pieces jointes AU COURS, distinctes des captures que le
-- TRADER rend dans ses exercices (training_exercise_files, migration 022).
-- Deux tables ne sont pas une redondance : le support pedagogique appartient au
-- manager et se partage avec tous ceux a qui le cours est attribue, la
-- production de travail appartient au trader et n'appartient qu'a lui.
--
-- Meme stockage prive, meme liste de types fermes, meme verification de la
-- signature reelle du fichier que les pieces jointes de rapport (RG-32, RG-33).
-- Un cours n'ouvre pas une voie de contournement : ce qui passe ici passerait
-- la-bas, et l'inverse doit etre vrai aussi.
-- ============================================================================
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
create table public.training_course_files (
  id            uuid primary key default gen_random_uuid(),
  course_id     uuid not null references public.training_courses(id) on delete cascade,
  storage_path  text not null unique,
  original_name varchar(255) not null,
  mime_type     varchar(100) not null,
  size_bytes    bigint not null check (size_bytes > 0),
  uploaded_by   uuid not null references public.users(id),
  created_at    timestamptz not null default now(),
  -- Liste fermee, identique a celle des pieces jointes de rapport (RG-32) et
  -- des captures d'exercice : la memoire, sinon le validateur s'exerce a eviter
  -- le type qu'il devrait refuser.
  constraint training_course_files_mime check (
    mime_type in ('image/png','image/jpeg','image/webp','application/pdf')
  )
);
create index training_course_files_course_idx on public.training_course_files (course_id, created_at);

-- ---------------------------------------------------------------------------
-- 2. Ecriture
--
create or replace function app.attach_course_file(
  p_course_id     uuid,
  p_storage_path  text,
  p_original_name varchar,
  p_mime_type     varchar,
  p_size_bytes    bigint
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  -- Sans ce test, un uuid arbitraire est accepte et la ligne rattachee
  -- ne sera jamais lisible par personne.
  if not exists (select 1 from public.training_courses where id = p_course_id) then
    raise exception 'FORMATION-25 : cours introuvable';
  end if;

  if p_size_bytes <= 0 then
    raise exception 'FORMATION-26 : fichier vide';
  end if;

  if p_mime_type not in ('image/png','image/jpeg','image/webp','application/pdf') then
    raise exception 'FORMATION-27 : type de fichier non autorise';
  end if;

  -- Seul l'auteur du cours (ou un administrateur) y joint un support : le
  -- contenu pedagogique ne se delega pas. Un manager qui n'a pas ecrit le
  -- cours n'y touche pas, comme il ne corrige pas le cours d'un autre.
  if not app.fn_can_write_course(p_course_id) then
    raise exception 'FORMATION-28 : vous n etes pas l auteur de ce cours';
  end if;

  insert into public.training_course_files
    (course_id, storage_path, original_name, mime_type, size_bytes, uploaded_by)
  values (p_course_id, p_storage_path, p_original_name, p_mime_type, p_size_bytes, app.current_user_id())
  returning id into v_id;

  perform app.fn_audit('training.course_file', 'training_course', p_course_id,
                       jsonb_build_object('name', p_original_name, 'mime', p_mime_type, 'size', p_size_bytes));

  return v_id;
end $$;

comment on function app.attach_course_file is
  'Auteur du cours (ou admin) uniquement : joint une image ou un PDF au support pedagogique.';

-- ---------------------------------------------------------------------------
-- 3. Retrait
-- ---------------------------------------------------------------------------
create or replace function app.remove_course_file(p_file_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_course uuid;
begin
  select course_id into v_course from public.training_course_files where id = p_file_id;

  if v_course is null then
    raise exception 'FORMATION-29 : fichier introuvable';
  end if;
  if not app.fn_can_write_course(v_course) then
    raise exception 'FORMATION-28 : vous n etes pas l auteur de ce cours';
  end if;

  delete from public.training_course_files where id = p_file_id;
end $$;

-- ---------------------------------------------------------------------------
-- 4. RLS
--
-- Un support de cours se lit des que le cours est attribue au lecteur, ou
-- par son auteur, ou par un administrateur. Sans cela, un trader ne pourrait
-- pas telecharger le PDF de son propre cours alors qu'il en a le droit.
-- ---------------------------------------------------------------------------
alter table public.training_course_files enable row level security;

create policy training_course_files_select on public.training_course_files for select
  using (
    uploaded_by = app.current_user_id()
    or app.is_admin()
    or exists (
      select 1
        from public.training_courses c
       where c.id = training_course_files.course_id
         and (c.author_id = app.current_user_id()
              or exists (
                select 1
                  from public.training_assignments a
                 where a.course_id = c.id
                   and a.trader_id = app.current_user_id()
              ))
    )
  );

-- L'ecriture passe par les fonctions ci-dessus : on retire le droit direct,
-- conformement a l'approche des migrations 016 et 024.
revoke insert, update, delete on public.training_course_files from trade_house_app;

grant select on public.training_course_files to trade_house_app;

grant execute on function
  app.attach_course_file(uuid, text, varchar, varchar, bigint),
  app.remove_course_file(uuid)
to trade_house_app;

comment on table public.training_course_files is
  'Supports du cours (captures, schemas, PDF). Distingues des captures rendues '
  'par le trader dans ses exercices : celles-ci lui appartiennent, celles-la '
  'appartiennent au cours et se partagent avec tous les attribues.';

-- Fonction SECURITY DEFINER plutot qu'un simple retrait de revoke : la regle
-- "seul l'auteur du cours joint un support" ne s'exprime pas par une
-- politique RLS simple, qui ne peut pas consulter training_courses sans
-- ouvrir une boucle de politiques.
-- ---------------------------------------------------------------------------
