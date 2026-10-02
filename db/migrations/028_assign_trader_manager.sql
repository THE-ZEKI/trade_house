-- ============================================================================
-- trade_house - 028_assign_trader_manager.sql
--
-- DEMANDE METIER : gerer CONCRETEMENT l affectation des traders a leur
-- manager, depuis l'interface.
--
-- L 'etat des lieux avant cette migration :
--
--   - app.update_user_account (018) sait changer le manager_id, mais elle est
--     reservee a l 'administrateur ;
--   - 027 a permis au MANAGER de creer un trader, deja rattache a lui ;
--   - mais un trader cree AVANT 027, ou dont l 'equipe a change, ne pouvait
--     etre rattache que par un administrateur. Le manager se trouvait alors
--     devant un mur : il voyait le trader dans l 'annuaire sans pouvoir le
--     travailler.
--
-- Cette migration comble exactement ce manque, et rien d 'autre. Elle ne
-- touche ni au role, ni aux coordonnees, ni a l 'etat du compte : elle ne
-- deplace que le lien manager_id.
--
-- DEUX INTERDITS, et ils sont le sens de la fonction.
--
-- 1. Un MANAGER ne peut rattacher qu 'a LUI-MEME. Pas "un manager de son
--    choix" : un manager qui pourrait deposer un trader chez un concurrent
--    pourrait le vider de son equipe. La delegation reste une prise en charge,
--    pas un transfert. C'est aussi pourquoi la fonction ne prend pas de
--    parametre p_manager_id : il n y a rien a choisir.
--
-- 2. Retirer un trader de son equipe (manager_id = null) reste reserve a
--    l 'admin. Sans manager, un trader n'a plus de relecteur : ses rapports
--    seraient produits sans personne pour les corriger, et ses cours sans
--    personne pour les attribuer. Laisser un manager creer ce trou serait
--    creer un orphelin en un clic.
-- ============================================================================
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Rattacher un de ses traders (manager) ou tout trader (admin)
-- ---------------------------------------------------------------------------
create or replace function app.assign_trader_manager(p_trader_id uuid)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me     uuid;
  v_is_mgr boolean;
begin
  v_me     := app.current_user_id();
  v_is_mgr := (app.current_user_role() = 'manager');

  if not (app.is_admin() or v_is_mgr) then
    raise exception 'RG-02 : seul un administrateur ou un manager rattache un trader';
  end if;

  if p_trader_id is null then
    raise exception 'Compte introuvable';
  end if;

  -- Le role est verifie AVANT tout le reste : rattacher un manager n a aucun
  -- sens (un manager n a pas de tuteur) et laisserait un lien que rien ne lit.
  if not exists (select 1 from public.users where id = p_trader_id and role = 'trader') then
    raise exception 'Seul un trader peut etre rattache a un manager';
  end if;

  -- INTERDIT 1 : un manager ne choisit pas sa cible, c'est lui-meme. Pour
  -- l'admin, pas de restriction : c'est lui qui arbitrage les equipes.
  if v_is_mgr and not exists (
    select 1 from public.users u
     where u.id = p_trader_id and u.manager_id = v_me
  ) then
    raise exception 'RG-06 : ce trader n est pas dans votre equipe';
  end if;

  -- Le manager de tutelle doit etre actif, sinon on confie un travail a
  -- quelqu'un qui ne se connectera pas. Meme regle que 018, on la redit ici
  -- parce que la fonction doit se suffire a elle-meme.
  if v_is_mgr and not exists (select 1 from public.users where id = v_me and is_active) then
    raise exception 'Votre compte doit etre actif pour prendre un trader en charge';
  end if;

  update public.users set manager_id = v_me, updated_at = now()
   where id = p_trader_id;

  perform app.fn_audit('user.manager_assigned', 'users', p_trader_id,
                       jsonb_build_object('manager_id', v_me));

  return p_trader_id;
end $$;

comment on function app.assign_trader_manager is
  'Admin : rattache n importe quel trader a lui-meme. Manager : ne peut '
  'rattacher que les traders qu il supervise deja (interdit 1). Ne retire '
  'jamais un trader de son equipe : le detachement reste une operation admin '
  '(interdit 2).';

-- ---------------------------------------------------------------------------
-- Desattacher un trader de son manager : administrateur uniquement
--
-- Cette fonction existe pour que l 'operation ne soit pas faite par un
-- UPDATE direct. La raison du refus est metier, pas technique : un trader sans
-- manager n a plus de relecteur pour ses rapports ni de tuteur pour ses cours.
-- ---------------------------------------------------------------------------
create or replace function app.unassign_trader_manager(p_trader_id uuid)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_prev uuid;
begin
  if not app.is_admin() then
    raise exception 'Seul un administrateur retire un trader de son equipe';
  end if;

  select manager_id into v_prev from public.users where id = p_trader_id;
  if not found then
    raise exception 'Compte introuvable';
  end if;

  update public.users set manager_id = null, updated_at = now()
   where id = p_trader_id;

  perform app.fn_audit('user.manager_removed', 'users', p_trader_id,
                       jsonb_build_object('manager_id', v_prev));

  return p_trader_id;
end $$;

comment on function app.unassign_trader_manager is
  'Administrateur uniquement. Retire un trader de son equipe ; un trader sans '
  'manager n a ni relecteur ni tuteur.';

grant execute on function
  app.assign_trader_manager(uuid),
  app.unassign_trader_manager(uuid)
to trade_house_app;