-- ===========================================================================
-- 019 - Reglages modifiables par l administrateur
-- ===========================================================================
--
-- Pourquoi ? L'ecran /settings etait en lecture seule : les valeurs venaient
-- de app.settings(), mais aucune fonction ne les ecrivait. Les regles restaient
-- figees depuis la creation du projet.
--
-- On n'ecrit pas dans la table depuis l'API. Chaque cle est declaree avec son
-- type et ses bornes, et une cle absente de cette table est REFUSEE.
--
-- Pourquoi des bornes aussi strictes ? Parce qu'une valeur aberrante appliquee
-- a une regle de securite ne fait pas echouer une requete : elle produit un
-- systemecarbonate. Mettre login_lockout_minutes a 0 ne leve aucune erreur -
-- il desactive silencieusement le verrouillage apres tentatives echouees.
--
-- Chaque modification est tracee : un changement de regle doit pouvoir etre
-- explique six mois plus tard.
-- ===========================================================================

-- Catalogue des reglages modifiables : type, bornes et libelle d unites.
create or replace function app.settings_catalog()
returns table (key text, kind text, lo numeric, hi numeric)
language sql immutable
as $$
  select * from (values
    ('late_submission_days',        'int',     1,   60),
    ('correction_critical_days',    'int',     1,   60),
    ('stale_submission_hours',      'int',     1,  720),
    ('max_files_per_report',        'int',     1,   50),
    ('max_screenshot_mb',           'int',     1,   50),
    ('max_pdf_mb',                  'int',     1,  200),
    ('default_duration_min',        'int',     5,  480),
    ('attendance_present_ratio',    'ratio',   0,    1),
    ('late_arrival_minutes',        'int',     0,  240),
    ('room_open_before_minutes',    'int',     1,  120),
    ('room_close_after_minutes',    'int',     5, 1440),
    ('invitation_ttl_days',         'int',     1,   90),
    ('reminder_retry_count',        'int',     0,   10),
    ('reminder_retry_minutes',      'int',     1, 1440),
    ('max_login_attempts',          'int',     3,   20),
    ('login_lockout_minutes',       'int',     1, 1440),
    ('max_mfa_attempts',            'int',     3,   20),
    ('mfa_lockout_minutes',         'int',     1, 1440),
    ('video_room_minutes',          'int',    10,  480),
    ('video_token_ttl_minutes',     'int',     5,  120),
    ('retention_recording_months',  'int',     1,  120),
    ('retention_report_months',     'int',    12,  240),
    ('default_locale',              'locale',  0,    0)
  ) as t(key, kind, lo, hi);
$$;

comment on function app.settings_catalog is
  'Reglages modifiables et leurs bornes. Une cle absente de ce catalogue est refusee.';
-- -- Lecture d une seule valeur : la comparaison doit se faire sur la valeur
-- REELLE d avant ecriture, pas sur celle du patch.
create or replace function app.settings_setting(p_key text)
returns text
language sql stable
as $$
  select (to_jsonb(s) ->> p_key) from public.app_settings s;
$$;

-- Patch de reglages.
-- la trace reste lisible, et un patch dont dix valeurs sur
-- vingt sont refusees n invalide pas entierement la demande.
create or replace function app.update_settings(p_patch jsonb)
returns void
language plpgsql
volatile
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  r record;
  k text;
  v jsonb;
  v_before text;
  num numeric;
  txt text;
begin
  if app.current_user_role() <> 'admin' then
    raise exception 'Seul un administrateur modifie les reglages'
      using errcode = '42501';
  end if;

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'Patch invalide' using errcode = '22023';
  end if;

  for k in select jsonb_object_keys(p_patch) loop
    v := p_patch -> k;

    select * into r from app.settings_catalog() c where c.key = k;
    if not found then
      raise exception 'Reglage inconnu ou non modifiable : %', k;
    end if;

    if r.kind = 'locale' then
      txt := v #>> '{}';
      if txt not in ('fr', 'en') then
        raise exception '% : langue invalide (fr ou en)', k;
      end if;
    else
      num := (v #>> '{}')::numeric;
      if num < r.lo or num > r.hi then
        raise exception '% : valeur % hors bornes (% a %)', k, num, r.lo, r.hi;
      end if;
      txt := num::text;
    end if;

    -- Valeur REELLE avant ecriture : la trace doit permettre de retablir le
    -- reglage d avant, pas seulement annoncer ce qu il est devenu.
    v_before := app.settings_setting(k);

    -- Une seule ecriture, apres validation. Un UPDATE " cle = cle de l objet "
    -- aurait accepte silencieusement les valeurs hors plage, qu elles soient
    -- refusees ou non.
    if r.kind = 'locale' then
      execute format(
        'update public.app_settings set %I = $1, updated_at = now(), updated_by = $2 where id = 1',
        k)
        using txt, app.current_user_id();
    else
      execute format(
        'update public.app_settings set %I = $1::%s, updated_at = now(), updated_by = $2 where id = 1',
        k, case when r.kind = 'ratio' then 'numeric' else 'integer' end)
        using txt, app.current_user_id();
    end if;

    perform app.fn_audit(
      'settings_updated', 'app_settings', null,
      jsonb_build_object('key', k, 'before', v_before, 'after', txt)
    );
  end loop;
end $$;

comment on function app.update_settings is
  'Administrateur uniquement : applique un patch JSON de reglages, chaque cle '
  'validee contre app.settings_catalog() et journalisee.';


-- Lecture d une seule valeur, pour la trace : la comparaison doit se faire sur
-- la valeur REELLE d avant ecriture, pas sur celle du patch.
create or replace function app.settings_setting(p_key text)
returns text
language sql stable
as $$
  select (to_jsonb(s) ->> p_key) from public.app_settings s;
$$;
