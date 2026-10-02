-- ===========================================================================
-- 018 - Administration des comptes : modification et anonymisation
-- ===========================================================================
--
-- POURQUOI PAS DE SUPPRESSION PHYSIQUE ?
--
-- Le besoin est reel : un administrateur doit pouvoir corriger un compte, et
-- une personne peut demander l'effacement de ses donnees. Mais une suppression
-- physique est architecturalement impossible ici, et c'est volontaire.
--
-- Ces tables pointent vers users avec ON DELETE NO ACTION :
--
--   reports, report_versions, report_files, report_corrections,
--   file_annotations, meetings, meeting_reminders
--
-- Consequence concrete : supprimer un trader ayant depose des rapports est
-- refuse par PostgreSQL. C'est le comportement voulu. Dans une plateforme de
-- coaching, l'historique de discipline EST la donnee : un trader qui brule
-- apres six mois de travail laisse la trace de ses progres. Supprimer le compte
-- detruirait ou detacherait cette preuve - precisement ce que l'application
-- sert a mesurer.
--
-- Deux reponses adaptees, exposees ici :
--
--   app.update_user_account()  -> corriger le compte (role, manager, contact)
--   app.anonymize_user()       -> effacer l'identite, garder l'historique
--
-- L'anonymisation est le " droit a l'oubli " realiste : email, nom et
-- telephone sont ecrases, le compte est desactive et ses sessions revoquees,
-- mais la ligne subsiste pour que rapports et correctifs gardent leur auteur.
--
-- Les deux exigent un administrateur, et sont tracees dans le journal (RG-63).
-- L'interface ne les appelle jamais sans controle de role prealable : la base
-- reste le juge.
-- ===========================================================================

-- Modification d'un compte par un administrateur ------------------------------
--
-- Pas de UPDATE direct depuis l'application : les regles vivent ici (role,
-- coherence manager/trader, retrait du dernier administrateur).
create or replace function app.update_user_account(
  p_user_id uuid,
  p_role user_role default null,
  p_manager_id uuid default null,
  p_phone text default null,
  p_timezone text default null,
  p_locale text default null,
  p_full_name text default null
) returns uuid
language plpgsql
volatile
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if app.current_user_role() <> 'admin' then
    raise exception 'Seul un administrateur modifie un compte'
      using errcode = '42501';
  end if;

  if p_user_id is null or not exists (select 1 from public.users where id = p_user_id) then
    raise exception 'Compte introuvable' using errcode = 'P0002';
  end if;

  -- Se retirer soi-meme le role administrateur pourrait laisser le systeme
  -- sans administrateur : action refusee plutot que de creer cette impasse.
  if p_user_id = app.current_user_id() and p_role is not null and p_role <> 'admin' then
    raise exception 'Impossible de retirer son propre role administrateur';
  end if;

  -- Un trader est rattache a un manager actif ; un manager ou un admin ne
  -- l'est pas : le lien est remis a null quand le role change.
  if p_role = 'trader' and p_manager_id is not null then
    if not exists (
      select 1 from public.users m
       where m.id = p_manager_id and m.role in ('manager', 'admin') and m.is_active
    ) then
      raise exception 'Manager invalide pour ce trader';
    end if;
  end if;

  update public.users
     set role             = coalesce(p_role, role),
         manager_id       = case
                              when p_role = 'trader' then p_manager_id
                              when p_role in ('manager', 'admin') then null
                              else manager_id
                            end,
         phone            = coalesce(p_phone, phone),
         timezone         = coalesce(p_timezone, timezone),
         preferred_locale = coalesce(p_locale, preferred_locale),
         full_name        = coalesce(nullif(trim(p_full_name), ''), full_name),
         updated_at       = now()
   where id = p_user_id;

  perform app.fn_audit(
    'user_updated', 'users', p_user_id,
    jsonb_build_object('role', p_role, 'manager_id', p_manager_id)
  );

  return p_user_id;
end $$;

comment on function app.update_user_account is
  'Administrateur uniquement : corrige role, manager et coordonnees d un compte.';


-- Anonymisation (droit a l oubli) -------------------------------------------
--
-- On n efface que l identite directe. L adresse d origine est remplacee par
-- une adresse technique non recontactable ; son empreinte SHA-256 est conservee
-- dans la nouvelle adresse, ce qui permet de reconnaitre un compte deja traite
-- sans garder l identite en clair.
create or replace function app.anonymize_user(p_user_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_email citext;
  v_sessions integer;
begin
  if app.current_user_role() <> 'admin' then
    raise exception 'Seul un administrateur anonymise un compte'
      using errcode = '42501';
  end if;

  if p_user_id is null or not exists (select 1 from public.users where id = p_user_id) then
    raise exception 'Compte introuvable' using errcode = 'P0002';
  end if;

  if p_user_id = app.current_user_id() then
    raise exception 'Impossible d anonymiser son propre compte';
  end if;

  select email into v_email from public.users where id = p_user_id for update;

  select count(*) into v_sessions
    from public.user_sessions
   where user_id = p_user_id and revoked_at is null;

  -- L anonymisation revoque les sessions sans attendre : la personne doit etre
  -- deconnectee maintenant, pas a l expiration.
  update public.user_sessions
     set revoked_at = now()
   where user_id = p_user_id and revoked_at is null;

  update public.users
     set email         = ('anonymise+' || substr(encode(digest(v_email::text, 'sha256'), 'hex'), 1, 24)
                          || '@anonymise.invalid')::citext,
         full_name     = 'Compte anonymise',
         phone         = null,
         -- Le hash est invalide : plus aucune authentification possible, meme
         -- par erreur de saisie sur un compte " reactive " par erreur.
         password_hash = '!anonymized',
         is_active     = false,
         mfa_enrolled  = false,
         anonymized_at = now(),
         updated_at    = now()
   where id = p_user_id;

  perform app.fn_audit(
    'user_anonymized', 'users', p_user_id,
    jsonb_build_object('sessions_revoked', v_sessions)
  );

  return p_user_id;
end $$;

comment on function app.anonymize_user is
  'Administrateur uniquement : efface l identite (RGPD) en conservant l historique des rapports.';


-- Le droit de suppression ne peut pas etre accorde au role applicatif : aucune
-- politique DELETE n existe sur public.users, et les contraintes NO ACTION
-- protegeient de toute deconstruction anyway. On le dit explicitement dans
-- la base plutot que de laisser croire que c'est un oubli.
comment on table public.users is
  'Pas de suppression physique possible : reports, corrections et annotations '
  'referencent l auteur (ON DELETE NO ACTION). Utiliser app.anonymize_user() '
  'pour le droit a l oubli, app.update_user_account() pour corriger.';
