-- ============================================================================
-- trade_house - 029_meeting_creator_visible.sql
--
-- BUG : la ligne "Creee par" affichait "-" pour un TRADER participant.
--
-- Cause exacte, verifiee en base :
--
--   la politique users_select de 008 n'autorise a lire une ligne de
--   public.users que si l'utilisateur est celui-ci, l 'admin, ou le MANAGER
--   d'un trader. Un participant trader ne voit donc pas le manager qui a creee
--   la reunion. La page fait
--
--     select m.*, u.full_name as creator_name
--       from public.meetings m
--       left join public.users u on u.id = m.created_by
--
--   le LEFT JOIN ne supprime pas la reunion, mais ramene NULL pour le nom :
--   d ou le "-" affiche, sur une page par ailleurs parfaitement correcte.
--
--   Le defaut est particulierement trompeur parce que le meme JOIN rend le
--   nom si la requete est executee HORS transaction, et NULL dans une
--   transaction : c'est ce que fait asUser, donc toute l'application. La
--   La lecture "correcte" en console masque donc exactement la seule requete
--   qui compte.
--
-- Pourquoi la politique n'a pas ete elargie : les trois branches existantes
-- ont une raison d'etre, et le nombre de colonnes rend une nouvelle branche
-- risquee. On ne touche donc PAS au RLS de public.users.
--
-- Solution : une fonction SECURITY DEFINER dediee, qui rend le NOM de
-- l 'organisateur d 'une reunion, et rien d 'autre. Elle ne renvoie ni son
-- email, ni sa date de naissance, ni aucune de ses donnees : une seule
-- colonne, celle que l 'ecran affiche deja.
--
-- Elle verifie l 'acces a la reunion AVANT de rendre le nom : un trader sans
-- droit sur la reunion n 'apprend pas non plus qui l 'a creee.
-- ============================================================================
\set ON_ERROR_STOP on

create or replace function app.fn_meeting_creator_name(p_meeting uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
begin
  if not app.can_access_meeting(p_meeting) then
    return null;
  end if;

  select u.full_name into v_name
    from public.meetings m
    join public.users u on u.id = m.created_by
   where m.id = p_meeting;

  return v_name;
end $$;

comment on function app.fn_meeting_creator_name is
  'Nom du createur d une reunion, pour tout lecteur autorise. SECURITY '
  'DEFINER car public.users est cloisonne par RLS : le createur n est pas '
  'necessarily lisible par un participant (une seule colonne est exposee, et '
  'seulement si la reunion est accessible).';

grant execute on function app.fn_meeting_creator_name(uuid) to trade_house_app;