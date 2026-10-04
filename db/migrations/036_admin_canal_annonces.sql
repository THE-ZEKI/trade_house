-- ============================================================================
-- trade_house - 036_admin_canal_annonces.sql
--
-- L'ADMIN AVAIT MOYEN D'ECRIRE A PERSONNE.
--
-- 033 a construit la messagerie sur une seule relation : le binome
-- manager <-> trader de tutelle. L'admin en etait explicitement exclu, et le
-- commentaire le justifiait ainsi :
--
--     Le cas ADMIN n est volontairement absent : un admin n a pas de fil avec
--     un membre de son equipe. S il veut parler a un trader, il ecrit a son
--     manager.
--
-- Ce raisonnement tient pour une organisation ou l'admin n est qu'un
-- regulateur. Il ne tient pas pour une plateforme ou l'admin est
-- l exploitant : il doit pouvoir prevenir TOUT LE MONDE d'une information qui
-- concerne l outil lui-meme (maintenance, changement de regle, incident), et
-- surtout RECEVOIR les remarques en retour. Sans ce canal, la seule facon de
-- collectedes est de passer par des messageries exterieures, hors traces.
--
-- ---------------------------------------------------------------------------
-- LE PERIMETRE RETENU, ET SES LIMITES.
--
--   modifie   : admin <-> manager, admin <-> trader, dans les DEUX sens
--   inchange  : manager <-> ses propres traders (et seulement eux)
--   inchange  : manager et trader entre eux s'ils n'ont aucun lien
--   inchange  : les echanges d'equipe restent prives entre le manager et son
--                equipe ; l'admin ne les survole pas
--
-- C est un CANAL D'ANNONCES, pas un reseau social. La difference n est pas
-- academique : si l'admin pouvait lire les conversations d'equipe, il
-- verrait des remarques sur la performance, le caractere ou les difficultes
-- de ses traders — c'est precisement ce que RG-06 lui refuse. Ici l'admin ne
-- voit que ce qu'il a lui-meme ecrit ou recu ; les fils manager-trader restent
-- cloisonnes, et le RLS de public.messages (033) continue de les appliquer
-- sans qu'aucune ligne de politique ne soit touchee.
--
-- ---------------------------------------------------------------------------
-- POURQUOI UNE SEULE FONCTION.
--
-- app.can_message est la source unique du droit d'echanger : elle est
-- appelee par app.send_message (ecriture) ET par les politiques RLS de
-- public.messages (lecture). Coder la regle ailleurs creerait une seconde
-- verite, qui divergerait en silence. Une seule condition de plus suffit donc
-- a ouvrir la lecture comme l'ecriture — et c'est le comportement voulu.
--
-- Le test porte sur le role du DESTINATAIRE, jamais sur le fait qu'il soit
-- inactif ou anonyme : on ne parle pas a un compte desactive (033 le refuse
-- deja en amont de can_message), mais on parle bien a un admin.
-- ============================================================================

create or replace function app.can_message(p_sender uuid, p_recipient uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.users
     where id = p_sender
       and (
             -- 036 : canal d annonces de l admin, dans les deux sens.
             -- L'admin écrit à tout le monde ; tout le monde peut lui
             -- répondre, y compris un trader dont il n'est pas le manager.
             (exists (select 1 from public.users s
                       where s.id = p_sender and s.role = 'admin')
              and exists (select 1 from public.users r
                           where r.id = p_recipient
                             and r.role in ('manager', 'trader')))
             -- un trader parle a son manager de tutelle
             or (role = 'trader' and manager_id = p_recipient)
             -- un manager parle a un de ses traders
             or (role = 'manager' and exists (
                   select 1 from public.users t
                    where t.id = p_recipient and t.role = 'trader'
                      and t.manager_id = p_sender))
           )
  );
$$;

comment on function app.can_message is
  'Vrai si les deux comptes peuvent echanger : un trader et son manager de '
  'tutelle, dans les deux sens ; ou l administrateur avec n importe quel '
  'manager ou trader (canal d annonces, 036). Les echanges d equipe entre un '
  'manager et un autre trader restent interdits.';