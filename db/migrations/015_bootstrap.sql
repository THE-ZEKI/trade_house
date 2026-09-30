-- ============================================================================
-- trade_house - 015_bootstrap.sql
-- Creation du premier administrateur en production (A2 / RG-02).
--
-- Pourquoi cette fonction existe :
--   009_seed.sql cree un jeu d'essai avec des mots de passe CONNUS
--   (Admin!2345, Manager!2345, Trader!2345). C'est acceptable en
--   developpement, INTERDIT en production. Une installation de production ne
--   joue donc pas 009_seed... et se retrouve bloquee : app.create_user exige
--   un administrateur (RG-02) et il n'y en a aucun. C'est ce trou que cette
--   migration bouche.
--
-- Usage (une seule fois, a l'installation) :
--   select app.bootstrap_admin('toi@exemple.fr'::citext, 'Ton Nom');
--
-- Securite : la fonction se verrouille DEFINITIVEMENT des que le premier
-- administrateur existe. Une porte d'entree ouverte en permanence serait une
-- faille ; celle-ci se ferme toute seule apres un unique appel.
-- ============================================================================
\set ON_ERROR_STOP on

create or replace function app.bootstrap_admin(
  p_email     citext,
  p_full_name varchar
) returns public.users
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user public.users;
begin
  -- la porte se ferme des le premier admin cree, et le reste definitivement
  if exists (select 1 from public.users u where u.role = 'admin') then
    raise exception 'RG-02 : un administrateur existe deja, bootstrap desactive';
  end if;

  if p_email is null or p_email::text !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'RG-43 : email invalide';
  end if;
  if p_full_name is null or btrim(p_full_name) = '' then
    raise exception 'RG-43 : nom complet requis';
  end if;

  insert into public.users (email, password_hash, full_name, role, timezone, preferred_locale)
  -- " ! " + alea : hash inexploitable tant qu'aucun mot de passe n'est defini.
  -- L'admin ne peut donc pas encore se connecter : il passe par la procedure
  -- habituelle "mot de passe oublie" de la phase 1, qui lui envoie un lien
  -- a usage unique. Aucun mot de passe en clair ne transite jamais.
  values (p_email, '!' || encode(gen_random_bytes(32), 'hex'), btrim(p_full_name),
          'admin', 'Europe/Paris', 'fr')
  returning * into v_user;

  perform app.fn_audit('user.create', 'user', v_user.id,
                       jsonb_build_object('role', 'admin', 'bootstrap', true));

  return v_user;
end;
$$;

comment on function app.bootstrap_admin(citext, varchar) is
  'Cree le premier administrateur. Refuse des qu''il en existe un (usage unique).';

-- Seuls les membres du role applicatif peuvent l'appeler ; c'est le role
-- utilise par l'operateur a l'installation, pas par le public.
revoke all on function app.bootstrap_admin(citext, varchar) from public;
grant execute on function app.bootstrap_admin(citext, varchar) to trade_house_app;
