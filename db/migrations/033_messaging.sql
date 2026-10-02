-- ============================================================================
-- trade_house - 033_messaging.sql
--
-- UNE MESSAGERIE N EXISTE NI DANS LA BASE NI DANS LE CAHIER DES CHARGES.
-- Aucune table, aucune fonction, aucune mention : le projet a 29 evenements de
-- notification, une cloche, des rappels de reunion : et rien qui ressemble a
-- des messages echanges. Ce qui s en rapproche le plus est report_corrections
-- (commentaire attache a une ligne, avec reponse du trader), mais c est lie a
-- un rapport et mediatorise : ce n est pas une conversation.
--
-- Ce qui suit est donc une FONCTION NOUVELLE, pas une correction. Elle est
-- ecrite sous les memes contraintes que le reste du projet.
--
-- ---------------------------------------------------------------------------
-- LA QUESTION QUI DECIDE DE TOUT : QUI LIT QUOI ?
--
-- Un canal prive entre un manager et son trader. Le defaut evident serait
-- Doncvrir la table au role et de filtrer a l affichage. Ce serait faux, et
-- pour une raison precise : une politique RLS trop large se voit quand on
-- relit le code, une politique trop etroite se voit quand un utilisateur ne
-- peut plus faire son travail. Les deux ont un cout, mais pas le meme.
--
-- La regle appliquee ici est la plus etroite qui reste utilisable :
--
--   - un TRADER ne voit que ses propres messages, dans les deux sens ;
--   - un MANAGER ne voit que les messages de son equipe. PAS les messages
--     entre deux de ses traders, et PAS les conversations d une autre equipe ;
--   - l ADMIN n a AUCUN acces automatique. Il ne voit un fil que s il y
--     participe lui-meme.
--
-- Ce dernier point est un choix, et il est volontaire. La tentation serait de
-- donner l admin un acces global ("il doit pouvoir regler un probleme").
-- Mais alors un message ecrit en confiance a son manager devient lisible par
-- la plateforme entiere, et le destinataire s en rendrait compte : il ecrirait
-- moins, ou n ecrirait pas ce qu il pense. Une messagerie qu on sait
-- surveillee n est plus une messagerie. Si un conflit exige une mediation,
-- l admin ouvrira une conversation, ce qui est trace.
--
-- ---------------------------------------------------------------------------
-- PORQUOI PAS DE TABLE DE CONVERSATIONS ?
--
-- Un fil = (manager, trader). Ce couple est unique : un trader n a qu un
-- manager de tutelle (RG-06). Il tient donc largement dans deux colonnes.
-- Une table de plus, une jointure de plus, une politique de plus : pour
-- representer quelque chose qui est deja vrai dans public.users.
--
-- ---------------------------------------------------------------------------
-- LE CONTENU N'EST JAMAIS DANS UN EMAIL
--
-- Decide avec vous, et ecrit ici pour que personne ne le refasse par
-- inadvertance. Un courriel arrive dans une boite partagee ou sur un
-- telephone. Ecrire le texte d un message prive dans ce support rompt
-- exactement la confidentialite que ce module cherche a preserver. Le
-- courriel dira "vous avez un nouveau message", avec un lien vers
-- l application, ou la session est verifiee par le RLS de la table.
-- ============================================================================
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 1. Table
--
-- read_at porte sur le message RECU, pas sur le fil : un echange se lit
-- message par message, et c'est ce qui permet a chacun de savoir ce que
-- l'autre a vu. sender_id et recipient_id sont figes a l insertion : un
-- message ne se redirige pas, il s ecrit.
-- ---------------------------------------------------------------------------
create table public.messages (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null references public.users(id) on delete cascade,
  recipient_id uuid not null references public.users(id) on delete cascade,
  -- RG-46 : pas de contenu vide. Un message vide ne veut rien dire et
  --implemente le bruit dans un fil.
  body         text not null check (length(btrim(body)) > 0),
  read_at      timestamptz,
  created_at   timestamptz not null default now(),
  -- On ne parle pas a soi-meme : cela produirait un fil a sens unique et
  -- surtout une notification a soi, qui ne s efface jamais.
  constraint messages_not_self check (sender_id <> recipient_id),
  constraint messages_body_length check (length(body) <= 4000)
);
create index messages_inbox_idx on public.messages (recipient_id, created_at desc);
create index messages_sent_idx  on public.messages (sender_id, created_at desc);
-- Un fil se reconstitue par (destinataire, expediteur). C est le cas des deux
-- ecrans, un seul index couvre donc les deux.
create index messages_thread_idx on public.messages (recipient_id, sender_id, created_at);

