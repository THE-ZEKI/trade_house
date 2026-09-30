-- ============================================================================
-- trade_house - 009_seed.sql
-- Donnees initiales (idempotent)
-- ============================================================================
\set ON_ERROR_STOP on

-- 1. Parametres globaux : ligne unique obligatoire
insert into public.app_settings (id) values (1) on conflict (id) do nothing;

-- 2. Comptes de developpement (mots de passe conformes a RG-65)
--    A SUPPRIMER avant toute mise en ligne.
do $$
declare
  v_admin   uuid;
  v_manager uuid;
  v_t1      uuid;
  v_t2      uuid;
begin
  if exists (select 1 from public.users) then
    raise notice 'Des comptes existent deja : seed ignore';
    return;
  end if;

  insert into public.users (email, password_hash, full_name, role, timezone, mfa_enforced)
  values ('admin@trade-house.local', crypt('Admin!2345', gen_salt('bf')),
          'Administrateur', 'admin', 'Africa/Abidjan', false)  -- 2FA activee a la livraison de l'ecran 2FA (A5)
  returning id into v_admin;

  insert into public.users (email, password_hash, full_name, role, timezone)
  values ('manager@trade-house.local', crypt('Manager!2345', gen_salt('bf')),
          'Manager Groupe', 'manager', 'Africa/Abidjan')
  returning id into v_manager;

  insert into public.users (email, password_hash, full_name, role, manager_id, timezone)
  values ('trader1@trade-house.local', crypt('Trader!2345', gen_salt('bf')),
          'Trader Un', 'trader', v_manager, 'Africa/Abidjan')
  returning id into v_t1;

  insert into public.users (email, password_hash, full_name, role, manager_id, timezone)
  values ('trader2@trade-house.local', crypt('Trader!2345', gen_salt('bf')),
          'Trader Deux', 'trader', v_manager, 'Africa/Abidjan')
  returning id into v_t2;

  raise notice 'Comptes de dev crees : admin@ / manager@ / trader1@ / trader2@ trade-house.local';
  raise notice 'Mots de passe : Admin!2345 | Manager!2345 | Trader!2345';
end $$;

-- 3. Role applicatif NON proprietaire
--    Indispensable : le RLS n'est applique qu'a un role qui ne possede pas les
--    tables. L'application doit se connecter avec ce role (README).
--    Le mot de passe n'est PAS dans la migration : setup.ps1 le definit.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'trade_house_app') then
    create role trade_house_app login nosuperuser nobypassrls nocreatedb nocreaterole;
  end if;
end $$;

grant usage on schema public, app to trade_house_app;
grant select, insert, update, delete on all tables in schema public to trade_house_app;
grant usage, select on all sequences in schema public to trade_house_app;
grant execute on all functions in schema app to trade_house_app;
alter default privileges in schema public
  grant select, insert, update, delete on tables to trade_house_app;

