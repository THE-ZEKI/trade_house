-- ============================================================================
-- trade_house - 037_admin_annuaire.sql
--
-- L'ADMIN ECRIVAIT MAIS N'EXISTAIT DANS AUCUNE LISTE.
--
-- 036 a ouvert le canal admin <-> manager/trader. cote SQL, c etait fait :
-- can_message acceptait desormais ces paires, et la notification partait.
-- Mais l'ADMIN N'APPARAISSAIT TOUJOURS PAS dans /equipe ni /mon-manager.
--
-- LA CAUSE EST LE RLS DE public.users, PAS LA RECHERCHE.
--
-- 008 a ecrit :
--
--     create policy users_select on public.users for select using (
--          id = app.current_user_id()
--       or app.is_admin()
--       or (role = 'trader' and manager_id = app.current_user_id()));
--
-- Aucun de ces trois cas ne dit "je suis manager et je vois un admin". La
-- ligne du compte administrateur est donc FILTREE pour un manager, et l'est
-- deja pour un trader. Or les deux ecrans lisaient leurs interlocuteurs
-- directement dans public.users.
--
-- Point d ordre technique, car c est ce qui rend le bug si resistant :
-- une clause WHERE applicative ne peut pas rattraper cela. Le RLS s'applique
-- AVANT le WHERE de la requete — la ligne est retiree de la table virtuelle
-- avant meme d'etre evaluee. Ajouter `t.role = 'admin'` a la page ne pouvait
-- donc rien changer. Seule la politique, ou une fonction qui la contourne
-- volontairement, peut ouvrir l'acces.
--
-- ---------------------------------------------------------------------------
-- POURQUOI UNE FONCTION, ET NON UN ELARGISSEMENT DE LA POLITIQUE.
--
-- Elargir users_select avec `or role = 'admin'` serait le coup le plus court,
-- et ce serait une faute : la politique porte sur la LIGNE ENTIERE. Un
-- trader verrait alors l'email de chaque administrateur, son id, son
-- manager_id, ses dates de creation. L'annuaire des comptes est une donnee
-- personnelle, pas un simple recipients de messagerie.
--
-- fn_user_display_name (033) existe deja pour ce meme raison, et son
-- commentaire le dit : "Ne rend que le nom : jamais l'email ni une autre
-- colonne." On applique ici la meme discipline.
--
-- La fonction rend id + nom, et rien d'autre.
--
-- ---------------------------------------------------------------------------
-- CE QUE CETTE FONCTION NE FAIT PAS.
--
-- Elle ne rend PAS la possibilite de lire les messages : 033 reste seul juge,
-- via le RLS de public.messages. Obtenir la liste des admins n'ouvre aucun
-- fil qui n'etait deja autorise. Un compte qui n'a aucun lien avec un admin
-- peut voir qu'il existe un support a qui-ecrire ; il ne peut pas lire pour
-- autant les echanges des autres.
-- ============================================================================

create or replace function app.fn_admin_contacts()
returns table (id uuid, full_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select u.id, u.full_name
    from public.users u
   where u.role = 'admin'
     and u.is_active
     and u.id <> app.current_user_id()
   order by u.full_name;
$$;

comment on function app.fn_admin_contacts() is
  'Annuaire des administrateurs actifs : id et nom uniquement. '
  'N expose ni l email ni aucune autre colonne de public.users. '
  'Donne la liste des correspondants, pas l acces a leurs conversations.';

grant execute on function app.fn_admin_contacts() to trade_house_app;