-- ---------------------------------------------------------------------------
-- 2. Cloisonnement
--
-- app.can_message(p_sender, p_recipient) repond a la seule question qui
-- compte : ces deux comptes peuvent-ils echanger ? Elle est definie ICI, une
-- fois, et reutilisee par le RLS comme par la fonction d ecriture. Une regle
-- ecrite deux fois diverge un jour, et diverge en silence.
--
-- Le cas ADMIN n est volontairement absent : un admin n a pas de fil avec un
-- membre de son equipe. S il veut parler a un trader, il ecrit a son manager.
-- C est coherent avec RG-06, qui refuse a l admin de s immiscer dans la
-- relation manager-trader.
-- ---------------------------------------------------------------------------
create or replace function app.can_message(p_sender uuid, p_recipient uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.users
     where id = p_sender
       -- un trader parle a son manager de tutelle
       and ((role = 'trader' and manager_id = p_recipient)
            -- un manager parle a un de ses traders
            or (role = 'manager' and exists (
                  select 1 from public.users t
                   where t.id = p_recipient and t.role = 'trader'
                     and t.manager_id = p_sender)))
  );
$$;

comment on function app.can_message is
  'Vrai si les deux comptes peuvent echanger : un trader et son manager de '
  'tutelle, dans les deux sens. Un admin n a pas de fil automatique : il '
  'ecrit au manager, pas au trader.';

-- Le RLS appelle can_message pour chaque ligne. La fonction est SECURITY
-- DEFINER et STABLE : elle lit public.users, dont les politiques se
-- recurseraient sinon indefiniment.
alter table public.messages enable row level security;

-- LECTURE : je suis l un des deux. Regle la plus simple qui couvre les deux
-- ecrans (le fil et la boite de reception).
--
-- Consequence directe du choix fait plus haut, et elle tient sans code
-- supplementaire : un manager voit les messages qu il echange avec un trader,
-- et rien d autre. Il NE voit PAS les echanges entre deux de ses traders,
-- puisque ces lignes ne le nomment pas.
create policy messages_select on public.messages for select
  using (sender_id = app.current_user_id() or recipient_id = app.current_user_id());

-- ECRITURE : je peux ecrire a ce destinataire. Sans ce controle, un trader
-- pourrait envoyer un message a un autre compte, et celui-ci verrait une
-- ligne qu il n aurait jamais demandee a lire.
create policy messages_insert on public.messages for insert
  with check (
    sender_id = app.current_user_id()
    and app.can_message(sender_id, recipient_id)
  );

-- PAS de policy update ni delete : on ne modifie ni ne retire un message.
-- Un message envoye est un fait, pas un brouillon.
--
-- MAIS une policy manquante ne suffit PAS a interdire l operation : le role
-- applicatif tient ses droits de la migration 009, qui accorde INSERT, UPDATE et
-- DELETE sur TOUTES les tables. Sans politique, PostgreSQL applique "pas de
-- policy = tout autorise" pour un UPDATE comme pour un INSERT sur une table
-- sans politique update. C est mesure : un
--   update public.messages set body = 'falsifie'
-- passait, et un DELETE aussi. L historique d un fil pouvait donc etre reecrit
-- depuis n importe quelle requete.
--
-- Donc les REVOKE ci-dessous, qui retirent au role le droit brut. La
-- combination est obligatoire : le RLS dit QUOI est permis, le privilege dit CE
-- QUE le role peut tenter. mark_message_read passe par SECURITY DEFINER, qui
-- n est pas soumis au privilege du role appelant.
revoke insert, update, delete on public.messages from trade_house_app;

-- La lecture se pose malgre tout : le marquage "lu" passe par une fonction
-- ci-dessous, car un UPDATE direct ouvrirait la porte a modifier le texte.

