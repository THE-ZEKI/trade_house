-- ============================================================================
-- trade_house - 024_training_files_write.sql
--
-- La table training_exercise_files (migration 022) est en lecture seule pour
-- le role applicatif : `revoke insert` y est pose, conformement a l approche
-- de la migration 016 sur public.users.
--
-- Il manque donc le chemin d'ECRITURE. On l'ajoute comme une fonction
-- SECURITY DEFINER plutot qu'enlevantant le revoke, pour deux raisons :
--
--   - la regle " seul le proprietaire de la soumission rattache un fichier " ne
--     peut pas etre exprimee par une politique RLS simple, qui ne voit pas la
--     colonne submission_id jusqu'a la table jointe ;
--   - une fonction permet aussi de controler la taille et le type, comme le
--     fait deja l'API pour les pieces jointes de rapport (RG-32).
-- ============================================================================
\set ON_ERROR_STOP on

create or replace function app.attach_training_file(
  p_submission_id  uuid,
  p_storage_path   text,
  p_original_name  varchar,
  p_mime_type      varchar,
  p_size_bytes     bigint
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_trader uuid;
  v_id     uuid;
begin
  select s.trader_id into v_trader
    from public.training_submissions s where s.id = p_submission_id;

  if v_trader is null then
    raise exception 'FORMATION-20 : soumission introuvable';
  end if;
  -- Un manager ne rattache PAS une capture a la place du trader : la reponse
  -- doit venir de celui qui a fait le travail.
  if v_trader <> app.current_user_id() then
    raise exception 'FORMATION-21 : cette soumission ne vous appartient pas';
  end if;

  if p_size_bytes is null or p_size_bytes <= 0 then
    raise exception 'FORMATION-22 : fichier vide';
  end if;
  -- RG-32 : 10 Mo, meme plafond que les pieces jointes de rapport. La
  -- verification du type REEL (magic bytes) reste cote API : la base ne voit
  -- que le type annonce.
  if p_size_bytes > 10 * 1024 * 1024 then
    raise exception 'FORMATION-23 : fichier trop volumineux (10 Mo maximum)';
  end if;
  if p_mime_type not in ('image/png','image/jpeg','image/webp','application/pdf') then
    raise exception 'FORMATION-24 : type de fichier non autorise';
  end if;

  insert into public.training_exercise_files
    (submission_id, storage_path, original_name, mime_type, size_bytes, uploaded_by)
  values (p_submission_id, p_storage_path, p_original_name, p_mime_type, p_size_bytes,
          app.current_user_id())
  returning id into v_id;

  return v_id;
end $$;

grant execute on function
  app.attach_training_file(uuid, text, varchar, varchar, bigint)
to trade_house_app;

comment on function app.attach_training_file(uuid, text, varchar, varchar, bigint) is
  'Rattache une capture a une soumission. Reserve a l auteur du travail ; le '
  'controle du type reel reste a la charge de l API (magic bytes).';