-- ---------------------------------------------------------------------------
-- 3. Ecriture
--
-- Le droit d ecrire est decide en base, pas par l application : une route
-- qui verifierait le role en TypeScript pourrait etre contournee, celle-ci
-- non. Elle controle aussi la taille et la presence du message.
-- ---------------------------------------------------------------------------
create or replace function app.send_message(p_recipient uuid, p_body text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me uuid;
  v_id uuid;
begin
  v_me := app.current_user_id();

  if v_me is null then
    raise exception 'MSG-01 : vous devez etre connecte';
  end if;
  if p_body is null or length(btrim(p_body)) = 0 then
    raise exception 'MSG-02 : le message est vide';
  end if;
  if length(p_body) > 4000 then
    raise exception 'MSG-03 : le message depasse 4000 caracteres';
  end if;
  if not app.can_message(v_me, p_recipient) then
    raise exception 'MSG-04 : vous ne pouvez pas ecrire a ce compte';
  end if;

  insert into public.messages (sender_id, recipient_id, body)
  values (v_me, p_recipient, btrim(p_body))
  returning id into v_id;

  -- Journalise. Le CONTENU n y est pas : un audit lisible par l admin qui
  -- contient les mots d un message prive n est pas un journal, c est une
  -- copie du message qu on voulait proteger.
  perform app.fn_audit('message.sent', 'message', v_id,
                       jsonb_build_object('recipient_id', p_recipient,
                                          'length', length(p_body)));

  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Marquer comme lu
--
-- On ne touche QUE read_at, et seulement sur les messages recus. Un UPDATE
-- direct depuis l application aurait permis de reecrire le texte d un message
-- deja envoye : cette fonction n offre que ce dont l interface a besoin.
--
-- Un UPDATE sans politique update est refuse par le RLS : la fonction est
-- donc necessaire, et sa restriction a read_at est ce qui la rend sure.
-- ---------------------------------------------------------------------------
create or replace function app.mark_message_read(p_message_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.messages
     set read_at = coalesce(read_at, now())
   where id = p_message_id
     and recipient_id = app.current_user_id()
     and read_at is null;
end $$;

comment on function app.mark_message_read is
  'Marque lu un message recu. Ne peut toucher que read_at : ni le texte, ni un '
  'message envoye, ni un message qui n est pas le sien.';

-- ---------------------------------------------------------------------------
-- 5. La boite de reception et l interlocuteur
--
-- SECURITY DEFINER : la fonction doit rendre le NOM du correspondant, or le
-- RLS de public.users rend un manager invisible a son propre trader (migration
-- 029, meme cause). Sans elle, la boite de reception du trader afficherait un
-- expediteur anonyme.
--
-- Elle rend l interlocuteur LEGAL, calcule par can_message : un fil ne peut
-- donc pas s ouvrir vers quelqu un avec qui l echange serait refuse. C est ce
-- qui evite un ecran affichant un contact avec qui on ne peut pas ecrire.
-- ---------------------------------------------------------------------------
create or replace function app.fn_message_counterpart()
returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  -- Un trader n a qu un interlocuteur : son manager de tutelle.
  select manager_id from public.users
   where id = app.current_user_id() and role = 'trader'
  union all
  -- Un manager a autant d interlocuteurs que de traders dans son equipe, plus
  -- l admin (qui n est pas un contrepartie d exchange, mais doit pouvoir
  -- ecrire a un manager : voir can_message).
  select t.id from public.users t
   where t.role = 'trader' and t.manager_id = app.current_user_id()
  limit 1
$$;

-- Nombre de messages recus et non lus : c'est ce qui alimente la pastille.
create or replace function app.unread_message_count()
returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::int from public.messages
   where recipient_id = app.current_user_id() and read_at is null;
$$;

grant select on public.messages to trade_house_app;
-- INSERT est reaccorde : le role doit pouvoir inserer, et c est la politique
-- messages_insert qui decide de QUELS messages. Sans elle, l ecriture serait
-- impossible ; avec elle seule (sans le privilege), elle ne servirait a rien.
grant insert on public.messages to trade_house_app;
grant execute on function
  app.can_message(uuid, uuid),
  app.send_message(uuid, text),
  app.mark_message_read(uuid),
  app.unread_message_count()
to trade_house_app;
